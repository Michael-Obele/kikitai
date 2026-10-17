import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import type { Session } from './auth';

/** Session + user for the current request, or `null` when signed out. */
export async function getSession(): Promise<Session | null> {
	const event = getRequestEvent();
	const user = event.locals.user;
	const session = event.locals.session;
	if (!user || !session) return null;
	return { user, session } as Session;
}

/** Same as {@link getSession} but throws a 401 for signed-out requests. */
export async function requireUser(): Promise<Session> {
	const session = await getSession();
	if (!session) error(401, 'You need to sign in first.');
	return session;
}

/** Same as {@link requireUser} but returns `null` instead of throwing. */
export async function optionalUser(): Promise<Session | null> {
	return getSession();
}
