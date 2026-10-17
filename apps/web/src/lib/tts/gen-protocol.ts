import type { LoadStats, LocalEngine } from './engine-loader';

/** One `init` per worker boot; every other message is request → reply by `id`. */
export type GenRequest =
	| { op: 'init'; cdnBase: string; modelBase?: string }
	| { op: 'load'; engine: LocalEngine }
	| { op: 'gen'; engine: LocalEngine; voice: string; text: string; speed: number }
	| { op: 'release'; engine: LocalEngine };

export type GenMessage = GenRequest & { id: number };

export type GenReply =
	| { id: number; ok: true; stats?: LoadStats; samples?: Float32Array; sampleRate?: number }
	| { id: number; ok: false; error: string };
