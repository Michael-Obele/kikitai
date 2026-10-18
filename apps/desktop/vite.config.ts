import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: (await import('@sveltejs/adapter-static')).default({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				strict: false
			}),
			compilerOptions: { runes: true }
		})
	],
	server: {
		port: 5174,
		headers: {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'credentialless'
		}
	}
});
