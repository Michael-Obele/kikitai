import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';
import { decrypt, encrypt, isEncrypted } from '$lib/server/tokens';
import type { SettingsDto, TtsEngine } from '$lib/types/mail';
import type { AiConfig } from './ai';

const DEFAULT_MODEL = 'gpt-4o-mini';

function envOrDefault(key: keyof typeof env, fallback = ''): string {
	const value = env[key];
	return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Effective settings: the user's row, falling back to env defaults so a fresh
 * install works with zero configuration (config-over-hardcoded rule: nothing
 * provider-specific lives in code).
 */
export async function getSettings(userId: string): Promise<SettingsDto> {
	const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
	const aiKey = row?.aiKey ? decrypt(row.aiKey) : envOrDefault('AI_KEY');
	return {
		aiBaseUrl: row?.aiBaseUrl || envOrDefault('AI_BASE_URL'),
		aiModel: row?.aiModel || envOrDefault('AI_MODEL', DEFAULT_MODEL),
		aiKey,
		aiKeySet: Boolean(aiKey),
		ttsEngine: (row?.ttsEngine as TtsEngine) || (envOrDefault('TTS_ENGINE', 'kitten') as TtsEngine),
		ttsVoice: row?.ttsVoice || 'expr-voice-2-f',
		ttsSpeed: row?.ttsSpeed ?? 1,
		ttsRamp: row?.ttsRamp ?? false,
		syncWindowDays: row?.syncWindowDays ?? 7
	};
}

export async function saveSettings(userId: string, input: SettingsDto): Promise<void> {
	const [row] = await db.select().from(settings).where(eq(settings.userId, userId));
	// An empty key field means "keep whatever is stored".
	const keyToStore =
		input.aiKey && input.aiKey.length > 0
			? encrypt(input.aiKey)
			: (row?.aiKey ?? encrypt(envOrDefault('AI_KEY')));

	await db
		.insert(settings)
		.values({
			userId,
			aiBaseUrl: input.aiBaseUrl,
			aiKey: keyToStore,
			aiModel: input.aiModel,
			ttsEngine: input.ttsEngine,
			ttsVoice: input.ttsVoice,
			ttsSpeed: input.ttsSpeed,
			ttsRamp: input.ttsRamp,
			syncWindowDays: input.syncWindowDays,
			updatedAt: new Date()
		})
		.onConflictDoUpdate({
			target: settings.userId,
			set: {
				aiBaseUrl: input.aiBaseUrl,
				aiKey: keyToStore,
				aiModel: input.aiModel,
				ttsEngine: input.ttsEngine,
				ttsVoice: input.ttsVoice,
				ttsSpeed: input.ttsSpeed,
				ttsRamp: input.ttsRamp,
				syncWindowDays: input.syncWindowDays,
				updatedAt: new Date()
			}
		});
}

/**
 * Persist only the voice speed/ramp (the player's speed menu). Inserts a row
 * when the user has never saved settings, so a fresh install can still ramp.
 */
export async function saveVoiceSpeed(userId: string, speed: number, ramp: boolean): Promise<void> {
	await db
		.insert(settings)
		.values({ userId, ttsSpeed: speed, ttsRamp: ramp })
		.onConflictDoUpdate({
			target: settings.userId,
			set: { ttsSpeed: speed, ttsRamp: ramp, updatedAt: new Date() }
		});
}

/** Config the AI pipeline uses. `null` when no endpoint is configured. */
export async function getAiConfig(userId: string): Promise<AiConfig | null> {
	const s = await getSettings(userId);
	if (!s.aiBaseUrl || !s.aiModel) return null;
	return { baseUrl: s.aiBaseUrl, apiKey: s.aiKey ?? '', model: s.aiModel };
}
