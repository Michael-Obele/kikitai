import { defineConfig } from 'vite-plus';

export default defineConfig({
	// Bare `vp dev`, `vp build`, `vp preview` at the workspace root target apps/web
	defaultPackage: './apps/web',

	// Keep Prettier + prettier-plugin-svelte as the formatter for .svelte files;
	// skip Oxfmt during `vp check` so it never conflicts with Svelte formatting.
	// (Oxfmt ignores .svelte entirely; `vp fmt` owns everything else — run
	// `vp fmt . --write` + `prettier --write "**/*.svelte"`, i.e. `bun run format`.)
	check: {
		fmt: false,
		lint: true
	},

	// Single source of truth for formatting (Oxfmt, Prettier-compatible).
	// .svelte files are not parsed by Oxfmt — they stay on Prettier.
	fmt: {
		singleQuote: true,
		useTabs: true,
		printWidth: 100,
		trailingComma: 'none',
		// Svelte via the official prettier-svelte-plugin routed through Oxfmt
		// (needs the `svelte` package installed). Lets us drop Prettier entirely.
		svelte: true
	},

	// Pre-commit: `vp staged` (lint-staged 17) runs these against staged files
	// and re-stages fixes. One formatter for everything (Oxfmt routes `.svelte`
	// through the official prettier-svelte-plugin via `fmt.svelte`).
	// Typecheck stays in CI — hooks stay fast (format only).
	staged: {
		'**/*.{js,mjs,cjs,mts,cts,ts,json,jsonc,md,mdx,toml,yml,yaml,css,svelte}': 'vp fmt --write'
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
