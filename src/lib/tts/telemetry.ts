import type { EngineId } from './index';

/**
 * One TTS timing, recorded on the device that did the work.
 *
 * `load` = model download/init, `gen` = text → audio, `play` = how long the
 * audio actually took to speak. Comparing gen against play is the whole point:
 * when gen/play stays under 1.0 the lookahead prefetch keeps up with playback
 * and there are no silent gaps between sentences.
 */
export type TtsStat = {
	engine: EngineId;
	/**
	 * `chunk` pairs one generation with the playback it produced — the only
	 * honest source for RTF. `first` is Play press → first sound.
	 */
	kind: 'load' | 'gen' | 'chunk' | 'first';
	/** Duration in milliseconds (for `chunk`: how long it took to speak). */
	ms: number;
	/** `chunk`: milliseconds spent generating this exact chunk. */
	genMs?: number;
	/** `chunk`: true when the audio came from the on-device cache. */
	cached?: boolean;
	/** `load`: true when the bytes came from our mirror instead of HuggingFace. */
	mirror?: boolean;
	/** `load`: milliseconds spent seeding model bytes (0 when already cached). */
	fetchMs?: number;
	/** `load`: per-phase milliseconds — the breakdown behind the single number. */
	phases?: Record<string, number>;
	/** Page load this stat belongs to — a persisted history never mixes runs. */
	session: string;
	/** Characters synthesized — meaningful for `gen` and `chunk`. */
	chars?: number;
	at: number;
};

/** New id per page load: lets the panel filter persisted stats back to one run. */
export const sessionId = crypto.randomUUID();

const MAX_STATS = 200;
const buffer: TtsStat[] = [];
const listeners = new Set<(stat: TtsStat) => void>();

/** Record one timing: logged as `[tts] …` and fanned out to subscribers. */
export function recordTts(stat: TtsStat): void {
	buffer.push(stat);
	if (buffer.length > MAX_STATS) buffer.shift();
	const detail =
		stat.kind === 'chunk'
			? ` (gen ${Math.round(stat.genMs ?? 0)}ms${stat.cached ? ', cached' : ''})`
			: stat.chars
				? ` · ${stat.chars}ch`
				: '';
	console.debug(`[tts] ${stat.kind} ${Math.round(stat.ms)}ms${detail} (${stat.engine})`);
	for (const listener of [...listeners]) listener(stat);
}

/** Everything recorded this page load. */
export function ttsStats(): TtsStat[] {
	return [...buffer];
}

/** Live timings — call the returned function to unsubscribe. */
export function onTtsStat(listener: (stat: TtsStat) => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
