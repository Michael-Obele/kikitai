import { env } from '$env/dynamic/public';
import { synthesize } from '$lib/remote';
import { recordTts, sessionId } from './telemetry';
import { seedKittenModel } from './model-cache';
import { chunkKey, loadAudio, saveAudio } from './audio-cache';

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
		note: 'Higher quality local model. ~90MB on WASM, ~310MB with WebGPU (fp32).',
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

/**
 * What the download notice promises. Kokoro switches dtype with the device —
 * fp32 on WebGPU (int8 ops are the slow path there), q8 on WASM — and fp32 is
 * the larger file, so the estimate has to know which one the browser will take.
 */
export function downloadEstimate(engine: EngineId): number {
	if (engine === 'kokoro' && typeof navigator !== 'undefined' && 'gpu' in navigator) return 310;
	return ENGINES[engine].downloadMb;
}

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
	/** Kitten hands back a ready-made helper; kokoro-js returns raw PCM instead. */
	toAudioBuffer?: (ctx: AudioContext) => AudioBuffer;
	/** Kitten's samples. */
	data?: Float32Array;
	/** kokoro-js's samples, under a different name. */
	audio?: Float32Array;
	sampling_rate?: number;
};

/**
 * Both engines, one AudioBuffer. Kokoro's result has no `toAudioBuffer`, and
 * calling it anyway throws mid-`prepare` — which used to strand the player on
 * "playing" forever with nothing ever spoken.
 */
function toBuffer(generated: GeneratedAudio, context: AudioContext): AudioBuffer {
	if (generated.toAudioBuffer) return generated.toAudioBuffer(context);
	const samples = generated.data ?? generated.audio;
	if (!samples?.length) throw new Error('The voice engine returned no audio samples.');
	const buffer = context.createBuffer(1, samples.length, generated.sampling_rate ?? 24000);
	// `set` (not `copyToChannel`) so the typed-array variance stays version-agnostic.
	buffer.getChannelData(0).set(samples);
	return buffer;
}

