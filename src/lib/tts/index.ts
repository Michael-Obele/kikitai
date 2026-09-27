import { env } from '$env/dynamic/public';
import { synthesize } from '$lib/remote';
import { recordTts } from './telemetry';

export type EngineId = 'kitten' | 'kokoro' | 'webspeech' | 'google' | 'minimax';

export type EngineMeta = {
	id: EngineId;
	label: string;
	note: string;
	/** First-run download inside the browser, in MB (0 = nothing to download). */
	downloadMb: number;
	/** True when the text never leaves the device. */
	local: boolean;
	voices: string[];
	defaultVoice: string;
};

/**
 * Engine registry. `kitten` and `kokoro` are loaded lazily from a CDN at first
 * play — the app never bundles the ONNX runtimes (~450MB on npm) — so the base
 * URL is configurable through `PUBLIC_TTS_CDN`.
 */
export const ENGINES: Record<EngineId, EngineMeta> = {
	kitten: {
		id: 'kitten',
		label: 'Kitten (default)',
		note: 'Tiny local model, Apache-2.0. ~57MB once, then offline forever.',
		downloadMb: 57,
		local: true,
		voices: ['Luna', 'Bella', 'Rosie', 'Kiki', 'Leo', 'Jasper', 'Bruno', 'Hugo'],
		defaultVoice: 'Luna'
	},
	kokoro: {
		id: 'kokoro',
		label: 'Kokoro 82M (hi-fi)',
		note: 'Higher quality local model. ~90MB once, WebGPU when available.',
		downloadMb: 90,
		local: true,
		voices: ['af_heart', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'bf_emma', 'bf_george'],
		defaultVoice: 'af_heart'
	},
	webspeech: {
		id: 'webspeech',
		label: 'Web Speech',
		note: 'Your OS voices. Instant, 0MB, works everywhere (quality varies).',
		downloadMb: 0,
		local: true,
		voices: [],
		defaultVoice: ''
	},
	google: {
		id: 'google',
		label: 'Google Cloud TTS',
		note: 'Server-side voice. Text is sent to Google — needs GOOGLE_TTS_KEY.',
		downloadMb: 0,
		local: false,
		voices: ['en-US-Neural2-C', 'en-US-Neural2-D', 'en-GB-Neural2-A'],
		defaultVoice: 'en-US-Neural2-C'
	},
	minimax: {
		id: 'minimax',
		label: 'MiniMax',
		note: 'Server-side voice, the expensive option. Needs MINIMAX_* keys.',
		downloadMb: 0,
		local: false,
		voices: ['male-qn-qingse', 'female-shaonv'],
		defaultVoice: 'female-shaonv'
	}
};

const TTS_MODELS = {
	kitten: 'KittenML/kitten-tts-nano-0.8',
	kokoro: 'onnx-community/Kokoro-82M-v1.0-ONNX'
} as const;

/** Fixed speed steps offered in the UI (multiplier over natural speech). */
export const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const DEFAULT_SPEED = 1;

/**
 * Package paths appended to the CDN base. The `/+esm` suffix asks jsDelivr for
 * its browser-condition build: plain esm.sh injects an unenv `process` shim
 * (`versions.node = "22.14.0"`), so the loaders take their Node branch and die
 * on `fs.mkdirSync` — "[unenv] fs.mkdirSync is not implemented yet!".
 */
const TTS_MODULES = {
	kitten: 'kitten-tts-js@0.1.2/+esm',
	kokoro: 'kokoro-js@1.2.1/+esm'
} as const;

/** Base URL of an npm CDN serving `<base>/<package>/+esm` (jsDelivr-style). */
const cdn = () => (env.PUBLIC_TTS_CDN || 'https://cdn.jsdelivr.net/npm').replace(/\/$/, '');

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

let kitten: Promise<{
	generate: (text: string, opts?: { voice?: string; speed?: number }) => Promise<GeneratedAudio>;
}> | null = null;
let kokoro: Promise<{
	generate: (text: string, opts?: { voice?: string; speed?: number }) => Promise<GeneratedAudio>;
}> | null = null;

