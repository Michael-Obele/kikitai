/**
 * Local-engine model loading and inference, in a form BOTH the main thread
 * (fallback when Workers are unavailable) and `gen.worker.ts` can import.
 *
 * Deliberately free of `$env`, telemetry and remote functions: a worker bundle
 * can rely on none of them, so callers pass the CDN base in and record the
 * timings themselves. Everything expensive lives here — ONNX Runtime priming,
 * the model download/parse and `generate()` itself — which is exactly what used
 * to freeze the page for up to 9.7 s at a time.
 */
import { seedKittenModel } from './model-cache';

export type LocalEngine = 'kitten' | 'kokoro';

/**
 * Package paths appended to the CDN base. The `/+esm` suffix asks jsDelivr for
 * its browser-condition build: plain esm.sh injects an unenv `process` shim
 * (`versions.node = "22.14.0"`), so the loaders take their Node branch and die
 * on `fs.mkdirSync` — "[unenv] fs.mkdirSync is not implemented yet!".
 */
export const TTS_MODULES = {
	kitten: 'kitten-tts-js@0.1.2/+esm',
	kokoro: 'kokoro-js@1.2.1/+esm'
} as const;

const TTS_MODELS = {
	kitten: 'KittenML/kitten-tts-nano-0.8',
	kokoro: 'onnx-community/Kokoro-82M-v1.0-ONNX'
} as const;

/**
 * kitten's jsDelivr build derives `ort.env.wasm.wasmPaths` from its own
 * immutable npm path (`…/kitten-tts-js@0.1.2/src/`), which ships no ONNX
 * Runtime files → 404 on `ort-wasm-simd-threaded.jsep.mjs` → "no available
 * backend found". It only assigns that value when unset, and jsDelivr rewrites
 * its bare `onnxruntime-web` import to this exact URL — so import it first and
 * point `wasmPaths` at the package's real `dist/` (a URL prefix, per ONNX
 * Runtime's `Env.WebAssemblyFlags.wasmPaths`).
 */
const ORT_MODULE: string = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/+esm';
const ORT_DIST = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';

async function primeOnnxRuntime(): Promise<void> {
	try {
		const ort = await import(/* @vite-ignore */ ORT_MODULE);
		ort.env.wasm.wasmPaths = ORT_DIST;
		// Multi-threaded WASM needs cross-origin isolation (COOP/COEP). Without it
		// ORT silently runs on ONE core — the main reason generation crawls.
		if (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
			ort.env.wasm.numThreads = Math.max(1, navigator.hardwareConcurrency || 1);
		}
	} catch {
		/* kitten's own import decides — same behaviour as before this fix */
	}
}

type GenerateOptions = { voice?: string; speed?: number };

type GeneratedAudio = {
	/** Kitten hands back a ready-made helper; kokoro-js returns raw PCM instead. */
	toAudioBuffer?: (ctx: AudioContext) => AudioBuffer;
	/** Kitten's samples (`RawAudio.data`). */
	data?: Float32Array;
	/** kokoro-js's samples, under a different name. */
	audio?: Float32Array;
	sampling_rate?: number;
};

export type ModelHandle = {
	generate: (text: string, opts?: GenerateOptions) => Promise<GeneratedAudio>;
	/** Frees the ONNX session — kitten's README calls this out for model switching. */
	release?: () => void;
};

/** Phase breakdown behind one `load` — the card's single number, explained. */
export type LoadStats = {
	ms: number;
	mirror: boolean;
	fetchMs: number;
	phases: Record<string, number>;
};
export type LoadedModel = { model: ModelHandle; stats: LoadStats };
export type LoadOptions = { cdnBase: string; modelBase?: string };

/** The shapes jsDelivr's ESM builds hand back — all we touch of each module. */
type KittenModule = {
	KittenTTS: { from_pretrained: (id: string) => Promise<ModelHandle> };
};
type KokoroModule = {
	KokoroTTS: {
		from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<ModelHandle>;
	};
};

/** In-flight load per engine. A failure is never left in here — see `once()`. */
const loading: Record<LocalEngine, Promise<LoadedModel> | null> = { kitten: null, kokoro: null };

/**
 * Share one in-flight load between concurrent callers, but never remember a
 * failure. A dead CDN request used to be permanent: the rejected promise stayed
 * in the slot, so every later Play press re-threw the same cached error — naming
 * a URL it never tried again — until the whole page was reloaded.
 */
function once(engine: LocalEngine, load: () => Promise<LoadedModel>): Promise<LoadedModel> {
	const pending = loading[engine];
	if (pending) return pending;
	let started: Promise<LoadedModel>;
	started = load().catch((error: unknown) => {
		if (loading[engine] === started) loading[engine] = null;
		throw error;
	});
	loading[engine] = started;
	return started;
}

/**
 * The engine module arrives through jsDelivr's on-demand ESM transform, and BOTH
 * local engines pull `phonemizer@1.2.1` through it — 690 KB of brotli'd
 * JavaScript that the CDN has to build the first time anyone asks for it
 * (measured at 61 s cold from here). A phone dropping that connection is the
 * "Failed to fetch dynamically imported module" the reader saw. One immediate
 * retry absorbs a blip; a real outage still fails, 400 ms later.
 */
async function importEngineModule<T>(engine: LocalEngine, cdnBase: string): Promise<T> {
	try {
		return (await import(/* @vite-ignore */ `${cdnBase}/${TTS_MODULES[engine]}`)) as T;
	} catch {
		await new Promise((resolve) => setTimeout(resolve, 400));
		return (await import(/* @vite-ignore */ `${cdnBase}/${TTS_MODULES[engine]}`)) as T;
	}
}

