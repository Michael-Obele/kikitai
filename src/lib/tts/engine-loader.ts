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

let kitten: Promise<LoadedModel> | null = null;
let kokoro: Promise<LoadedModel> | null = null;

async function loadKitten(options: LoadOptions): Promise<LoadedModel> {
	if (!kitten) {
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
		kitten = seedKittenModel(options.modelBase)
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
				return import(/* @vite-ignore */ `${options.cdnBase}/${TTS_MODULES.kitten}`).finally(() => {
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
	}
	return kitten;
}

async function loadKokoro(options: LoadOptions): Promise<LoadedModel> {
	if (!kokoro) {
		const started = performance.now();
		// WebGPU wants fp32 (kokoro-js recommends it; int8 is the slow path on GPU).
		// fp32+WASM measured RTF ~1.6 here — too slow to keep up with playback.
		const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
		let modMs = 0;
		let modelMs = 0;
		type KokoroModule = {
			KokoroTTS: {
				from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<ModelHandle>;
			};
		};
		const importMod = () => {
			const t = performance.now();
			return import(/* @vite-ignore */ `${options.cdnBase}/${TTS_MODULES.kokoro}`).finally(() => {
				modMs = Math.round(performance.now() - t);
			});
		};
		kokoro = importMod()
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
	}
	return kokoro;
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
		const pending = kitten;
		kitten = null;
		if (!pending) return;
		try {
			// kokoro-js exposes no release: dropping the last reference is the free.
			await pending.then((entry) => entry.model.release?.()).catch(() => undefined);
		} catch {
			/* session already gone */
		}
		return;
	}
	const pending = kokoro;
	kokoro = null;
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
