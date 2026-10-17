import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { organizeInputSchema } from '@kikitai/contracts';
import { requireAppSession } from '$lib/server/session-guard';
import { organizeMail, regenerateSummary } from '$lib/remote';

export const POST: RequestHandler = async (event) => {
	await requireAppSession(event);

	let body: unknown = {};
	try {
		body = await event.request.json();
	} catch {
		// Empty body triggers batch organize
	}

	const parsed = v.parse(organizeInputSchema, body);
	if (parsed.messageId) {
		const result = await regenerateSummary(parsed.messageId);
		return json({ success: true, message: result });
	}

	const result = await organizeMail();
	return json(result);
};
