import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
import { createAuthClient } from 'better-auth/client';

const KEY = 'kikitai.bearer';

export function loadBearer(): string {
	try {
		return localStorage.getItem(KEY) ?? '';
	} catch {
		return '';
	}
}

export function saveBearer(token: string): void {
	try {
		if (token) localStorage.setItem(KEY, token);
	} catch {
		/* private mode — memory only */
	}
}

export function clearBearer(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* noop */
	}
}

/** ponytail: localStorage now; swap to secure storage plugin when available. */
export function createMobileAuthClient(webOrigin: string) {
	return createAuthClient({
		baseURL: webOrigin,
		fetchOptions: {
			onSuccess: (ctx) => {
				const token = ctx.response.headers.get('set-auth-token');
				if (token) saveBearer(token);
			},
			auth: { type: 'Bearer', token: () => loadBearer() }
		}
	});
}

/**
 * Native Google sign-in. The plugin MUST be initialized once with the Google
 * **web** client ID (same `GOOGLE_CLIENT_ID` the backend uses) before sign-in;
 * the returned identity `idToken` is exchanged server-side — Gmail tokens never
 * touch the device. Native only: on web the plugin redirects instead of resolving.
 */
export async function signInWithGoogleNative(
	authClient: ReturnType<typeof createMobileAuthClient>,
	webClientId: string
) {
	await GoogleSignIn.initialize({ clientId: webClientId });
	const { idToken } = await GoogleSignIn.signIn();
	if (!idToken) throw new Error('Google sign-in returned no ID token');
	return authClient.signIn.social({ provider: 'google', idToken: { token: idToken } });
}
