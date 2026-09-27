import { env } from '$env/dynamic/public';
import { synthesize } from '$lib/remote';

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
		note: 'Tiny local model, Apache-2.0. ~24MB once, then offline forever.',
		downloadMb: 24,
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

const cdn = () => (env.PUBLIC_TTS_CDN || 'https://esm.sh').replace(/\/$/, '');

let kitten: Promise<{
	generate: (text: string, opts?: { voice?: string }) => Promise<GeneratedAudio>;
}> | null = null;
let kokoro: Promise<{
	generate: (text: string, opts?: { voice?: string }) => Promise<GeneratedAudio>;
}> | null = null;

type GeneratedAudio = {
	toAudioBuffer: (ctx: AudioContext) => AudioBuffer;
	data?: Float32Array;
	sampling_rate?: number;
};

async function loadKitten() {
	if (!kitten) {
		kitten = import(/* @vite-ignore */ `${cdn()}/kitten-tts-js`).then((mod: any) =>
			mod.KittenTTS.from_pretrained(TTS_MODELS.kitten)
		);
	}
	return kitten;
}

async function loadKokoro() {
	if (!kokoro) {
		kokoro = import(/* @vite-ignore */ `${cdn()}/kokoro-js`).then((mod: any) =>
			mod.KokoroTTS.from_pretrained(TTS_MODELS.kokoro, { dtype: 'q8', device: 'wasm' })
		);
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

function playBase64(audio: string, mime: string): Promise<void> {
	return new Promise((done, fail) => {
		const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
		const el = new Audio(url);
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

function speakWithWebSpeech(text: string, voice: string): Promise<void> {
	return new Promise((done) => {
		const utterance = new SpeechSynthesisUtterance(text);
		const voices = speechSynthesis.getVoices();
		const match =
			voices.find((v) => v.name === voice) ?? voices.find((v) => v.lang.startsWith('en'));
		if (match) utterance.voice = match;
		utterance.onend = () => done();
		utterance.onerror = () => done();
		speechSynthesis.speak(utterance);
		resolveEnd = () => done();
	});
}

/**
 * Speak one chunk of text with the chosen engine. Resolves when the chunk has
 * finished (or was stopped), so a playlist can advance to the next item.
 */
export async function speak(
	engine: EngineId,
	voice: string,
	text: string,
	onError?: (message: string) => void
): Promise<void> {
	stopped = false;
	const clean = text.trim();
	if (!clean) return;

	try {
		if (engine === 'webspeech') {
			if (typeof speechSynthesis === 'undefined')
				throw new Error('Web Speech is not available here.');
			await speakWithWebSpeech(clean, voice);
			return;
		}

		if (engine === 'kitten') {
			const model = await loadKitten();
			const generated = await model.generate(clean, {
				voice: voice || ENGINES.kitten.defaultVoice
			});
			if (!stopped) await playBuffer(generated.toAudioBuffer(audioContext()));
			return;
		}

		if (engine === 'kokoro') {
			const model = await loadKokoro();
			const generated = await model.generate(clean, {
				voice: voice || ENGINES.kokoro.defaultVoice
			});
			if (!stopped) await playBuffer(generated.toAudioBuffer(audioContext()));
			return;
		}

		const result = await synthesize({ text: clean, engine, voice });
		if (!stopped) await playBase64(result.audio, result.mime);
	} catch (error) {
		onError?.(error instanceof Error ? error.message : String(error));
	}
}

/** Split text into speakable chunks — sentence level is enough for v1. */
export function toSentences(text: string): string[] {
	return (
		text
			.match(/[^.!?]+[.!?]*/g)
			?.map((s) => s.trim())
			.filter(Boolean) ?? [text]
	);
}
