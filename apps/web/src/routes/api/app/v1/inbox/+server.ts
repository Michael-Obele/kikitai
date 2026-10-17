import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { inboxFilterSchema } from '@kikitai/contracts';
import { requireAppSession } from '$lib/server/session-guard';
import { getInbox } from '$lib/remote';

export const GET: RequestHandler = async (event) => {
	await requireAppSession(event);

	const url = event.url;
	const rawParams = {
		category: url.searchParams.get('category') ?? undefined,
		priority: url.searchParams.get('priority') ?? undefined,
		search: url.searchParams.get('search') ?? undefined,
		limit: url.searchParams.get('limit') ?? undefined,
		offset: url.searchParams.get('offset') ?? undefined
	};

	const parsed = v.parse(inboxFilterSchema, rawParams);
	const inbox = await getInbox(parsed);
	return json(inbox);
};
