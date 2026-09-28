import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { ttsAudio } from '$lib/server/db/schema';

/**
 * Vendor TTS results are remembered so a replay never spends quota again.
 * The key is what produced the bytes, so two users asking for the same words
 * in the same voice share one row — the text is theirs either way.
 */
const MAX_AUDIO_CHARS = 400_000;

export function synthesisKey(engine: string, voice: string, text: string): string {
	return createHash('sha256').update(`${engine}|${voice}|${text}`).digest('hex');
}

/** Cached vendor audio, or null the first time anyone asks for these words. */
export async function cachedSynthesis(
	key: string
): Promise<{ audio: string; mime: string } | null> {
	const [row] = await db.select().from(ttsAudio).where(eq(ttsAudio.key, key));
	return row ? { audio: row.audio, mime: row.mime } : null;
}

/**
 * Remember a synthesis. Never throws: the audio already exists, so a failed
 * write costs a future repeat — it must not fail the play that just worked.
 */
export async function storeSynthesis(
	key: string,
	engine: string,
	audio: string,
	mime: string
): Promise<void> {
	if (audio.length > MAX_AUDIO_CHARS) return;
	try {
		await db
			.insert(ttsAudio)
			.values({ key, engine, mime, audio })
			.onConflictDoNothing({ target: ttsAudio.key });
	} catch (error) {
		console.warn(`[tts] could not cache ${engine} audio: ${String(error)}`);
	}
}
