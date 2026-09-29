import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/** The one scope Kikitai needs: read-only Gmail access. Nothing else. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const trustedOrigins = [
	env.ORIGIN,
	...(env.TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
].filter(Boolean) as string[];

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	trustedOrigins,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	// Google is the ONLY sign-in method: a deployment left reachable on the internet must not be
	// sign-uppable on (only the Google consent-screen test users can get in). See docs/google-oauth.md.
	emailAndPassword: { enabled: false },
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID || '',
			clientSecret: env.GOOGLE_CLIENT_SECRET || '',
			// Read mail from day one (decision 2: `gmail.readonly` only).
			scope: ['email', 'profile', GMAIL_SCOPE],
			prompt: 'consent'
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});

export type Session = typeof auth.$Infer.Session;
