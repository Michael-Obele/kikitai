import { error } from '@sveltejs/kit';
import { form, query } from '$app/server';
import { requireUser } from '$lib/server/session';
import { getSettings as loadSettings, saveSettings as persistSettings } from '$lib/server/settings';
import { settingsFormSchema, type SettingsDto } from '$lib/types/mail';

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

	await persistSettings(user.id, {
		aiBaseUrl: data.aiBaseUrl.trim(),
		aiModel: data.aiModel.trim(),
		aiKey: data.aiKey,
		aiKeySet: Boolean(data.aiKey),
		ttsEngine: data.ttsEngine,
		ttsVoice: data.ttsVoice,
		syncWindowDays: days
	});

	void getSettings().refresh();
});
