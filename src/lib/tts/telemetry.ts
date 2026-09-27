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
	kind: 'load' | 'gen' | 'play';
	/** Duration in milliseconds. */
	ms: number;
	/** Characters synthesized — only meaningful for `gen`. */
	chars?: number;
	at: number;
};

const MAX_STATS = 200;
const buffer: TtsStat[] = [];
const listeners = new Set<(stat: TtsStat) => void>();

/** Record one timing: logged as `[tts] …` and fanned out to subscribers. */
export function recordTts(stat: TtsStat): void {
	buffer.push(stat);
	if (buffer.length > MAX_STATS) buffer.shift();
	const detail = stat.kind === 'gen' && stat.chars ? ` · ${stat.chars}ch` : '';
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
