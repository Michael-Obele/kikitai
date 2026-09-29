import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

/** The one scope Kikitai needs: read-only Gmail access. Nothing else. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const normalizeOrigin = (s: string) => s.trim().replace(/\/+$/, '');

/** All public origins: canonical ORIGIN + comma-separated TRUSTED_ORIGINS. */
const allOrigins = [
	env.ORIGIN ? normalizeOrigin(env.ORIGIN) : '',
	...(env.TRUSTED_ORIGINS ?? '')
		.split(',')
		.map(normalizeOrigin)
		.filter(Boolean)
].filter(Boolean) as string[];

const hostOf = (origin: string): string | null => {
	try {
		return new URL(origin).host;
	} catch {
		return null;
	}
};

/**
 * Hosts Better Auth may serve from (dynamic baseURL allow-list).
 * `allowedHosts` are auto-added to `trustedOrigins`; localhost entries get
 * both http + https.
 */
const allowedHosts = [
	...new Set(
		[
			...allOrigins.map(hostOf).filter((h): h is string => Boolean(h)),
			'localhost:5173',
			'localhost:5174',
			'127.0.0.1:5173',
			'127.0.0.1:5174'
		].filter(Boolean)
	)
];

export const auth = betterAuth({
	baseURL: {
		allowedHosts,
		protocol: 'auto',
		fallback: env.ORIGIN || 'http://localhost:5174'
	},
	trustedOrigins: [...new Set(allOrigins)],
	secret: env.BETTER_AUTH_SECRET,
	advanced: { trustedProxyHeaders: true },
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
