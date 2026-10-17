import { error, type RequestEvent } from '@sveltejs/kit';
import { auth, type Session } from '$lib/server/auth';

/**
 * Strict authentication guard for /api/app/v1/* routes.
 * Throws a clean HTTP 401 when unauthenticated so native HTTP clients
 * can immediately evict invalid tokens.
 */
export async function requireAppSession(event: RequestEvent): Promise<Session> {
	if (event.locals.user && event.locals.session) {
		return { user: event.locals.user, session: event.locals.session } as Session;
	}

	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	if (!session || !session.user || !session.session) {
		throw error(401, { message: 'Unauthorized' });
	}

	event.locals.user = session.user;
	event.locals.session = session.session;

	return session as Session;
}