type GeneratedAudio = {
	toAudioBuffer: (ctx: AudioContext) => AudioBuffer;
	data?: Float32Array;
	sampling_rate?: number;
};

async function loadKitten() {
	if (!kitten) {
		const started = performance.now();
		kitten = primeOnnxRuntime()
			.then(() => import(/* @vite-ignore */ `${cdn()}/${TTS_MODULES.kitten}`))
			.then((mod: any) => mod.KittenTTS.from_pretrained(TTS_MODELS.kitten))
			.then((model) => {
				recordTts({
					engine: 'kitten',
					kind: 'load',
					ms: performance.now() - started,
					at: Date.now()
				});
				return model;
			});
	}
	return kitten;
}

async function loadKokoro() {
	if (!kokoro) {
		const started = performance.now();
		kokoro = import(/* @vite-ignore */ `${cdn()}/${TTS_MODULES.kokoro}`)
			.then((mod: any) =>
				mod.KokoroTTS.from_pretrained(TTS_MODELS.kokoro, { dtype: 'q8', device: 'wasm' })
			)
			.then((model) => {
				recordTts({
					engine: 'kokoro',
					kind: 'load',
					ms: performance.now() - started,
					at: Date.now()
				});
				return model;
			});
	}
	return kokoro;
}

/** Prepare a local engine ahead of time (shows the download notice first). */
export async function warmUp(engine: EngineId): Promise<void> {
	if (engine === 'kitten') await loadKitten();
	else if (engine === 'kokoro') await loadKokoro();
}

// ---------------------------------------------------------------- playback --

let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let audioEl: HTMLAudioElement | null = null;
let resolveEnd: (() => void) | null = null;
let stopped = false;

function audioContext(): AudioContext {
	ctx ??= new AudioContext();
	return ctx;
}

function stopCurrent() {
	stopped = true;
	if (source) {
		try {
			source.onended = null;
			source.stop();
		} catch {
			/* already stopped */
		}
		source = null;
	}
	if (audioEl) {
		audioEl.onended = null;
		audioEl.pause();
		audioEl = null;
	}
	if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
	if (resolveEnd) {
		resolveEnd();
		resolveEnd = null;
	}
}

/** Stop whatever is playing (called on unmount, navigation, next item). */
export const halt = stopCurrent;

export function pausePlayback() {
	if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) speechSynthesis.pause();
	else void ctx?.suspend();
}

export function resumePlayback() {
	if (typeof speechSynthesis !== 'undefined' && speechSynthesis.paused) speechSynthesis.resume();
	else void ctx?.resume();
}

function playBuffer(buffer: AudioBuffer): Promise<void> {
	return new Promise((done) => {
		const context = audioContext();
		const node = context.createBufferSource();
		node.buffer = buffer;
		node.connect(context.destination);
		node.onended = () => {
			if (source === node) source = null;
			done();
		};
		source = node;
		node.start();
		resolveEnd = () => done();
	});
}

function playBase64(audio: string, mime: string, speed = DEFAULT_SPEED): Promise<void> {
	return new Promise((done, fail) => {
		const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
		const el = new Audio(url);
		if (speed !== 1) {
			el.playbackRate = speed;
			if ('preservesPitch' in el) el.preservesPitch = true;
		}
		audioEl = el;
		el.onended = () => {
			URL.revokeObjectURL(url);
			audioEl = null;
			done();
		};
		el.onerror = () => fail(new Error('Could not play the synthesized audio'));
		resolveEnd = () => {
			URL.revokeObjectURL(url);
			done();
		};
		void el.play().catch(fail);
	});
}

function speakWithWebSpeech(text: string, voice: string, rate = DEFAULT_SPEED): Promise<void> {
	return new Promise((done) => {
		const utterance = new SpeechSynthesisUtterance(text);
		const voices = speechSynthesis.getVoices();
		const match =
			voices.find((v) => v.name === voice) ?? voices.find((v) => v.lang.startsWith('en'));
		if (match) utterance.voice = match;
		utterance.rate = rate;
		utterance.onend = () => done();
		utterance.onerror = () => done();
		speechSynthesis.speak(utterance);
		resolveEnd = () => done();
	});
}

