import type { EngineId } from './index';

/**
 * Synthesized audio, kept on-device: re-listening to the same email decodes a
 * WAV instead of running inference again. Nothing leaves the browser, and the
 * key is a hash — the text never appears in storage.
 */
const CACHE_NAME = 'tts-audio';
/** 16-bit mono @ 24 kHz ≈ 2.9 MB per minute — refuse anything greedy. */
const MAX_WAV_BYTES = 8 * 1024 * 1024;

/** Everything that changes the waveform, hashed. */
export async function chunkKey(parts: {
	engine: EngineId;
	voice: string;
	speed: number;
	text: string;
}): Promise<string> {
	const raw = `${parts.engine}|${parts.voice}|${parts.speed}|${parts.text}`;
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Cached audio for this key, decoded — or null and the caller synthesizes. */
export async function loadAudio(context: AudioContext, key: string): Promise<AudioBuffer | null> {
	if (typeof caches === 'undefined') return null;
	try {
		const cache = await caches.open(CACHE_NAME);
		const hit = await cache.match(`/${key}`);
		if (!hit) return null;
		return await context.decodeAudioData(await hit.arrayBuffer());
	} catch {
		return null; // corrupt entry — re-synthesize rather than fail the play
	}
}

/** Store one chunk. Fire-and-forget: a quota miss only costs a future re-synthesis. */
export async function saveAudio(
	key: string,
	data: Float32Array,
	sampleRate: number
): Promise<void> {
	if (typeof caches === 'undefined') return;
	const wav = encodeWav(data, sampleRate);
	if (wav.byteLength > MAX_WAV_BYTES) return;
	try {
		const cache = await caches.open(CACHE_NAME);
		await cache.put(`/${key}`, new Response(wav, { headers: { 'content-type': 'audio/wav' } }));
	} catch {
		/* quota — fine */
	}
}

/** 16-bit PCM WAV: the one container `decodeAudioData` handles everywhere. */
function encodeWav(data: Float32Array, sampleRate: number): ArrayBuffer {
	const buffer = new ArrayBuffer(44 + data.length * 2);
	const view = new DataView(buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	ascii(0, 'RIFF');
	view.setUint32(4, 36 + data.length * 2, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate
	view.setUint16(32, 2, true); // block align
	view.setUint16(34, 16, true); // bits per sample
	ascii(36, 'data');
	view.setUint32(40, data.length * 2, true);

	let offset = 44;
	for (let i = 0; i < data.length; i++, offset += 2) {
		const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
		view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
	}
	return buffer;
}
