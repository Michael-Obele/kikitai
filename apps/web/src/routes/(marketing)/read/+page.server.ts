import { getSettings } from '$lib/server/settings';

/**
 * Public reader settings: signed-in users get their saved voice/speed, everyone
 * else gets defaults. Never redirects — `/read` must work without an account.
 */
export async function load({ locals }) {
	if (!locals.user) return { settings: null };
	const s = await getSettings(locals.user.id);
	return {
		settings: {
			ttsEngine: s.ttsEngine,
			ttsVoice: s.ttsVoice,
			ttsSpeed: s.ttsSpeed,
			ttsRamp: s.ttsRamp
		}
	};
}
