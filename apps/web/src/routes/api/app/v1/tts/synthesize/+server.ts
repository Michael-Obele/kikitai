import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { synthesizeInputSchema } from '@kikitai/contracts';
import { requireAppSession } from '$lib/server/session-guard';
import { synthesize } from '$lib/remote';

export const POST: RequestHandler = async (event) => {
	await requireAppSession(event);

	let body: unknown;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, { message: 'Invalid JSON request body' });
	}

	const parsed = v.safeParse(synthesizeInputSchema, body);
	if (!parsed.success) {
		throw error(400, { message: parsed.issues[0]?.message ?? 'Invalid synthesize input' });
	}

	const engine = parsed.output.engine === 'minimax' ? 'minimax' : 'google';
	const result = await synthesize({
		text: parsed.output.text,
		engine,
		voice: parsed.output.voice ?? ''
	});
	return json(result);
};
