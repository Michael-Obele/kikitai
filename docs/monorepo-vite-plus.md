# Monorepo Management with Vite+ (`vp`) & Bun Workspaces

Kikitai uses **Vite+** (`vite-plus` / `vp` CLI by VoidZero) layered on top of **Bun workspaces** (`apps/*`, `packages/*`) to manage the monorepo, orchestrate tasks with automatic caching (**Vite Task**), and unify workspace configuration in a single root `vite.config.ts`.

---

## 1. How Vite+ and Bun Workspaces Fit Together

Vite+ does **not** replace Bun's workspace resolution or `bun.lock`. Instead:

- **Bun** owns the workspace dependency graph (`"workspaces": ["apps/*", "packages/*"]` in root `package.json`, `"workspace:*"` links, and `bun.lock`).
- **Vite+ (`vp`)** detects `bun.lock` (or `"packageManager": "bun@1.4.3"`) automatically and wraps package management (`vp install`, `vp add`, `vp remove`), app commands (`vp dev`, `vp build`, `vp preview`), library packaging (`vp pack` via `tsdown`), linting/typechecking (`vp check`, `vp lint` via `Oxlint`), and monorepo task orchestration (`vp run` / `vpr` via **Vite Task**, replacing Turborepo).

---

## 2. Target Directory Structure

```text
kikitai/
├── package.json                 # Workspace root (private: true, workspaces: ["apps/*", "packages/*"])
├── bun.lock                     # Single unified Bun lockfile at root
├── .node-version                # Node 24 pin for vp / native toolchains
├── vite.config.ts               # Root Vite+ config: defaultPackage, run.tasks, lint, check
├── apps/
│   ├── web/                     # Current SvelteKit app (SSR, Remote Functions, /api/app/v1/*, DB, Auth)
│   │   ├── package.json         # "@kikitai/web"
│   │   ├── vite.config.ts       # SvelteKit + Tailwind v4 + workerIsolationHeaders
│   │   ├── drizzle.config.ts
│   │   ├── compose.yaml
│   │   ├── Dockerfile
│   │   ├── netlify.toml
│   │   └── src/
│   ├── mobile/                  # Capacitor 7 + SvelteKit (adapter-static, ssr: false)
│   ├── desktop/                 # Tauri v2 + SvelteKit (adapter-static, ssr: false, src-tauri/)
│   └── android-native/          # Kotlin 2.4.10 + Compose M3 Expressive 1.4.0 (Gradle)
└── packages/
    └── contracts/               # Shared Valibot DTOs (mail, settings, importUrl)
        ├── package.json         # "@kikitai/contracts"
        └── src/index.ts
```

---

## 3. Step-by-Step Setup & Migration (`T1`)

