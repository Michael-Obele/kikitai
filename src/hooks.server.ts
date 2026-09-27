import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = async (input) => {
	// Cross-origin isolation (COOP + COEP) is what unlocks SharedArrayBuffer, and
	// therefore ONNX Runtime's multi-threaded WASM — the single biggest lever on
	// TTS generation time. `credentialless` keeps cross-origin CDN assets (the
	// jsDelivr model modules, fonts) loading without needing a CORP header.
	input.event.setHeaders({
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'credentialless'
	});
	return handleBetterAuth(input);
};
