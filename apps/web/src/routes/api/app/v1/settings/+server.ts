import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { settingsUpdateSchema } from '@kikitai/contracts';
import { requireAppSession } from '$lib/server/session-guard';
import { getSettings, saveSettings } from '$lib/server/settings';

export const GET: RequestHandler = async (event) => {
	const session = await requireAppSession(event);
	const settings = await getSettings(session.user.id);
	return json({
		...settings,
		aiKey: ''
	});
};

export const PUT: RequestHandler = async (event) => {
	const session = await requireAppSession(event);

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, { message: 'Invalid JSON request body' });
	}

	const parsed = v.safeParse(settingsUpdateSchema, body);
	if (!parsed.success) {
		throw error(400, { message: parsed.issues[0]?.message ?? 'Invalid settings input' });
	}

	const current = await getSettings(session.user.id);
	await saveSettings(session.user.id, {
		aiBaseUrl: (parsed.output.aiBaseUrl ?? current.aiBaseUrl).trim(),
		aiModel: (parsed.output.aiModel ?? current.aiModel).trim(),
		aiKey: parsed.output.aiKey !== undefined ? parsed.output.aiKey : current.aiKey,
		aiKeySet: current.aiKeySet,
		ttsEngine: parsed.output.ttsEngine ?? current.ttsEngine,
		ttsVoice: parsed.output.ttsVoice ?? current.ttsVoice,
		ttsSpeed: parsed.output.ttsSpeed ?? current.ttsSpeed,
		ttsRamp: parsed.output.ttsRamp ?? current.ttsRamp,
		syncWindowDays: parsed.output.syncWindowDays ?? current.syncWindowDays
	});

	const updated = await getSettings(session.user.id);
	return json({
		...updated,
		aiKey: ''
	});
};