Per the [Vite+ Migration Rules](https://viteplus.dev/guide/migrate-rules), **`vp migrate` on a monorepo must run from the workspace root** — Vite+ cannot migrate a single workspace member in isolation because it reconciles shared overrides, dependency catalogs, and the root lockfile.

### Step 3.1: Move Current Tree to `apps/web`

Move the existing SvelteKit app into `apps/web` via `git mv` so relative paths inside `apps/web` (`./src/lib/server/db/schema.ts`, `../drizzle.config.ts`) remain intact.

### Step 3.2: Create Root `package.json` & `packages/contracts`

Create the workspace root `package.json` and pin `vite` / `vitest` overrides for Bun:

```json
{
	"name": "kikitai-monorepo",
	"private": true,
	"packageManager": "bun@1.4.3",
	"workspaces": ["apps/*", "packages/*"],
	"scripts": {
		"dev": "vp dev",
		"build": "vp run -r build",
		"check": "vp run -r check",
		"lint": "vp check",
		"format": "prettier --write ."
	},
	"devDependencies": {
		"prettier": "^3.8.3",
		"prettier-plugin-svelte": "^4.1.0",
		"prettier-plugin-tailwindcss": "^0.8.0",
		"typescript": "^6.0.3",
		"vite-plus": "^1.3.0"
	},
	"overrides": {
		"vite": "npm:@voidzero-dev/vite-plus-core@^1.3.0"
	}
}
```

> **Bun Peer Resolution Rule (from Vite+ docs):**
> In a Bun workspace, `overrides.vite` points all transitive `vite` imports to `npm:@voidzero-dev/vite-plus-core@<version>` (preventing duplicate Vite instances across plugins), **and** `apps/web/package.json` keeps `"vite": "npm:@voidzero-dev/vite-plus-core@<version>"` as a direct `devDependency` so Bun's peer resolver sees the provider before applying overrides.

### Step 3.3: Install or Invoke `vp` and Run `vp migrate`

Install the global `vp` CLI (or run one-shot via `npx` on Node `^22.18.0 || ^24.11.0 || >=26.0.0`):

```bash
# Option A: Install global CLI
curl -fsSL https://vite.plus | bash

# Option B: Run migrator directly from workspace root without global install
npx --package=vite-plus@latest vp migrate --no-interactive --no-hooks
```

What `vp migrate` updates automatically:

1. Aligns `vite-plus` and `vite` (`@voidzero-dev/vite-plus-core`) versions across root and `apps/*`.
2. Rewrites `import { defineConfig } from 'vite'` to `import { defineConfig } from 'vite-plus'` in config entry files (`vite.config.ts`), while preserving `type Plugin` or runtime imports from `'vite'`.
3. Rewrites `vite dev` / `vite build` / `vite preview` scripts to `vp dev` / `vp build` / `vp preview`.

### Step 3.4: Configure Root `vite.config.ts`

At the workspace root, `vite.config.ts` configures `defaultPackage`, **Vite Task (`run`)**, and **Oxlint (`lint`)**:

```ts
// vite.config.ts (workspace root)
import { defineConfig } from 'vite-plus';

export default defineConfig({
	// Bare `vp dev`, `vp build`, `vp preview` at the workspace root target apps/web
	defaultPackage: './apps/web',

	// Keep Prettier + prettier-plugin-svelte as the formatter for .svelte files;
	// skip Oxfmt during `vp check` so it never conflicts with Svelte formatting.
	check: {
		fmt: false,
		lint: true
	},

	// Vite Task: dependency-aware monorepo task runner with automatic file/output caching
	run: {
		enablePrePostScripts: true,
		cache: {
			scripts: false,
			tasks: true
		},
		tasks: {
			build: {
				command: 'vp build',
				dependsOn: [{ task: 'build', from: ['dependencies', 'devDependencies'] }],
				cache: {
					env: ['KIT_ADAPTER', 'NETLIFY', 'PUBLIC_*'],
					input: [{ auto: true }, '!.svelte-kit/**', '!build/**', '!dist/**']
				}
			},
			check: {
				command: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json',
				dependsOn: [{ task: 'build', from: ['dependencies', 'devDependencies'] }],
				cache: {
					input: [{ auto: true }, '!.svelte-kit/**', '!build/**'],
					output: []
				}
			}
		}
	},

	lint: {
		ignorePatterns: ['**/build/**', '**/.svelte-kit/**', '**/dist/**', '**/node_modules/**'],
		plugins: ['typescript'],
		options: {
			typeAware: true,
			typeCheck: false // svelte-check handles Svelte + TS typechecking
		}
	}
});
```

---

## 4. Command Reference (`vp` vs `vp run` / `vpr`)

### Built-in Commands vs. Workspace Tasks

Vite+ strictly separates **built-in toolchain commands** from **`package.json` scripts / `run.tasks`**:

| Command                              | What it executes                                                                      |
| :----------------------------------- | :------------------------------------------------------------------------------------ |
| `vp install`                         | Detects `bun.lock` and runs `bun install` across all workspaces                       |
| `vp add <pkg> --filter @kikitai/web` | Adds a dependency to a specific workspace package                                     |
| `vp dev`                             | Runs `vp -C apps/web dev` automatically via `defaultPackage: './apps/web'`            |
| `vp -C apps/mobile dev`              | Runs `vp dev` as if `cd apps/mobile` was run first (`process.cwd()` is `apps/mobile`) |
| `vp run <task>` (or `vpr <task>`)    | Runs a task from `vite.config.ts#run.tasks` (cached) or script from `package.json`    |
| `vp run -r build` (`vpr -r build`)   | Runs `build` across all workspace packages in topological dependency order            |
| `vp run -t @kikitai/web#build`       | Runs `build` in `@kikitai/web` and all of its transitive workspace dependencies       |
| `vp run --filter ./apps/web db:push` | Runs `db:push` script scoped to `apps/web`                                            |
| `vp run -r -v build`                 | Prints the Vite+ Task Runner Execution Summary with cache hit rates and time saved    |
| `vp cache clean`                     | Clears `node_modules/.vite/task-cache`                                                |

---

## 5. CI Integration (`voidzero-dev/setup-vp`)

In GitHub Actions (`T8`), `voidzero-dev/setup-vp` replaces manual Node, Bun, and dependency-cache steps:

1. **Pin an exact version or SHA** of `voidzero-dev/setup-vp` (never `@v1`, which is frozen).
2. **`setup-vp` runs `vp install` automatically** and caches package-manager data when `cache: true`.
3. **Vite Task Cache**: `node_modules/.vite/task-cache` can be restored after `setup-vp` using `actions/cache/restore@v6` and saved with `actions/cache/save@v6` using a rolling key (`vite-task-${{ runner.os }}-${{ runner.arch }}-${{ github.run_id }}-${{ github.run_attempt }}`).

---

## 6. Commit Hooks (`vp staged`, no husky)

Formatting is enforced at commit time, not just in CI. Root `vite.config.ts`
carries a `staged` block (lint-staged 17 semantics — matched staged files are
passed to the command and fixes re-staged automatically):

```ts
staged: {
	'**/*.{js,mjs,cjs,mts,cts,ts,json,jsonc,md,mdx,toml,yml,yaml,css,svelte}': 'vp fmt --write'
}
```

One formatter for everything: Oxfmt routes `.svelte` through the official
prettier-svelte-plugin (enabled via `fmt.svelte` in the root config, needs
the `svelte` package — already in every app). There is no Prettier install
anywhere in the repo; `prettier.config.js` is deleted and `.prettierignore`
survives only as the shared ignore file both tools historically read.

Wiring (all committed except the generated dispatcher):

| Piece                           | Path                                 | Committed?                   |
| ------------------------------- | ------------------------------------ | ---------------------------- |
| Project hook (`bunx vp staged`) | `.vite-hooks/pre-commit`             | yes                          |
| Dispatcher + shims              | `.vite-hooks/_`                      | no (`.gitignore`, recreated) |
| Auto-install on `bun install`   | root `prepare: vp config --no-agent` | yes (`package.json`)         |

Useful commands: `vp hooks status` (what's active in this clone),
`vp hooks disable` (opt out locally, survives reinstalls),
`VP_GIT_HOOKS=0 git commit …` (skip once). Fresh clones get hooks from the
next `bun install`; existing clones run `vp hooks enable` once.

Runners are pinned to `ubuntu-24.04` (not `ubuntu-latest`, which migrates to
Ubuntu 26) and actions to Node-24 majors (`actions/checkout@v6`,
`actions/setup-java@v6`, `android-actions/setup-android@v4`,
`gradle/actions/setup-gradle@v6`).

1. **Pin an exact version or SHA** of `voidzero-dev/setup-vp` (never `@v1`, which is frozen).
2. **`setup-vp` runs `vp install` automatically** and caches package-manager data when `cache: true`.
3. **Vite Task Cache**: `node_modules/.vite/task-cache` can be restored after `setup-vp` using `actions/cache/restore@v6` and saved with `actions/cache/save@v6` using a rolling key (`vite-task-${{ runner.os }}-${{ runner.arch }}-${{ github.run_id }}-${{ github.run_attempt }}`).
