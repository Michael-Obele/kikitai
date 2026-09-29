import tailwindcss from '@tailwindcss/vite';
import adapterNetlify from '@sveltejs/adapter-netlify';
import adapterNode from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';

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

/**
 * Dev-only, and it exists because Vite does *not* inline `?worker&inline`
 * during `vite dev` — the wrapper it emits is `new Worker("/src/…?worker_file")`.
 * The page is cross-origin isolated (COOP/COEP from `hooks.server.ts`, needed
 * for SharedArrayBuffer and ONNX's multi-threaded WASM), and Chrome refuses a
 * worker whose script response carries none of the isolation headers:
 * `net::ERR_BLOCKED_BY_RESPONSE`. Vite answers that request before SvelteKit's
 * `handle` runs, so `hooks.server.ts` never gets the chance to stamp them —
 * hence this middleware. Production inlines the worker as a blob URL and needs
 * no headers at all.
 */
const workerIsolationHeaders = (): Plugin => ({
	name: 'worker-isolation-headers',
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			const url = req.url ?? '';
			if (url.includes('worker_file') || url.includes('.worker.')) {
				res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
				res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
				res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
			}
			next();
		});
	}
});

export default defineConfig({
	plugins: [
		tailwindcss(),
		workerIsolationHeaders(),
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
	],

	/**
	 * Dev-server reachability for containerized tools.
	 *
	 * The effing-use browser harness runs inside Docker and reaches this host
	 * via `host.docker.internal` (IPv6 — the IPv4 docker bridge only allows
	 * *published* ports through the firewall). Vite's host-check 403s any
	 * unknown Host header, so it must be allow-listed here.
	 */
	server: { allowedHosts: ['host.docker.internal'] }
});
