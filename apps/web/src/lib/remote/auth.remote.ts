import { env } from '$env/dynamic/private';
import { query } from '$app/server';
import { optionalUser } from '$lib/server/session';

/** What sign-in methods this deployment has configured. */
export const getAuthOptions = query(async () => ({
	google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}));

/** Current user for client components (layouts/pages that need it ad hoc). */
export const getCurrentUser = query(async () => {
	const session = await optionalUser();
	if (!session) return null;
	return {
		id: session.user.id,
		name: session.user.name,
		email: session.user.email,
		image: session.user.image ?? null
	};
});