export type PreparedSpeech = {
	/** Milliseconds spent generating (≈0 when the engine synthesizes on the fly). */
	genMs: number;
	chars: number;
	/** Plays the generated audio; resolves when the chunk has finished. */
	play: () => Promise<void>;
};

/**
 * Generate one chunk *without* playing it — the lookahead half of the player.
 * Local engines are compute-bound, so the player prepares sentence N+1 while
 * sentence N is still speaking: whenever `gen < play` the gaps disappear.
 */
export async function prepare(
	engine: EngineId,
	voice: string,
	text: string,
	speed: number = DEFAULT_SPEED
): Promise<PreparedSpeech> {
	stopped = false;
	const clean = text.trim();
	if (!clean) return { genMs: 0, chars: 0, play: async () => {} };

	const started = performance.now();
	let play: () => Promise<void>;

	if (engine === 'webspeech') {
		if (typeof speechSynthesis === 'undefined')
			throw new Error('Web Speech is not available here.');
		play = () => speakWithWebSpeech(clean, voice, speed);
	} else if (engine === 'kitten' || engine === 'kokoro') {
		const model = engine === 'kitten' ? await loadKitten() : await loadKokoro();
		const generated = await model.generate(clean, {
			voice: voice || ENGINES[engine].defaultVoice,
			speed
		});
		play = async () => {
			if (stopped) return;
			await playBuffer(generated.toAudioBuffer(audioContext()));
		};
	} else {
		const result = await synthesize({ text: clean, engine, voice });
		play = async () => {
			if (stopped) return;
			await playBase64(result.audio, result.mime, speed);
		};
	}

	const genMs = performance.now() - started;
	recordTts({ engine, kind: 'gen', ms: genMs, chars: clean.length, at: Date.now() });
	return { genMs, chars: clean.length, play };
}

/** Play a `prepare`d chunk, recording how long the audio actually took. */
export async function playPrepared(engine: EngineId, prepared: PreparedSpeech): Promise<void> {
	const started = performance.now();
	try {
		await prepared.play();
	} finally {
		recordTts({ engine, kind: 'play', ms: performance.now() - started, at: Date.now() });
	}
}

/**
 * Speak one chunk of text with the chosen engine. Resolves when the chunk has
 * finished (or was stopped), so a playlist can advance to the next item.
 */
export async function speak(
	engine: EngineId,
	voice: string,
	text: string,
	onError?: (message: string) => void,
	speed: number = DEFAULT_SPEED
): Promise<void> {
	try {
		await playPrepared(engine, await prepare(engine, voice, text, speed));
	} catch (error) {
		onError?.(error instanceof Error ? error.message : String(error));
	}
}

/** Anything longer than this stalls the first audio — split before speaking. */
const MAX_CHUNK = 300;

/** Split text into speakable chunks — sentence level, with long ones divided. */
export function toSentences(text: string): string[] {
	const parts = text
		.match(/[^.!?]+[.!?]*/g)
		?.map((s) => s.trim())
		.filter(Boolean) ?? [text];
	return parts.flatMap((part) => (part.length <= MAX_CHUNK ? [part] : splitLong(part)));
}

/**
 * Divide one oversized sentence at commas/colons, falling back to word
 * boundaries — generation is per chunk, so a 2000-character "sentence" would
 * keep the listener waiting for one very long inference.
 */
function splitLong(part: string): string[] {
	// split with a capture keeps the delimiters at odd indices — rejoin them.
	const pieces = part.split(/([,;:]\s+)/);
	const segments: string[] = [];
	for (let i = 0; i < pieces.length; i += 2) {
		segments.push((pieces[i] ?? '') + (pieces[i + 1] ?? ''));
	}

	const out: string[] = [];
	for (const segment of segments) {
		if (segment.length <= MAX_CHUNK) {
			if (segment.trim()) out.push(segment.trim());
			continue;
		}
		let line = '';
		for (const word of segment.split(/\s+/)) {
			if (!word) continue;
			if (line && line.length + 1 + word.length > MAX_CHUNK) {
				out.push(line);
				line = word;
			} else {
				line = line ? `${line} ${word}` : word;
			}
		}
		if (line) out.push(line);
	}
	return out;
}
