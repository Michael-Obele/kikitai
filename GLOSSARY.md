# Glossary

| Term | Meaning |
| ---- | ------- |
| `apps/web` | The current SvelteKit app after `git mv` — the **only** server (Postgres, Better Auth, Gmail, AI, TTS cache). SSR + Remote Functions stay here. |
| `backend` | `apps/web`'s server routes + `/api/app/v1/*` REST. The single source of truth for mail, tokens, settings. |
| `client` | `apps/mobile`, `apps/desktop`, `apps/android-native` — thin shells, no DB/Gmail/AI keys, Bearer over HTTP to `backend`. |
| `read route` | Paste & listen (`/read` on web): paste box + import-from-URL + `Player` (engine/voice, 0.75–3×, auto-ramp, sleep, resume, typography). Flagship on every shell. |
| `Bearer` | Better Auth `bearer({ requireSignature: true })` session transport for native (`set-auth-token` response header → secure storage → `Authorization: Bearer <token>`). Web keeps cookies. |
| `idToken` | Google/Apple identity JWT from a native plugin (Credential Manager, `@capawesome/capacitor-google-sign-in`, Tauri deep-link). Passed to `authClient.signIn.social({ provider: 'google', idToken: { token } })`; never a Gmail token. |
| `vp` (`Vite+`) | VoidZero's unified web toolchain CLI (`vite-plus`) layered on top of Bun workspaces: wraps `vp install`, `vp dev`, `vp build`, `vp check` (Oxlint), and `vp run` (`vpr`) from a single root `vite.config.ts`. |
| `Vite Task` | Built-in monorepo task runner in Vite+ (`vp run` / `vpr`), configured under `run.tasks` in root `vite.config.ts` with automatic file/env fingerprinting and caching in `node_modules/.vite/task-cache`. |
