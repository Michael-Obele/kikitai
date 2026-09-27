import { error } from '@sveltejs/kit';
import { command, form, query } from '$app/server';
import * as v from 'valibot';
import { requireUser } from '$lib/server/session';
import {
	getSettings as loadSettings,
	saveSettings as persistSettings,
	saveVoiceChoice as persistVoiceChoice,
	saveVoiceSpeed as persistVoiceSpeed
} from '$lib/server/settings';
import { settingsFormSchema, ttsEngineSchema, type SettingsDto } from '$lib/types/mail';

export const getSettings = query(async (): Promise<SettingsDto> => {
	const { user } = await requireUser();
	return loadSettings(user.id);
});

/**
 * Save AI endpoint, TTS engine/voice and sync window. `aiKey` is optional —
 * leave it blank to keep the stored key (so the form can mask it).
 */
export const saveSettings = form(settingsFormSchema, async (data) => {
	const { user } = await requireUser();
	if (!data.aiBaseUrl.startsWith('http') && data.aiBaseUrl !== '') {
		error(400, 'The AI base URL must start with http:// or https://');
	}
	const days = data.syncWindowDays;
	if (!Number.isInteger(days) || days < 1 || days > 30) error(400, 'Sync window must be 1–30 days');

	// Speed/ramp are edited through saveVoiceSpeed (menu toggles), not this
	// form — carry whatever is stored so a plain Save never resets them.
	const current = await loadSettings(user.id);

	await persistSettings(user.id, {
		aiBaseUrl: data.aiBaseUrl.trim(),
		aiModel: data.aiModel.trim(),
		aiKey: data.aiKey,
		aiKeySet: Boolean(data.aiKey),
		ttsEngine: data.ttsEngine,
		ttsVoice: data.ttsVoice,
		ttsSpeed: current.ttsSpeed,
		ttsRamp: current.ttsRamp,
		syncWindowDays: days
	});

	void getSettings().refresh();
});

/**
 * Speed menu / auto-ramp toggle: an instant-apply action rather than a form
 * input, so it is a `command`. Signed-out callers (public /read) get rejected —
 * callers swallow that and keep the value session-local.
 */
export const saveVoiceSpeed = command(
	v.object({
		speed: v.pipe(v.number(), v.minValue(0.5), v.maxValue(3)),
		ramp: v.boolean()
	}),
	async ({ speed, ramp }) => {
		const { user } = await requireUser();
		await persistVoiceSpeed(user.id, speed, ramp);
		void getSettings().refresh();
	}
);

/**
 * Engine/voice chosen on the public reader — synced for signed-in users;
 * anonymous callers swallow the rejection and keep their localStorage copy.
 */
export const saveVoiceChoice = command(
	v.object({ engine: ttsEngineSchema, voice: v.string() }),
	async ({ engine, voice }) => {
		const { user } = await requireUser();
		await persistVoiceChoice(user.id, engine, voice);
		void getSettings().refresh();
	}
);
