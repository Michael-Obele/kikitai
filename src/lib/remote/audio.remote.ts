import { error } from '@sveltejs/kit';
import { command } from '$app/server';
import { env } from '$env/dynamic/private';
import * as v from 'valibot';
import { requireUser } from '$lib/server/session';
import { cachedSynthesis, storeSynthesis, synthesisKey } from '$lib/server/tts-cache';

const requestSchema = v.object({
	text: v.pipe(v.string(), v.minLength(1), v.maxLength(4000)),
	engine: v.picklist(['google', 'minimax']),
	voice: v.optional(v.string(), '')
});

/**
 * Cloud TTS **only** — the default engines (`kitten`, `kokoro`, `webspeech`)
 * never reach this endpoint: they synthesize in the browser. Used when the
 * user opts into Google (free tier) or MiniMax in Settings.
 */
export const synthesize = command(requestSchema, async ({ text, engine, voice }) => {
	await requireUser();

	// Said these exact words in this voice before? The bytes are in Postgres —
	// no vendor round trip, no quota, no cost for a replay.
	const key = synthesisKey(engine, voice ?? '', text);
	const cached = await cachedSynthesis(key);
	if (cached) return cached;

	if (engine === 'google') {
		const key = env.GOOGLE_TTS_KEY;
		if (!key) error(400, 'Add GOOGLE_TTS_KEY to your environment to use Google TTS.');
		const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				input: { text },
				voice: { name: voice || 'en-US-Neural2-C', languageCode: (voice || 'en-US').slice(0, 5) },
				audioConfig: { audioEncoding: 'MP3' }
			})
		});
		if (!res.ok) error(502, `Google TTS failed: ${res.status} ${await res.text()}`);
		const data = (await res.json()) as { audioContent?: string };
		if (!data.audioContent) error(502, 'Google TTS returned no audio.');
		await storeSynthesis(key, engine, data.audioContent, 'audio/mpeg');
		return { audio: data.audioContent, mime: 'audio/mpeg' };
	}

	const apiKey = env.MINIMAX_API_KEY;
	const groupId = env.MINIMAX_GROUP_ID;
	if (!apiKey || !groupId)
		error(400, 'Add MINIMAX_API_KEY and MINIMAX_GROUP_ID to your environment.');
	const res = await fetch(`https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: 'speech-02-hd',
			text,
			voice_setting: { voice_id: voice || 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 },
			audio_setting: { format: 'mp3', sample_rate: 32000 }
		})
	});
	if (!res.ok) error(502, `MiniMax TTS failed: ${res.status} ${await res.text()}`);
	const data = (await res.json()) as {
		data?: { audio?: string };
		base_resp?: { status_code?: number };
	};
	if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
		error(502, `MiniMax TTS error ${data.base_resp.status_code}`);
	}
	if (!data.data?.audio) error(502, 'MiniMax TTS returned no audio.');
	await storeSynthesis(key, engine, data.data.audio, 'audio/mpeg');
	return { audio: data.data.audio, mime: 'audio/mpeg' };
});
