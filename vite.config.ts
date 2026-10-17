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


	lint: {
		ignorePatterns: ['**/build/**', '**/.svelte-kit/**', '**/dist/**', '**/node_modules/**'],
		plugins: ['typescript'],
		options: {
			typeAware: true,
			typeCheck: false // svelte-check handles Svelte + TS typechecking
		}
	}
});