async function loadKitten() {
	if (!kitten) {
		const started = performance.now();
		let mirrored = false;
		let fetchMs = 0;
		kitten = seedKittenModel()
			.catch(() => ({ ok: false, fetchMs: 0 }))
			.then((seeded) => {
				mirrored = seeded.ok;
				fetchMs = Math.round(seeded.fetchMs);
				return primeOnnxRuntime();
			})
			.then(() => import(/* @vite-ignore */ `${cdn()}/${TTS_MODULES.kitten}`))
			.then((mod: any) => mod.KittenTTS.from_pretrained(TTS_MODELS.kitten))
			.then((model) => {
				recordTts({
					engine: 'kitten',
					kind: 'load',
					ms: performance.now() - started,
					mirror: mirrored,
					fetchMs,
					session: sessionId,
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
		// WebGPU wants fp32 (kokoro-js recommends it; int8 is the slow path on GPU).
		// fp32+WASM measured RTF ~1.6 here — too slow to keep up with playback.
		const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
		kokoro = import(/* @vite-ignore */ `${cdn()}/${TTS_MODULES.kokoro}`)
			.then((mod: any) =>
				mod.KokoroTTS.from_pretrained(
					TTS_MODELS.kokoro,
					gpu ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' }
				)
			)
			.then((model) => {
				recordTts({
					engine: 'kokoro',
					kind: 'load',
					ms: performance.now() - started,
					session: sessionId,
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
	/** True when the audio came from the on-device cache instead of inference. */
	cached?: boolean;
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
	let cached = false;

	if (engine === 'webspeech') {
		if (typeof speechSynthesis === 'undefined')
			throw new Error('Web Speech is not available here.');
		play = () => speakWithWebSpeech(clean, voice, speed);
	} else if (engine === 'kitten' || engine === 'kokoro') {
		const voiceName = voice || ENGINES[engine].defaultVoice;
		const context = audioContext();
		const key = await chunkKey({ engine, voice: voiceName, speed, text: clean });
		const cachedBuffer = await loadAudio(context, key);
		if (cachedBuffer) {
			// A re-listen: decode beats another inference pass, every time.
			cached = true;
			play = async () => {
				if (stopped) return;
				await playBuffer(cachedBuffer);
			};
		} else {
			const model = engine === 'kitten' ? await loadKitten() : await loadKokoro();
			const generated = await model.generate(clean, { voice: voiceName, speed });
			const buffer = toBuffer(generated, context);
			void saveAudio(key, buffer.getChannelData(0), buffer.sampleRate);
			play = async () => {
				if (stopped) return;
				await playBuffer(buffer);
			};
		}
	} else {
		const result = await synthesize({ text: clean, engine, voice });
		play = async () => {
			if (stopped) return;
			await playBase64(result.audio, result.mime, speed);
		};
	}

	const genMs = performance.now() - started;
	recordTts({
		engine,
		kind: 'gen',
		ms: genMs,
		chars: clean.length,
		cached,
		session: sessionId,
		at: Date.now()
	});
	return { genMs, chars: clean.length, cached, play };
}

/** Play a `prepare`d chunk, recording how long the audio actually took. */
export async function playPrepared(engine: EngineId, prepared: PreparedSpeech): Promise<void> {
	const started = performance.now();
	try {
		await prepared.play();
	} finally {
		const audioMs = performance.now() - started;
		recordTts({
			engine,
			kind: 'chunk',
			ms: audioMs,
			genMs: prepared.genMs,
			cached: prepared.cached,
			chars: prepared.chars,
			session: sessionId,
			at: Date.now()
		});
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

/**
 * The first chunk is generated before a single sound exists, so it is the one
 * the listener actually waits for: measured cost is ~6 ms per character, which
 * makes a 244-character opener an ~18-second silence and an 80-character one ~5 s.
 * Later chunks are hidden by the lookahead and can stay long.
 */
export const FIRST_CHUNK_CHARS = 80;

/** Cap only the first part; every other chunk is untouched. */
export function firstChunk(parts: string[], maxChars = FIRST_CHUNK_CHARS): string[] {
	const [first, ...rest] = parts;
	if (!first || first.length <= maxChars) return parts;
	const cut = first.slice(0, maxChars);
	const boundary = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
	const head = (boundary > 0 ? cut.slice(0, boundary + 1) : cut).trim();
	return head ? [head, first.slice(head.length).trim(), ...rest] : parts;
}

/** Chunks shorter than this are crumbs — one inference to say a couple of words. */
const MIN_CHUNK = 10;

/** Sentence-ending punctuation followed by whitespace. */
const BOUNDARY = /([.!?])\s+/g;

/**
 * Where a split must NOT happen: an initial ("U.S.", "U.N.") or a common
 * abbreviation ("St.", "Gen."). News text is full of them, and breaking there
 * leaves the listener hearing "U." and "S." as two separate inferences.
 */
const NOT_A_BOUNDARY =
	/(?:^|[^A-Za-z])[A-Z]\.$|(?:^|\s)(?:St|Gen|Dr|Mr|Mrs|Ms|Jr|Sr|Capt|Col|Lt|Sen|Rep|Gov|Prof|Rev|vs|Inc|Ltd|Co|No|Vol|pp|etc|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|e\.g|i\.e|a\.m|p\.m)\.$/;

/**
 * Text → speakable chunks, in the order a listener experiences it:
 * paragraphs first (a heading is never welded onto the paragraph it introduces),
 * then sentences inside each paragraph, then any crumbs `splitLong` leaves
 * glued back onto a neighbour so no inference is spent on two letters.
 */
export function toSentences(text: string): string[] {
	return (
		text
			// Blank lines, LF or CRLF (email bodies are full of \r\n).
			.split(/\r?\n[ \t]*\r?\n/)
			.flatMap(splitParagraph)
			.map((part) => part.trim())
			.filter(Boolean)
			.reduce<string[]>((out, part) => {
				const last = out[out.length - 1];
				const crumb = part.length < MIN_CHUNK;
				if (last && (crumb || last.length < MIN_CHUNK) && `${last} ${part}`.length <= MAX_CHUNK) {
					out[out.length - 1] = `${last} ${part}`;
					return out;
				}
				out.push(part);
				return out;
			}, [])
	);
}

/** One paragraph → abbreviation-aware sentences, then size-capped chunks. */
function splitParagraph(paragraph: string): string[] {
	const sentences: string[] = [];
	let start = 0;
	BOUNDARY.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = BOUNDARY.exec(paragraph))) {
		// Test up to and including the period — the whitespace would defeat the `$`.
		if (NOT_A_BOUNDARY.test(paragraph.slice(0, match.index + 1))) continue;
		const end = match.index + match[0].length;
		sentences.push(paragraph.slice(start, end));
		start = end;
	}
	sentences.push(paragraph.slice(start));

	return sentences
		.map((sentence) => sentence.trim())
		.filter(Boolean)
		.flatMap((sentence) => (sentence.length <= MAX_CHUNK ? [sentence] : splitLong(sentence)));
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
