import type { Handle, RequestEvent } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';

/**
 * Guardrail probes need a signed-in reader, and credentials are never typed
 * into an automated browser — so dev servers can sign a request in as a seeded
 * test user instead, identified by the `kikitai_dev_user` cookie.
 *
 * Two independent gates keep this out of production:
 * 1. `import.meta.env.DEV` is compiled to `false` by `vite build`, so the whole
 *    branch below tree-shakes out of every production bundle — a cookie alone
 *    can never sign anyone in.
 * 2. The id must look like a row `tests/guardrails` created (`guardrail-…`), so
 *    a stray cookie in a dev session can only ever name a probe account.
 *
 * A cookie (not an env var, not a header) on purpose: it works even when the
 * dev server was started before this shim existed, and it is only ever sent
 * to this origin — never to the CDN the TTS models load from.
 */
const DEV_USER_COOKIE = 'kikitai_dev_user';
const DEV_USER_ID = /^guardrail-[a-z0-9-]{1,40}$/;

/** Read one cookie out of a raw `Cookie` header (no parser dependency). */
function readCookie(header: string | null, name: string): string | null {
	if (!header) return null;
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=');
		if (key === name) return decodeURIComponent(rest.join('='));
	}
	return null;
}

/** The test user id this request asks to run as — `null` outside `vite dev`. */
function devFakeUser(event: RequestEvent): string | null {
	if (building || !import.meta.env.DEV) return null;
	// Better Auth owns its own routes; never shadow a real sign-in there.
	if (event.url.pathname.startsWith('/api/auth')) return null;
	const id = readCookie(event.request.headers.get('cookie'), DEV_USER_COOKIE);
	return id && DEV_USER_ID.test(id) ? id : null;
}

/**
 * Locals that satisfy `requireUser()` the same way a real Google session does.
 * Nothing is looked up: the row behind the id is seeded by the harness
 * (`tests/guardrails/global-setup.ts`), so settings and mail resolve normally.
 */
function useDevFakeUser(event: RequestEvent, id: string): void {
	const now = new Date();
	event.locals.user = {
		id,
		name: 'Guardrail probe',
		email: `${id}@example.test`,
		emailVerified: true,
		image: null,
		createdAt: now,
		updatedAt: now
	};
	event.locals.session = {
		id: 'guardrail-probe-session',
		userId: id,
		token: 'guardrail-probe-token',
		expiresAt: new Date(now.getTime() + 60 * 60_000),
		createdAt: now,
		updatedAt: now
	};
}

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	} else {
		const fake = devFakeUser(event);
		if (fake) useDevFakeUser(event, fake);
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
