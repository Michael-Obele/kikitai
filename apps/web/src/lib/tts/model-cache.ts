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
import type { EngineId } from './index';

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

/**
 * Offline answer: is everything this engine needs already in the browser?
 *
 * (The plan called for `has(engine)` — this is it, sitting next to the caches
 * it inspects.) Local engines are only "had" when their weights are in the
 * Cache API: kitten in the `kitten-tts` slot — filled both by our mirror seed
 * above and by the package's own loader — and kokoro in the `transformers-cache`
 * slot that kokoro-js (a transformers.js core) opens. Web Speech needs no
 * download at all; the cloud engines are never true here, because their audio
 * is synthesized on a server that needs the network to reach.
 */
export async function hasModel(engine: EngineId): Promise<boolean> {
	switch (engine) {
		case 'webspeech':
			return true;
		case 'google':
		case 'minimax':
			return false;
		case 'kitten':
			return kittenCached();
		case 'kokoro':
			return kokoroCached();
	}
}

/** Kitten: config + the ONNX weights + the voices file, all three in one slot. */
async function kittenCached(): Promise<boolean> {
	if (typeof caches === 'undefined') return false;
	try {
		const cache = await caches.open(CACHE_NAME);
		const config = await cache.match(key('config.json'));
		if (!config) return false;
		const parsed = (await config.json()) as { model_file?: string; voices?: string };
		if (!parsed.model_file) return false;
		const model = await cache.match(key(parsed.model_file));
		const voices = await cache.match(key(parsed.voices ?? 'voices.npz'));
		return Boolean(model && voices);
	} catch {
		return false;
	}
}

/**
 * Kokoro: kokoro-js keys weights by the full request URL inside the
 * transformers.js cache — match any Kokoro `.onnx` it would otherwise fetch.
 * Its per-voice `.bin` files live in a second slot (`kokoro-voices`) fetched
 * per voice on first use, so a voice never played before a drop still fails
 * with the player's usual toast: this probe is engine-level, as the plan asks.
 */
async function kokoroCached(): Promise<boolean> {
	if (typeof caches === 'undefined') return false;
	try {
		const cache = await caches.open('transformers-cache');
		return (await cache.keys()).some(
			(request) => request.url.includes('Kokoro-82M') && request.url.includes('.onnx')
		);
	} catch {
		return false;
	}
}
