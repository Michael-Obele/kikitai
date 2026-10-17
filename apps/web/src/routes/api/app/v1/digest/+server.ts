import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSession } from '$lib/server/session-guard';
import { getDigest } from '$lib/remote';

export const GET: RequestHandler = async (event) => {
	await requireAppSession(event);
	const digest = await getDigest();
	return json(digest);
};
