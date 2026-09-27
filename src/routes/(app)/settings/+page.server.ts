import { getSettings as loadSettings } from '$lib/server/settings';

export async function load({ locals }) {
	return { settings: await loadSettings(locals.user!.id) };
}
