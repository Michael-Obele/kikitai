import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSession } from '$lib/server/session-guard';
import { syncMail } from '$lib/remote';

export const POST: RequestHandler = async (event) => {
	await requireAppSession(event);
	const result = await syncMail();
	return json(result);
};
