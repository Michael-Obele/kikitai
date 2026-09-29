/**
 * Pre-seed the Cache API slot that `kitten-tts-js@0.1.2` reads *before* it
 * fetches anything, so a first Play never waits on HuggingFace.
 *
 * Contract (verified in that package's `src/model-loader.js`): cache name
 * `kitten-tts`, key `/${repoId.replace('/','__')}__${file}`, looked up with
 * `cache.match(key)` → `resp.arrayBuffer()`. The lookup is cache-first, so
 * filling those keys means zero upstream requests.
 *
 * Any failure returns false and `from_pretrained` downloads as it always did —
 * the mirror can only ever make things faster.
 *
 * The base URL is a parameter: the worker bundle cannot read `$env`, so the
 * caller passes `PUBLIC_TTS_MODEL_BASE` in.
 */
const CACHE_NAME = 'kitten-tts';
const REPO = 'KittenML/kitten-tts-nano-0.8';
const key = (file: string) => `/${REPO.replace('/', '__')}__${file.replace(/\//g, '_')}`;

/**
 * Below this a single request is already as fast — sharding only pays on the
 * big one. Measured on the mirror: one stream 1.1 MB/s, four ranges 1.9 MB/s
 * (both ends shape per connection, so the ceiling is ~2 MB/s however we ask).
 */
const MIN_SHARD_BYTES = 8 * 1024 * 1024;
const SHARDS = 4;

type Manifest = { files?: { name: string; bytes: number }[] };

/** Sizes come from `manifest.json` in the mirror — no HEAD, no probe round trip. */
async function manifestBytes(base: string, file: string): Promise<number> {
	try {
		const res = await fetch(`${base}/manifest.json`);
		if (!res.ok) return 0;
		const manifest = (await res.json()) as Manifest;
		return manifest.files?.find((entry) => entry.name === file)?.bytes ?? 0;
	} catch {
		return 0;
	}
}

async function fetchBytes(base: string, file: string): Promise<ArrayBuffer> {
	const url = `${base}/${file}`;
	const size = await manifestBytes(base, file);
	if (!size || size < MIN_SHARD_BYTES) return (await fetch(url)).arrayBuffer();

	try {
		const step = Math.ceil(size / SHARDS);
		const parts = await Promise.all(
			Array.from({ length: SHARDS }, async (_, shard) => {
				const start = shard * step;
				const end = Math.min(size - 1, start + step - 1);
				const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
				// Anything but a real partial response means the server ignored Range.
				if (res.status !== 206) throw new Error(`range ${res.status}`);
				return new Uint8Array(await res.arrayBuffer());
			})
		);
		const joined = new Uint8Array(size);
		let offset = 0;
		for (const part of parts) {
			joined.set(part, offset);
			offset += part.length;
		}
		if (offset !== size) throw new Error(`got ${offset} of ${size} bytes`);
		return joined.buffer;
	} catch {
		// Server refused a range — one plain request still works.
		return (await fetch(url)).arrayBuffer();
	}
}

export type SeedResult = { ok: boolean; fetchMs: number };

export async function seedKittenModel(modelBase?: string): Promise<SeedResult> {
	const base = modelBase?.replace(/\/$/, '');
	if (!base || typeof caches === 'undefined') return { ok: false, fetchMs: 0 };

	const started = performance.now();
	try {
		const cache = await caches.open(CACHE_NAME);
		const pull = async (file: string) => {
			if (await cache.match(key(file))) return;
			const bytes = await fetchBytes(base, file);
			await cache.put(key(file), new Response(bytes));
			console.log(`[tts] seeded ${file} from mirror`);
		};

		await pull('config.json');
		const config = (await (await cache.match(key('config.json')))!.json()) as {
			model_file?: string;
			voices?: string;
		};
		if (!config.model_file) throw new Error('config.json has no model_file');
		await Promise.all([pull(config.model_file), pull(config.voices ?? 'voices.npz')]);
		return { ok: true, fetchMs: performance.now() - started };
	} catch (error) {
		console.warn('[tts] mirror seed failed — falling back to HuggingFace', error);
		return { ok: false, fetchMs: performance.now() - started };
	}
}
