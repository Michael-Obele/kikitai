import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// SvelteKit experimental flags (top-level `experimental` is split:
			// SvelteKit flags go to `kit`, the rest to vite-plugin-svelte).
			experimental: { remoteFunctions: true },
			vitePlugin: {
				inspector: {
					toggleKeyCombo: 'alt-x',
					showToggleButton: 'active',
					toggleButtonPos: 'bottom-left'
				}
			},
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,

				// Required by SvelteKit remote functions (`await` in components).
				experimental: { async: true }
			},

			// adapter-node runs the standalone server `node build/index.js` —
			// exactly what the Docker image in this repo starts.
			adapter: adapter(),

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	]
});