function loadKitten(options: LoadOptions): Promise<LoadedModel> {
	return once('kitten', () => {
		const started = performance.now();
		let mirrored = false;
		let fetchMs = 0;
		// Phase marks behind the card's single load number: seed (mirror/cache),
		// prime (ONNX runtime + WASM), mod (CDN module import), model (weights
		// parse + session create). Answers "why is load 6–8 s" without guessing.
		let seedMs = 0;
		let primeMs = 0;
		let modMs = 0;
		let modelMs = 0;
		return seedKittenModel(options.modelBase)
			.catch(() => ({ ok: false, fetchMs: 0 }))
			.then((seeded) => {
				mirrored = seeded.ok;
				fetchMs = Math.round(seeded.fetchMs);
				seedMs = Math.round(performance.now() - started);
				const t = performance.now();
				return primeOnnxRuntime().finally(() => {
					primeMs = Math.round(performance.now() - t);
				});
			})
			.then(() => {
				const t = performance.now();
				return importEngineModule<KittenModule>('kitten', options.cdnBase).finally(() => {
					modMs = Math.round(performance.now() - t);
				});
			})
			.then((mod: { KittenTTS: { from_pretrained: (id: string) => Promise<ModelHandle> } }) => {
				const t = performance.now();
				return mod.KittenTTS.from_pretrained(TTS_MODELS.kitten).finally(() => {
					modelMs = Math.round(performance.now() - t);
				});
			})
			.then((model) => ({
				model,
				stats: {
					ms: performance.now() - started,
					mirror: mirrored,
					fetchMs,
					phases: { seed: seedMs, prime: primeMs, mod: modMs, model: modelMs }
				}
			}));
	});
}

function loadKokoro(options: LoadOptions): Promise<LoadedModel> {
	return once('kokoro', () => {
		const started = performance.now();
		// WebGPU wants fp32 (kokoro-js recommends it; int8 is the slow path on GPU).
		// fp32+WASM measured RTF ~1.6 here — too slow to keep up with playback.
		const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
		let modMs = 0;
		let modelMs = 0;
		const importMod = () => {
			const t = performance.now();
			return importEngineModule<KokoroModule>('kokoro', options.cdnBase).finally(() => {
				modMs = Math.round(performance.now() - t);
			});
		};
		return importMod()
			.then((mod: KokoroModule) => {
				const t = performance.now();
				return mod.KokoroTTS.from_pretrained(
					TTS_MODELS.kokoro,
					gpu ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' }
				)
					.catch(async (error: unknown) => {
						// 310MB of fp32 does not fit in every browser's WASM heap — drop to the
						// 90MB build rather than leaving the player dead with "no available backend".
						if (!gpu || !/out of memory|no available backend|Aborted/i.test(String(error)))
							throw error;
						console.warn('[tts] fp32/WebGPU would not load — retrying the 90MB WASM build', error);
						const retry = await importMod();
						return retry.KokoroTTS.from_pretrained(TTS_MODELS.kokoro, {
							dtype: 'q8',
							device: 'wasm'
						});
					})
					.finally(() => {
						modelMs = Math.round(performance.now() - t);
					});
			})
			.then((model) => ({
				model,
				stats: {
					ms: performance.now() - started,
					mirror: false,
					fetchMs: 0,
					phases: { mod: modMs, model: modelMs }
				}
			}));
	});
}

export function loadLocal(engine: LocalEngine, options: LoadOptions): Promise<LoadedModel> {
	return engine === 'kitten' ? loadKitten(options) : loadKokoro(options);
}

/**
 * One model in memory at a time. Switching engines used to keep both ONNX
 * sessions alive — kitten's session plus kokoro's fp32 weights (310MB on disk,
 * roughly 1GB resident) across two separate ONNX runtimes — and the WASM heap
 * died on smaller machines with `no available backend found … out of memory`.
 * A reload only hid it, because a reload resets the heaps.
 */
export async function releaseLocal(engine: LocalEngine): Promise<void> {
	if (engine === 'kitten') {
		const pending = loading.kitten;
		loading.kitten = null;
		if (!pending) return;
		try {
			// kokoro-js exposes no release: dropping the last reference is the free.
			await pending.then((entry) => entry.model.release?.()).catch(() => undefined);
		} catch {
			/* session already gone */
		}
		return;
	}
	const pending = loading.kokoro;
	loading.kokoro = null;
	if (!pending) return;
	try {
		const entry = await pending;
		// kitten's README calls this out for model switching.
		entry.model.release?.();
	} catch {
		/* session already gone */
	}
}

/**
 * Raw PCM out of either engine's result. The worker path needs samples —
 * `toAudioBuffer` needs an AudioContext, and Web Audio does not exist in
 * workers — so this is the one shape both realms can pass around.
 */
export function samplesOf(generated: GeneratedAudio): {
	samples: Float32Array;
	sampleRate: number;
} {
	const samples = generated.data ?? generated.audio;
	if (!samples?.length) throw new Error('The voice engine returned no audio samples.');
	return { samples, sampleRate: generated.sampling_rate ?? 24000 };
}

export async function generateSamples(
	model: ModelHandle,
	text: string,
	voice: string,
	speed: number
): Promise<{ samples: Float32Array; sampleRate: number }> {
	return samplesOf(await model.generate(text, { voice, speed }));
}
