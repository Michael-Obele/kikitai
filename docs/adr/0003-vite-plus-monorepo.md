# ADR 0003 — Bun Workspaces + Vite+ (`vp`) Monorepo, No Turborepo

**Status:** Accepted (2026-10-18).
**Context:** Single-package SvelteKit app must become `apps/*` + `packages/*` without breaking `bun run dev`, `db:push`, Docker, or Netlify.
**Decision:** Bun owns workspaces (`"workspaces": ["apps/*", "packages/*"]`, `workspace:*` links, root `bun.lock`, `packageManager: bun@1.4.3`). Vite+ (`vite-plus` / `vp`) owns root `vite.config.ts` (`defaultPackage: './apps/web'`, `check.fmt: false`, Oxlint `lint`), task orchestration (`vp run` / `vpr` Vite Task with cache in `node_modules/.vite/task-cache`), and wrapping (`vp install`/`vp dev`/`vp build`/`vp check`). No Turborepo until builds prove slow. `vite` overridden to `npm:@voidzero-dev/vite-plus-core@^1.3.0` at root + direct devDep in `apps/web`.
**Alternatives considered:** (a) Turborepo — rejected: extra daemon/config for a 4-app repo; Vite Task covers caching/topology; (b) pnpm workspaces — rejected: repo is Bun-first (`bun.lock`, `bun run`, Drizzle via Bun).
**Consequences:** Root scripts are `dev: vp dev`, `lint: vp check`, `format: prettier --write .`. Per-app builds via `vp -C apps/<name> <cmd>` or `vp run -t @kikitai/<name>#build`. CI uses `voidzero-dev/setup-vp@<exact-version>` + `actions/cache` for `node_modules/.vite/task-cache`. See `docs/monorepo-vite-plus.md`.
