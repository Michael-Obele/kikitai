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
		trailingComma: 'none'
	},

	// Pre-commit: `vp staged` (lint-staged 17) runs these against staged files
	// and re-stages fixes. Oxfmt ignores .svelte, Prettier owns it — the two
	// patterns are disjoint on purpose. Hook script: `.vite-hooks/pre-commit`
	// (committed); dispatcher lives in `.vite-hooks/_` (generated, ignored).
	// Typecheck stays in CI — hooks stay fast (format only).
	staged: {
		'**/*.{js,mjs,cjs,mts,cts,ts,json,jsonc,md,mdx,toml,yml,yaml,css}': 'vp fmt --write',
		'**/*.svelte': 'prettier --write'
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
