import tailwindcss from '@tailwindcss/vite';
import adapterNetlify from '@sveltejs/adapter-netlify';
import adapterNode from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

/** Build target: `node` (local + Docker) or `netlify` (Netlify deploy). */
type AdapterTarget = 'node' | 'netlify';

/**
 * Which adapter `vite build` emits for.
 *
 * - Netlify sets `NETLIFY=true` in its build environment, so a deploy from Git
 *   picks `adapter-netlify` with no extra config (SSR becomes a Netlify
 *   Function, static assets publish from `build/` — see `netlify.toml`).
 * - Everything else — local `bun run build` and the Docker image — keeps
 *   `adapter-node`, i.e. the standalone `bun build/index.js` server.
 *
 * Force either one with `KIT_ADAPTER=node` / `KIT_ADAPTER=netlify`.
 */
const target = (process.env.KIT_ADAPTER ??
	(process.env.NETLIFY ? 'netlify' : 'node')) as AdapterTarget;

if (target !== 'node' && target !== 'netlify') {
	throw new Error(`Unknown KIT_ADAPTER "${target}" — expected "node" or "netlify"`);
}

const adapter = target === 'netlify' ? adapterNetlify() : adapterNode();

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

			// `node` → standalone server `node build/index.js` (what the Docker image
			// starts); `netlify` → Netlify Function. See the `target` note above.
			adapter,

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	]
});
