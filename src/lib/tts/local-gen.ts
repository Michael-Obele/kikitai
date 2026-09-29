/**
 * Main-thread handle on the local engines: a Web Worker does the computing,
 * and an inline backend takes over if a worker cannot be created or dies.
 *
 * Both backends report their `load` timings here — telemetry needs
 * `localStorage`, which workers do not have, so the numbers are recorded on
 * this side of the boundary (once per engine per page load, as before).
 */
import { env } from '$env/dynamic/public';
// Inlined as a blob: a separate worker asset would have to be served with the
// COOP/COEP/CORP headers in *every* deployment (Vite dev, adapter-node, and
// Netlify) or Chrome blocks it with `ERR_BLOCKED_BY_RESPONSE`.
import GenWorker from './gen.worker?worker&inline';
import {
	generateSamples,
	loadLocal,
	releaseLocal,
	type LoadStats,
	type LocalEngine
} from './engine-loader';
import type { GenMessage, GenReply, GenRequest } from './gen-protocol';
import { recordTts, sessionId } from './telemetry';

export type Pcm = { samples: Float32Array; sampleRate: number };

export interface LocalGen {
	/** Load the model (records the `load` stat the first time it succeeds). */
	load(engine: LocalEngine): Promise<void>;
	/** Text → PCM, loading the model first when needed. */
	generate(engine: LocalEngine, voice: string, text: string, speed: number): Promise<Pcm>;
	/** Free one engine's session. */
	release(engine: LocalEngine): Promise<void>;
}

const recorded = new Set<string>();

function noteLoad(engine: LocalEngine, stats: LoadStats | undefined): void {
	if (!stats || recorded.has(engine)) return;
	recorded.add(engine);
	recordTts({
		engine,
		kind: 'load',
		ms: stats.ms,
		mirror: stats.mirror,
		fetchMs: stats.fetchMs,
		phases: stats.phases,
		session: sessionId,
		at: Date.now()
	});
}

type Pending = { resolve: (reply: GenReply) => void; reject: (error: Error) => void };

/** Worker-backed generation; `broken` flips the owner to the inline backend. */
class WorkerGen implements LocalGen {
	#worker: Worker;
	#pending = new Map<number, Pending>();
	#next = 1;
	#broken = false;

	constructor(cdnBase: string, modelBase?: string) {
		this.#worker = new GenWorker();
		this.#worker.onmessage = (event: MessageEvent<GenReply>) => this.#onReply(event.data);
		// A crash must not strand the player on a promise nobody settles.
		this.#worker.onerror = () => this.#break(new Error('The TTS worker crashed.'));
		this.#worker.onmessageerror = () => this.#break(new Error('A TTS worker message was lost.'));
		this.#post({ id: 0, op: 'init', cdnBase, modelBase });
	}

	get broken(): boolean {
		return this.#broken;
	}

	#post(message: GenMessage): void {
		this.#worker.postMessage(message);
	}

	#break(error: Error): void {
		if (this.#broken) return;
		this.#broken = true;
		try {
			this.#worker.terminate();
		} catch {
			/* already gone */
		}
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
	}

	#onReply(reply: GenReply): void {
		const pending = this.#pending.get(reply.id);
		if (!pending) return; // id 0: the init acknowledgement
		this.#pending.delete(reply.id);
		pending.resolve(reply);
	}

	#request(build: (id: number) => GenMessage): Promise<GenReply> {
		const id = this.#next++;
		return new Promise((resolve, reject) => {
			if (this.#broken) {
				reject(new Error('The TTS worker is unavailable.'));
				return;
			}
			this.#pending.set(id, { resolve, reject });
			try {
				this.#post(build(id));
			} catch (error) {
				this.#pending.delete(id);
				this.#break(error instanceof Error ? error : new Error(String(error)));
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	#ensure(reply: GenReply): Extract<GenReply, { ok: true }> {
		if (!reply.ok) throw new Error(reply.error);
		return reply;
	}

	async load(engine: LocalEngine): Promise<void> {
		const reply = this.#ensure(await this.#request((id) => ({ id, op: 'load', engine })));
		noteLoad(engine, reply.stats);
	}

	async generate(engine: LocalEngine, voice: string, text: string, speed: number): Promise<Pcm> {
		const reply = this.#ensure(
			await this.#request((id) => ({ id, op: 'gen', engine, voice, text, speed }))
		);
		if (!reply.samples || !reply.sampleRate) {
			throw new Error('The voice engine returned no audio samples.');
		}
		return { samples: reply.samples, sampleRate: reply.sampleRate };
	}

	async release(engine: LocalEngine): Promise<void> {
		this.#ensure(await this.#request((id) => ({ id, op: 'release', engine })));
	}
}

/** Today's path, kept whole: it is the fallback when Workers are unavailable. */
function createInline(cdnBase: string, modelBase?: string): LocalGen {
	const options = { cdnBase, modelBase };
	return {
		async load(engine) {
			const { stats } = await loadLocal(engine, options);
			noteLoad(engine, stats);
		},
		async generate(engine, voice, text, speed) {
			const { model, stats } = await loadLocal(engine, options);
			noteLoad(engine, stats);
			return generateSamples(model, text, voice, speed);
		},
		async release(engine) {
			await releaseLocal(engine);
		}
	};
}

/** Worker first, inline from the moment the worker cannot do the job. */
class FallbackGen implements LocalGen {
	#primary: WorkerGen | null;
	#inline: LocalGen;

	constructor(primary: WorkerGen | null, inline: LocalGen) {
		this.#primary = primary;
		this.#inline = inline;
	}

	#pick(): LocalGen {
		return this.#primary && !this.#primary.broken ? this.#primary : this.#inline;
	}

	load(engine: LocalEngine): Promise<void> {
		return this.#pick().load(engine);
	}

	generate(engine: LocalEngine, voice: string, text: string, speed: number): Promise<Pcm> {
		return this.#pick().generate(engine, voice, text, speed);
	}

	release(engine: LocalEngine): Promise<void> {
		return this.#pick().release(engine);
	}
}

let shared: LocalGen | null = null;

/**
 * One generation client per page. The base URLs come from `PUBLIC_*` env here
 * rather than inside the worker — a worker bundle cannot read `$env`.
 */
export function localGen(): LocalGen {
	if (shared) return shared;
	const cdnBase = (env.PUBLIC_TTS_CDN || 'https://cdn.jsdelivr.net/npm').replace(/\/$/, '');
	const modelBase = env.PUBLIC_TTS_MODEL_BASE?.replace(/\/$/, '');
	let primary: WorkerGen | null = null;
	try {
		if (typeof Worker !== 'undefined') primary = new WorkerGen(cdnBase, modelBase);
	} catch {
		primary = null; // CSP, old browser, file:// — the inline path still works
	}
	shared = new FallbackGen(primary, createInline(cdnBase, modelBase));
	return shared;
}
