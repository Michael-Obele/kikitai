import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSession } from '$lib/server/session-guard';
import { getMessage } from '$lib/remote';

export const GET: RequestHandler = async (event) => {
	await requireAppSession(event);
	const id = event.params.id;

	if (!id) {
		throw error(400, { message: 'Missing message id' });
	}

	const message = await getMessage(id);
	if (!message) {
		throw error(404, { message: 'Message not found' });
	}

	return json(message);
};
