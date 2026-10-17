import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as v from 'valibot';
import { importUrlInputSchema } from '@kikitai/contracts';
import { importFromUrl, ImportFailure } from '$lib/server/import-url';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, { message: 'Invalid JSON request body' });
	}

	const parsed = v.safeParse(importUrlInputSchema, body);
	if (!parsed.success) {
		throw error(400, { message: parsed.issues[0]?.message ?? 'Invalid URL parameter' });
	}

	try {
		const { title, text } = await importFromUrl(parsed.output.url);
		return json({
			title,
			text,
			url: parsed.output.url
		});
	} catch (err) {
		if (err instanceof ImportFailure) {
			throw error(422, { message: err.message });
		}
		throw error(500, { message: 'Failed to import page content' });
	}
};
