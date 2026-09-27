import { createAuthClient } from 'better-auth/svelte';

/**
 * Browser-side auth client. Gmail scopes are requested at sign-in
 * (see `$lib/server/auth.ts`) together with offline access so Google
 * issues a refresh token.
 */
export const authClient = createAuthClient({
	baseURL: typeof location === 'undefined' ? undefined : location.origin
});

/** Sign in with Google, asking for offline access + consent (refresh token). */
export const signInWithGoogle = () =>
	authClient.signIn.social({
		provider: 'google',
		callbackURL: '/dashboard',
		// Google only hands out a refresh token when `access_type=offline` is sent
		// and the user explicitly consents.
		additionalParams: { access_type: 'offline', prompt: 'consent' }
	});
