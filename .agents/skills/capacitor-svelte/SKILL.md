---
name: capacitor-svelte
description: Capacitor 7 + SvelteKit thin-client pattern for Kikitai mobile. Use when editing apps/mobile, wiring native Google sign-in to Better Auth, or debugging WebView auth/storage.
---

# Capacitor 7 + SvelteKit (`apps/mobile`)

## 1. Static Shell & Monorepo Commands (`vp`)

- **Adapter**: `@sveltejs/adapter-static({ fallback: 'index.html' })` with `export const ssr = false; export const prerender = false;` in `src/routes/+layout.ts` and `webDir: 'build'` in `capacitor.config.ts`.
- **No server code in `apps/mobile`**: No `+page.server.ts`, no SvelteKit Remote Functions, no Drizzle imports. All data flows through `@kikitai/contracts` DTOs + `fetch` to `${PUBLIC_WEB_ORIGIN}/api/app/v1/*`.
- **Build & Sync via Vite+ (`vp`)**:
  ```bash
  vp -C apps/mobile build && npx cap sync
  # Or via transitive Vite Task from root:
  vp run -t @kikitai/mobile#build
  ```
- `capacitor.config.ts` `server.url` is local dev-only (LAN IP) and must never be committed for release builds.

## 2. Better Auth + Native Google Sign-In (`@capawesome/capacitor-google-sign-in`)

- Mobile WebViews run on `capacitor://localhost` (iOS) and `https://localhost` (Android) — both must be in `apps/web`'s `trustedOrigins`.
- Standard browser OAuth redirects break in packaged WebViews. Always obtain an `idToken` natively and exchange it via `authClient.signIn.social`, capturing the `set-auth-token` response header for `bearer({ requireSignature: true })`:
  ```ts
  import { createAuthClient } from 'better-auth/client';
  import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';

  export const authClient = createAuthClient({
  	baseURL: PUBLIC_WEB_ORIGIN,
  	fetchOptions: {
  		onSuccess: async (ctx) => {
  			const token = ctx.response.headers.get('set-auth-token');
  			if (token) await saveSecureBearerToken(token);
  		},
  		auth: {
  			type: 'Bearer',
  			token: () => getSecureBearerToken()
  		}
  	}
  });

  export async function signInWithGoogleNative() {
  	const { idToken } = await GoogleSignIn.signIn();
  	if (!idToken) throw new Error('No ID token returned from GoogleSignIn');
  	return authClient.signIn.social({
  		provider: 'google',
  		idToken: { token: idToken }
  	});
  }
  ```

## 3. Touch UI & Hybrid TTS

- **No `packages/ui`**: Recreate player, bottom-sheet voice picker, and reader settings natively for touch idioms (`viewport-fit=cover`, `env(safe-area-inset-*)`, Capgo native nav/transitions, haptics, MediaSession lock-screen metadata).
- **Dark mode**: `mode-watcher` (`<ModeWatcher />` in `+layout.svelte`) + `src/theme.css` (Tailwind v4 tokens, `.dark` overrides, reader vars) — same contract as `apps/web`.
- **Dev isolation**: `vite.config.ts` `server.headers` carry COOP/COEP so multi-threaded ONNX WASM works in dev.
- **Hybrid TTS Ladder**: ONNX WASM (`kitten` / `kokoro` via jsDelivr CDN) → native OS TTS fallback (`@capacitor-community/text-to-speech` / Web Speech) → cloud opt-in (`/api/app/v1/tts/synthesize`). Probe `SharedArrayBuffer` → `navigator.gpu` (try/catch) → native; skip the WebGPU probe on iOS. Full matrix: `docs/hybrid-tts-matrix.md`.
- **Forms**: plain `onsubmit` + `fetch` to `/api/app/v1/*` is the pattern — SvelteKit remote functions (`query`/`form`/`command`) and `use:enhance` need the app's _own_ server, which a static shell has none of (docs: queries can't run under `adapter-static`). Keep the `pending`/`disabled`/`aria-busy` treatment on submit buttons.
- **Toolchain**: `vp fmt` owns formatting (Oxfmt ignores `.svelte`); Prettier keeps `.svelte` only. Root: `bun run format` / `bun run format:check`.

Primary sources: `capacitorjs.com/solution/svelte`, `capawesome.io/blog/how-to-use-better-auth-in-capacitor-apps`, `better-auth.com/docs/plugins/bearer`, `svelte.dev/docs/kit/adapter-static`.
