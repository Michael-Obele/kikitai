---
name: tauri-v2
description: Tauri v2 + SvelteKit thin-client pattern for Kikitai desktop. Use when editing apps/desktop, capabilities, or ONNX WASM playback parity.
---

# Tauri v2 + SvelteKit (`apps/desktop`)

## 1. Static Shell & Monorepo Commands (`vp`)

- **Adapter**: `@sveltejs/adapter-static` with `export const ssr = false;` in `src/routes/+layout.ts`.
- **Tauri Config (`src-tauri/tauri.conf.json`)**: `build.frontendDist: '../build'`, `build.devUrl: 'http://localhost:5174'`.
- **Vite+ (`vp`) Commands**:
  ```bash
  vp -C apps/desktop dev
  vp run -t @kikitai/desktop#build
  ```
- **Rust & Capabilities**: Keep `src-tauri/Cargo.lock` committed and enforce least-privilege permissions in `src-tauri/capabilities/default.json` (`core:default`, `core:window:allow-close/minimize/maximize/start-dragging`, plus file-open/deep-link permissions needed by `/read`).

## 2. COOP/COEP Parity for Multi-Threaded ONNX WASM (`SharedArrayBuffer`)

Tauri v2.1+ supports security response headers directly in `src-tauri/tauri.conf.json` for production builds (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows), while `apps/desktop/vite.config.ts` provides them in dev:

```json
// src-tauri/tauri.conf.json
{
	"app": {
		"security": {
			"headers": {
				"Cross-Origin-Opener-Policy": "same-origin",
				"Cross-Origin-Embedder-Policy": "credentialless"
			}
		}
	}
}
```

```ts
// apps/desktop/vite.config.ts
import { defineConfig } from 'vite-plus';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5174,
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'credentialless'
		}
	}
});
```

## 3. Auth & Desktop UX

- **Auth**: Open system browser (`@tauri-apps/plugin-opener`) → deep-link callback (`@tauri-apps/plugin-deep-link`) with Google `idToken` → `authClient.signIn.social({ provider: 'google', idToken: { token } })` → capture `set-auth-token` header → store Bearer token in OS Keychain. Never embed Gmail refresh tokens on desktop.
- **Desktop `/read` UX**: Recreated for desktop (no `packages/ui`) — frameless custom titlebar, `Cmd/Ctrl+K` paste focus, keyboard shortcuts, window-state restore, `.txt`/`.md` file-open + drag-drop, offline ONNX model-cache indicator, and hybrid TTS (ONNX WASM via CDN + OS Web Speech fallback + cloud opt-in). Dark mode via `mode-watcher` + `src/theme.css` (same contract as web). Probe `SharedArrayBuffer` → `navigator.gpu` (try/catch) → native; never gate on OS strings (`docs/hybrid-tts-matrix.md`).
- **Forms**: plain `onsubmit` + `fetch` to `/api/app/v1/*` — remote functions and `use:enhance` need the app's own server, which a static shell has none of.
- **Toolchain**: `vp fmt` owns formatting (Oxfmt ignores `.svelte`); Prettier keeps `.svelte` only.
- **MCP**: `tauri-docs` remote + `@hypothesi/tauri-mcp-server` stdio for screenshots/IPC/logs.

Primary sources: `v2.tauri.app/start/frontend/sveltekit`, `v2.tauri.app/reference/config/#headers`, `better-auth.com/docs/plugins/bearer`.
