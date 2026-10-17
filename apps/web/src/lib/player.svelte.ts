import { untrack } from 'svelte';
import { PersistedState } from 'runed';
import { toast } from 'svelte-sonner';
import { onPress, pressedKeys } from '$lib/keys';
import { saveVoiceSpeed } from '$lib/remote';
import { playbackPrefs, resolveVoicePrefs } from '$lib/player-prefs.svelte';
import {
	CHARS_PER_SECOND,
	DEFAULT_SPEED,
	ENGINES,
	SPEED_STEPS,
	estimateMs,
	firstChunk,
	halt,
	pausePlayback,
	prepare,
	playPrepared,
	resumePlayback,
	toSentences,
	warmUp
} from '$lib/tts';
import type { EngineId, PreparedSpeech } from '$lib/tts';
import { recordTts, sessionId } from '$lib/tts/telemetry';
import { parseMarkdown, type InlineRun, type MdBlock } from '$lib/markdown';

export type PlayerItem = { id: string; text: string; title?: string };
export type Pointer = { chunk: number; word: number; text: string } | null;

/** One spoken chunk, plus the emphasis its slice of the block carried. */
export type ReaderItem = { index: number; text: string; runs: InlineRun[] };
export type ReaderBlock = { block: MdBlock; items: ReaderItem[] };
/** A row of the reading view: one block, or a run of list items sharing a list. */
export type ReaderRow =
	| { kind: 'block'; block: MdBlock; items: ReaderItem[] }
	| { kind: 'list'; ordered: boolean; items: ReaderBlock[] };
export type Reading = { sentences: string[]; rows: ReaderRow[] };

export type { InlineRun, MdBlock };

const EMPTY_READING: Reading = { sentences: [], rows: [] };

/** The runs covering `[start, end)` of a block's plain text. */
function sliceRuns(runs: InlineRun[], start: number, end: number): InlineRun[] {
	const out: InlineRun[] = [];
	for (const run of runs) {
		const from = Math.max(run.start, start);
		const to = Math.min(run.end, end);
		if (to <= from) continue;
		out.push({
			...run,
			start: from,
			end: to,
			text: run.text.slice(from - run.start, to - run.start)
		});
	}
	return out;
}

/**
 * The one place an item's text becomes chunks. The reading view, the play loop
 * and the next-item prefetch all come through here, so a `data-chunk` index
 * always names the chunk the engine is asked to speak.
 *
 * Markdown is handled once, on the way in: `parseMarkdown` returns blocks whose
 * `plain` has its markers removed already, which is why nothing downstream ever
 * says "asterisk" — the engines only ever see these strings.
 */
export function readingFor(text: string): Reading {
	const blocks = parseMarkdown(text);
	const perBlock = blocks.map((block) => toSentences(block.plain));
	const sentences = firstChunk(perBlock.flat());
	// `firstChunk` caps the whole text's first chunk; when it splits, the extra
	// entry belongs to the first block that produced a sentence.
	const extra = sentences.length - perBlock.reduce((n, parts) => n + parts.length, 0);
	const first = perBlock.findIndex((parts) => parts.length > 0);

	let at = 0;
	const rows: ReaderRow[] = [];
	let pending: ReaderBlock[] = [];
	const flush = () => {
		if (!pending.length) return;
		rows.push({ kind: 'list', ordered: pending[0]!.block.ordered === true, items: pending });
		pending = [];
	};

	blocks.forEach((block, i) => {
		const count = (perBlock[i]?.length ?? 0) + (i === first ? extra : 0);
		// A sentence is a trimmed slice of the block's plain text, so it can look up
		// its own runs by search. `toSentences` only trims and re-glues whitespace,
		// so a miss is rare and falls back to the sentence as unformatted text.
		let cursor = 0;
		const items: ReaderItem[] = [];
		for (let n = 0; n < count; n++) {
			const sentence = sentences[at + n]!;
			const found = block.plain.indexOf(sentence, cursor);
			if (found >= 0) cursor = found + sentence.length;
			items.push({
				index: at + n,
				text: sentence,
				runs:
					found < 0
						? [{ start: 0, end: sentence.length, text: sentence }]
						: sliceRuns(block.runs, found, found + sentence.length)
			});
		}
		at += count;

		if (block.kind === 'list-item') {
			// Consecutive items of one list share a <ul>/<ol>; a change of kind
			// starts a new one.
			if (pending.length && pending[0]!.block.ordered !== block.ordered) flush();
			pending.push({ block, items });
			return;
		}
		flush();
		rows.push({ kind: 'block', block, items });
	});
	flush();

	return { sentences, rows };
}

const RAMP_MS = 120_000;

/** Sleep-timer presets, in minutes — also the order the `s` key walks them. */
export const SLEEP_PRESETS = [5, 10, 15, 30, 45];

/** What the listener can pick: off, end of the current item, or N minutes. */
export type SleepChoice = 'off' | 'end' | number;

/**
 * navigator.mediaSession is a single global slot — with two instances loaded
 * (app-global + /read) the last writer wins, and a stale cleanup must never
 * clear the handler another instance just installed.
 */
let metaOwner: symbol | null = null;
let handlerOwner: symbol | null = null;

/**
 * The app-global transport. One instance survives navigation, so playback
 * outlives the view that started it (`/inbox/[id] → /dashboard → back`).
 * All effects live in a single `$effect.root` — top-level `$effect` in a
 * `.svelte.ts` module is not a component scope.
 */
export function createPlayer() {
	/** Unique per instance — MediaSession ownership token. */
	const instance = Symbol('kikitai-player');

	// --- session -----------------------------------------------------------

	let items = $state<PlayerItem[]>([]);
	let engine = $state<EngineId>('kitten');
	let voice = $state(ENGINES.kitten.defaultVoice);
	/** Identity of the session the props describe — `null` until the first adopt. */
	let sessionKey: string | null = null;
	let index = $state(0);
	let sentenceIndex = $state(0);
	/** Generation counter — any stale loop bails out as soon as it changes. */
	let run = 0;
	/** Warmed chunk keys → their in-flight generation; each entry is consumed once. */
	const warmed = new Map<string, Promise<PreparedSpeech>>();
	let pendingEngine = $state<EngineId | null>(null);
	/** Chunk the reader clicked while the download notice was up — replayed on accept. */
	let pendingSentence = 0;

	// --- transport ---------------------------------------------------------

	let status = $state<'idle' | 'loading' | 'playing' | 'paused'>('idle');
	/** True from Play until the first chunk actually starts sounding. */
	let preparing = $state(false);
	let current = $derived(items[index] ?? null);
	/** The reading view's own model: the chunks, plus the blocks they came from. */
	let reading = $derived(current ? readingFor(current.text) : EMPTY_READING);
	/** Same split the play loop uses, so the highlight tracks the real chunk. */
	let sentences = $derived(reading.sentences);
	let playing = $derived(status === 'playing' || status === 'loading');

	// --- speed -------------------------------------------------------------

	/**
	 * Cap + ramp. The first render matches the server (the remembered value
	 * only exists client-side) — `adopt()` applies the real values.
	 */
	let cap = $state(1);
	let rampOn = $state(false);
	/** What is actually playing: the cap, or the climbing value while ramping. */
	let liveSpeed = $state(DEFAULT_SPEED);

	/** Seconds of audio still ahead, at the current speed (measured chars/s). */
	let remaining = $derived.by(() => {
		const here = sentences.slice(sentenceIndex).join(' ').length;
		const later = items.slice(index + 1).reduce((n, item) => n + item.text.length, 0);
		return Math.round((here + later) / (CHARS_PER_SECOND * Math.max(0.25, liveSpeed)));
	});

	// --- pointer -----------------------------------------------------------

	let pointer = $state<Pointer>(null);
	/** Frame handle of the running word tracker — cancelled by `stopTracking()` or any `bumpRun()`. */
	let endTrack: (() => void) | null = null;

	// --- sleep timer ---------------------------------------------------------

	/**
	 * Session-scoped on purpose (the plan: no PersistedState): a timer armed on
	 * /inbox must still fire on /dashboard, so the state — and the interval that
	 * drives it — live here in the store, never in a view.
	 */
	let sleepMode = $state<'off' | 'end' | 'minutes'>('off');
	/** The preset chosen (5/10/…), kept apart from the countdown so cycling knows where it is. */
	let sleepMinutes = $state(0);
	/** Deadline in epoch ms while minutes are armed — the wall clock decides, not a counter. */
	let sleepUntil = $state(0);
	/** Seconds left, rewritten once a second by the interval below — this is the readout. */
	let sleepLeft = $state(0);
	/**
	 * The `start()` loop parked at the item boundary while "end of item" waits for
	 * Play. A promise, not a poll: anything that bumps the run wakes it and the
	 * loop's own `run !== myRun` check ends it; Play wakes it and it walks on to
	 * the next item.
	 */
	let parked: (() => void) | null = null;

	// --- view slots (the component is a view, not the owner) ---------------

	/** Full (non-compact) hosts currently mounted — a global bar renders when this is 0. */
	let fullHosts = $state(0);
	/** Any mounted host — a store with no view must not answer keys or MediaSession. */
	let hosts = $state(0); /**
	 * Mounted players that are page content — everything *except* the global
	 * bar. The bar hides while this is non-zero: counting the bar itself would
	 * let it flip its own condition on and off for ever (mount → count → hide →
	 * unmount → count → mount …), which Svelte reports as an update storm.
	 */
	let panels = $state(0);
	let onPlayed: ((id: string) => void) | null = null;

	// --- persisted ---------------------------------------------------------

	/**
	 * Remembered choice — works without an account (public /read) and offline.
	 * The instance lives in `player-prefs.svelte.ts` now, so the app store and
	 * the /read store read one copy of the same localStorage key instead of two
	 * constructions that could drift apart within a session.
	 */
	const prefs = playbackPrefs;
	/**
	 * Keep the spoken chunk in view as the voice moves on. Off means the page
	 * never fights a reader scrolling ahead through a long paste.
	 * Own key (not inside `prefs`): old stored copies would miss the field and
	 * read as "off" for everyone on upgrade.
	 */
	const autoScroll = new PersistedState('kikitai.player.follow', true);
	/**
	 * Where the listener stopped, per item — every reader app keeps this, and it
	 * lives here in localStorage so the public /read page gets it too.
	 *
	 * Phase 2 adds the word: `{ chunk, word, charOffset }`. The key is unchanged
	 * and a plain number (every value written before today) still reads as
	 * "chunk N, word 0", so nothing stored ever needs migrating.
	 */
	type ResumeValue = number | ResumePoint;
	type ResumePoint = { chunk: number; word: number; charOffset: number };
	const resume = new PersistedState<Record<string, ResumeValue>>('kikitai.player.resume', {});
	let restoredFor = '';
	/** Old value → point: a bare number is a chunk index from the chunk-only player. */
	function asResumePoint(value: ResumeValue | undefined): ResumePoint | null {
		if (value === undefined || value === null) return null;
		return typeof value === 'number' ? { chunk: value, word: 0, charOffset: 0 } : value;
	}
	/** Character offset of word N — the position a finer seek could use directly. */
	function charOffsetOf(text: string, word: number): number {
		const words = text.split(/\s+/).filter(Boolean);
		let offset = 0;
		for (let i = 0; i < word && i < words.length; i++) offset += words[i]!.length + 1;
		return offset;
	}
	/**
	 * Persist where the listener is right now. Separate from the watching effect
	 * because `stop()` needs it too: Stop clears `sentenceIndex` and `pointer`
	 * immediately, so anything saved after those resets would be position 0.
	 * Declared out here, next to its helpers — inside `$effect.root` it would be
	 * invisible to `stop()`, which is not part of the root.
	 *
	 * The read of `resume.current` is `untrack`ed on purpose. This function merges
	 * into the existing map, so it genuinely needs the current value — but the
	 * watching effect below calls it, and `PersistedState.current` is backed by
	 * `createSubscriber`, which re-runs any effect that read it as soon as it is
	 * written. Tracked, the paused branch (which always writes, because it is the
	 * exact save a reload resumes from) would re-trigger its own effect forever.
	 */
	function savePosition(chunk: number, word: number, text: string) {
		const id = current?.id;
		if (!id) return;
		resume.current = {
			...untrack(() => resume.current),
			[id]: { chunk, word, charOffset: charOffsetOf(text, word) }
		};
	}
	/**
	 * Word position to seek into the *next* start with: set when a saved point is
	 * restored, consumed once by the first chunk `start()` plays, and dropped
	 * whenever the reader picks a chunk themselves (a click means "begin here",
	 * not "begin where I left off"). Deliberately not `$state` — nothing renders
	 * it, so it needs no reactivity and cannot churn an effect.
	 */
	let pendingResume: ResumePoint | null = null;

	// --- helpers -----------------------------------------------------------

	/** Key that both the warm-up and `start()` build for a chunk. */
	function openerKey(engineId: EngineId, voiceName: string, speed: number, text: string) {
		return JSON.stringify([engineId, voiceName, speed, text]);
	}

	/** Take a warmed chunk out of the bank — never twice, never stale. */
	function takeWarmed(text: string, engineId: EngineId, voiceName: string, speed: number) {
		const key = openerKey(engineId, voiceName, speed, text);
		const promise = warmed.get(key);
		if (promise) warmed.delete(key);
		return promise ?? null;
	}

	/**
	 * ONNX Runtime reports memory trouble as "no available backend found … out of
	 * memory", which tells the reader nothing. Say what broke and what to do.
	 */
	function loadErrorHint(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (/out of memory|no available backend|Aborted/i.test(message)) {
			return 'The voice model ran out of memory. Close a few tabs and press Play again — or switch to Web Speech.';
		}
		// The browser's own words for a module the network never delivered. It names
		// the CDN URL and says nothing a listener can act on.
		if (/dynamically imported module|Failed to fetch|NetworkError|Load failed/i.test(message)) {
			return 'Could not reach the voice engine download. Check your connection and press Play again.';
		}
		return message || 'Could not load the voice model.';
	}

	function ackKey(engineId: EngineId) {
		return `kikitai-tts-ack:${engineId}`;
	}

	/** A prefetch nobody awaits any more must not raise an unhandled rejection. */
	function tracked(promise: Promise<PreparedSpeech>) {
		promise.catch(() => {});
		return promise;
	}

	/** New generation: stale loops die, the lookahead queue dies, the word tracker is cancelled. */
	function bumpRun(): number {
		run += 1;
		endTrack?.();
		endTrack = null;
		// A loop parked at the sleep timer's item boundary belongs to the old run:
		// wake it so its own `run !== myRun` check ends it, the way every other
		// superseded loop ends.
		parked?.();
		parked = null;
		return run;
	}

	function contentDiffers(a: PlayerItem[], b: PlayerItem[]) {
		if (a === b) return false;
		if (a.length !== b.length) return true;
		return a.some(
			(item, i) =>
				item.id !== b[i]!.id ||
				item.text !== b[i]!.text ||
				(item.title ?? '') !== (b[i]!.title ?? '')
		);
	}

	// --- sleep timer (set / cycle / expire) ----------------------------------

	/**
	 * Arm, replace or cancel the timer — the single entry point, so a new preset
	 * always resets the previous deadline cleanly (one interval, no stale expiry).
	 */
	function setSleep(next: SleepChoice) {
		if (next === 'end') {
			sleepMode = 'end';
		} else if (next === 'off') {
			sleepMode = 'off';
		} else {
			sleepMode = 'minutes';
			sleepMinutes = next;
			sleepUntil = Date.now() + next * 60_000;
			sleepLeft = next * 60;
			return;
		}
		sleepMinutes = 0;
		sleepUntil = 0;
		sleepLeft = 0;
	}

	/** One press of `s`: off → 5 → 10 → 15 → 30 → 45 → end of item → off. */
	function cycleSleep() {
		if (sleepMode === 'end') {
			setSleep('off');
			return;
		}
		const at = sleepMode === 'minutes' ? SLEEP_PRESETS.indexOf(sleepMinutes) : -1;
		setSleep(SLEEP_PRESETS[at + 1] ?? 'end');
	}

	/**
	 * The timer ran out. Disarm first — that alone tears the interval down (the
	 * effect below re-runs on `sleepMode` and returns early) — then reuse the
	 * store's own pause path: `pausePlayback()` + `status = 'paused'` is exactly
	 * what the pause button does, so index/sentenceIndex stay put, MediaSession
	 * flips to paused by itself, and Play resumes on the same word.
	 */
	function sleepExpire() {
		setSleep('off');
		if (status === 'playing') {
			pausePlayback();
			status = 'paused';
		} else if (status === 'loading') {
			// Nothing is audible yet, so there is no sound to suspend — and the
			// loading path would overwrite 'paused' with 'playing' right after
			// warm-up. Closest reachable equivalent: cancel the load exactly the way
			// a pause press does while loading; index/sentenceIndex already point at
			// the chunk, so Play restarts there.
			bumpRun();
			halt();
			status = 'idle';
			preparing = false;
		}
		// idle or already paused: disarming above was the whole job.
	}

	// --- adoption ----------------------------------------------------------

	/**
	 * Take the host's props as the session, or deliberately ignore them.
	 *
	 * The rule, in plain words: **a live run owns the session.** While the
	 * transport is loading, playing or paused, every prop change is ignored and
	 * the store keeps playing the snapshot `start()` took; once the run ends
	 * (status back to `idle`) the next adopt picks up the host's new text.
	 * A prop change used to kill the run mid-listen — the compact host builds
	 * `items` inline, so its text "changed" seconds after Play and only chunk 0
	 * ever played before the transport silently returned to idle.
	 *
	 * - different session key while idle → adopt (index/sentenceIndex restart)
	 * - same key while idle → content compared, never identity: hosts that build
	 *   `items` inline churn identity every render. Swapping on identity alone is
	 *   what regressed playback — `items` is `$state`, so the raw prop is never
	 *   `===` its proxied read, every adopt re-swapped, and each swap re-derived
	 *   `sentences`, wiping the warm bank and latching the host's adopt effect
	 *   into an adopt⇄bank churn loop that starved the main thread.
	 */
	function adopt(props: {
		items: PlayerItem[];
		engine: EngineId;
		voice: string;
		speed?: number;
		ramp?: boolean;
	}) {
		// Reading `status` first is also what makes the host's adopt effect re-run
		// the moment the transport goes idle — the new text lands without a nudge,
		// and this early return writes no state, so the effect cannot loop.
		if (status === 'playing' || status === 'loading' || status === 'paused') return;

		const key = JSON.stringify([props.engine, props.voice, props.items.map((item) => item.id)]);
		if (key !== sessionKey) {
			sessionKey = key;
			items = props.items;
			engine = props.engine;
			voice = props.voice;
			index = 0;
			sentenceIndex = 0;
			pointer = null;
			restoredFor = '';
		} else if (contentDiffers(props.items, items)) {
			items = props.items;
			if (index > items.length - 1) index = Math.max(0, items.length - 1);
			restoredFor = '';
		}
		// Speed/ramp are not part of the session — always follow the props (or,
		// signed out, the remembered choice; it does not exist during SSR).
		if (props.speed !== undefined) {
			cap = props.speed;
		} else {
			// The host passed no server copy — the anonymous half of the one rule
			// in player-prefs (remembered copy, defaults underneath). `adopt` only
			// ever reaches this while idle, so a live cap is never clobbered.
			const local = resolveVoicePrefs(null);
			cap = local.speed;
			rampOn = local.ramp;
		}
		if (props.ramp !== undefined) rampOn = props.ramp;
	}

	// --- transport ---------------------------------------------------------

	/**
	 * Reads every item from `from`, starting `sentence` chunks into that first
	 * item — the offset a click in the text sets.
	 */
	async function start(from: number, sentence = 0) {
		const meta = ENGINES[engine];
		if (meta.downloadMb > 0 && !localStorage.getItem(ackKey(engine))) {
			index = Math.min(Math.max(from, 0), items.length - 1);
			pendingEngine = engine;
			pendingSentence = sentence;
			return;
		}

		const myRun = bumpRun();
		status = 'loading';
		preparing = true;
		try {
			await warmUp(engine);
		} catch (error) {
			if (run === myRun) status = 'idle';
			toast.error(loadErrorHint(error));
			return;
		}
		if (run !== myRun) return;

		status = 'playing';
		const pressedAt = performance.now();
		let firstAudioRecorded = false;
		const first = Math.max(from, 0);
		for (let i = first; i < items.length; i++) {
			if (run !== myRun) return;
			index = i;
			const parts = readingFor(items[i]!.text).sentences;
			// An item with no sentences at all (a digest row whose summary came back
			// empty joins to '') would make `parts.length - 1` = -1 and index the
			// array at -1, so `prepare` throws on `undefined.trim()` and one empty row
			// silently kills the whole run. Nothing to play — move on.
			if (parts.length === 0) continue;
			// A click starts mid-text; every later item still starts at its own top.
			const skip = i === first ? Math.min(sentence, parts.length - 1) : 0;
			// Lookahead queue: generation stays strictly in order but decoupled from
			// playback — while chunk s speaks, spare time banks s+1 AND s+2, so a slow
			// inference behind a short chunk no longer cuts an audible gap (the
			// one-deep lookahead had ~4-5 s stalls with Kitten, ~2 s with Kokoro).
			const queued = new Map<number, Promise<PreparedSpeech>>();
			let chain: Promise<unknown> = Promise.resolve();
			const ensure = (s: number) => {
				if (s >= parts.length || queued.has(s)) return;
				const opener = takeWarmed(parts[s]!, engine, voice, liveSpeed);
				const job =
					opener ??
					chain.then(() => {
						// A superseded run must not keep burning CPU on stale chunks.
						if (run !== myRun) throw new Error('superseded');
						return prepare(engine, voice, parts[s]!, liveSpeed);
					});
				queued.set(s, tracked(job));
				chain = job.catch(() => {});
			};
			for (let s = skip; s < parts.length; s++) {
				if (run !== myRun) return;
				sentenceIndex = s;
				ensure(s);
				ensure(s + 1);
				ensure(s + 2);
				// Tail of an item: bank the next item's opener while this chunk plays,
				// so the boundary between messages never pays a cold generation gap.
				if (s === parts.length - 1 && i + 1 < items.length) {
					const opener = readingFor(items[i + 1]!.text).sentences[0];
					const nextKey = opener ? openerKey(engine, voice, liveSpeed, opener) : null;
					if (opener && nextKey && !warmed.has(nextKey)) {
						const job = chain.then(() => {
							if (run !== myRun) throw new Error('superseded');
							return prepare(engine, voice, opener, liveSpeed);
						});
						warmed.set(nextKey, tracked(job));
						chain = job.catch(() => {});
					}
				}
				let prepared: PreparedSpeech;
				try {
					prepared = await queued.get(s)!;
				} catch (error) {
					toast.error(loadErrorHint(error));
					// Never leave the transport stuck on "playing" after a failed prepare.
					if (run === myRun) status = 'idle';
					return;
				}
				if (run !== myRun) return;
				// A restored session seeks into its very first chunk: the same fraction
				// feeds the audio offset and the word pointer, so the highlight lands on
				// the word the listener stopped at. Web Speech has no offset — its `play`
				// ignores one and the utterance restarts, while the pointer still jumps:
				// position kept, no gap (the plan's fallback for engines without a seek).
				let seekMs = 0;
				if (i === first && s === skip && pendingResume) {
					const total = parts[s]!.split(/\s+/).filter(Boolean).length || 1;
					const ratio = Math.min(1, Math.max(0, pendingResume.word / total));
					seekMs = Math.round(ratio * prepared.audioMs);
					pendingResume = null;
				}
				// The wait a listener feels: Play press → the moment sound starts.
				if (!firstAudioRecorded) {
					firstAudioRecorded = true;
					preparing = false;
					recordTts({
						engine,
						kind: 'first',
						ms: performance.now() - pressedAt,
						session: sessionId,
						at: Date.now()
					});
				}
				// `beganAt` shifts back by the seek so `track()`'s ratio starts where
				// the audio does — without it the pointer would restart at word 0 while
				// the sound plays from the middle (and RTF would divide by the wrong span).
				const stopTracking = track(s, parts[s]!, prepared.audioMs, performance.now() - seekMs);
				try {
					await playPrepared(engine, prepared, seekMs);
				} catch (error) {
					toast.error(error instanceof Error ? error.message : String(error));
				} finally {
					stopTracking();
				}
				if (run !== myRun) return;
			}
			onPlayed?.(items[i]!.id);
			if (sleepMode === 'end') {
				// "End of item" fires exactly where an item completes — no wall clock.
				// The chunk's audio promise is already spent, so a bare pause would
				// leave `paused` with a dead loop and Play would resume into silence;
				// park the loop here instead. Play (toggle above) releases it and the
				// loop continues with the next item; anything that bumps the run
				// releases it too, and the run check below then ends it.
				setSleep('off');
				pausePlayback();
				status = 'paused';
				await new Promise<void>((done) => {
					parked = () => done();
				});
				if (run !== myRun) return;
			}
		}
		if (run === myRun) {
			status = 'idle';
			index = 0;
			sentenceIndex = 0;
			pointer = null;
		}
	}

	function persist(next: { speed: number; ramp: boolean }) {
		prefs.current = next; // everyone — survives a reload without an account
		void saveVoiceSpeed(next).catch(() => {
			/* signed out (public /read) — the local copy is the source of truth */
		});
	}

	function selectSpeed(next: number) {
		cap = next;
		liveSpeed = rampOn ? Math.min(liveSpeed, next) : next;
		persist({ speed: next, ramp: rampOn });
	}

	function setRamp(next: boolean) {
		rampOn = next;
		// Ramp climbs toward the cap: start at 1.0 (never above the cap).
		liveSpeed = next ? Math.min(1, cap) : cap;
		persist({ speed: cap, ramp: next });
	}

	/** One notch along the fixed speed ladder — what the speed keys walk. */
	function stepSpeed(direction: -1 | 1) {
		const at = SPEED_STEPS.findIndex((step) => step === cap);
		const next =
			SPEED_STEPS[Math.min(SPEED_STEPS.length - 1, Math.max(0, (at < 0 ? 1 : at) + direction))];
		if (next !== undefined && next !== cap) selectSpeed(next);
	}

	function toggle() {
		if (status === 'loading') {
			// Nothing is audible yet, so a second press means "never mind" — keep
			// the sentence the reader picked instead of yanking it back to 0.
			bumpRun();
			halt();
			status = 'idle';
			preparing = false;
			return;
		}
		if (status === 'playing') {
			pausePlayback();
			status = 'paused';
		} else if (status === 'paused') {
			// Release a sleep-timer park at the item boundary first: the loop then
			// walks on to the next item while this press resumes the audio path.
			parked?.();
			parked = null;
			resumePlayback();
			status = 'playing';
		} else {
			// Idle: continue from whatever is highlighted — a click, or the saved
			// position from last time — instead of restarting at chunk 0.
			void start(index, sentenceIndex);
		}
	}

	/** Stop pressed — exactly today's `stop()`: index kept, everything else reset. */
	function stop() {
		// Save first: the plan's acceptance is "stop mid-sentence → reload →
		// resumes at that word", and the resets below erase the position. The
		// in-session restart at chunk 0 stays exactly as it was — Stop still means
		// "start over" for the very next Play; only a reload comes back to here.
		savePosition(sentenceIndex, pointer?.word ?? 0, pointer?.text ?? '');
		bumpRun();
		halt();
		status = 'idle';
		preparing = false;
		sentenceIndex = 0;
		pointer = null;
		pendingEngine = null;
		// Stop means "forget the position" for this session — the saved point must
		// not seek the next Play back into a word of a chunk we just reset to 0.
		pendingResume = null;
		// Stop also cancels an armed sleep timer: nothing is playing, so a pending
		// expiry would have nothing to pause; leaving it armed would fire into air.
		setSleep('off');
	}

	/**
	 * Follows the chunk being spoken frame by frame so the reader can light up the
	 * current word. Paused time never counts against the chunk's duration.
	 * Owned by the run loop: `stopTracking()` or any `bumpRun()` cancels it.
	 */
	function track(chunk: number, text: string, audioMs: number, beganAt: number) {
		const total = text.split(/\s+/).filter(Boolean).length || 1;
		let pausedAt = 0;
		let pausedTotal = 0;
		let frame = 0;
		endTrack?.();
		const stopTracking = () => {
			cancelAnimationFrame(frame);
			if (endTrack === stopTracking) endTrack = null;
		};
		const step = () => {
			const now = performance.now();
			if (status === 'playing') {
				if (pausedAt) {
					pausedTotal += now - pausedAt;
					pausedAt = 0;
				}
				const ratio = Math.min(1, (now - beganAt - pausedTotal) / Math.max(1, audioMs));
				pointer = { chunk, text, word: Math.min(total - 1, Math.floor(ratio * total)) };
			} else if (status === 'paused' && !pausedAt) {
				pausedAt = now;
			} else if (status === 'idle') {
				pointer = null;
				return;
			}
			frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		endTrack = stopTracking;
		return stopTracking;
	}

	/** Click a sentence in the text — the voice starts there instead of at the top. */
	function speakFrom(to: number) {
		if (to < 0 || to >= sentences.length) return;
		bumpRun();
		halt();
		status = 'idle';
		// A click says "begin here", not "begin where I left off".
		pendingResume = null;
		void start(index, to);
	}

	/** ±1 chunk — a sentence is the smallest unit the reader can see and name. */
	function skip(delta: number) {
		speakFrom(sentenceIndex + delta);
	}

	/** ±seconds (media keys report an offset) — walk chunks until they add up. */
	function skipSeconds(seconds: number) {
		const step = seconds < 0 ? -1 : 1;
		let target = sentenceIndex;
		let span = 0;
		while (span < Math.abs(seconds)) {
			const next = target + step;
			if (next < 0 || next >= sentences.length) break;
			target = next;
			span += estimateMs(sentences[target]!, liveSpeed) / 1000;
		}
		speakFrom(target);
	}

	function jump(to: number) {
		if (to < 0 || to >= items.length) return;
		bumpRun();
		halt();
		status = 'idle';
		pendingResume = null;
		void start(to);
	}

	// --- download notice ---------------------------------------------------

	function acceptNotice() {
		localStorage.setItem(ackKey(pendingEngine ?? engine), '1');
		pendingEngine = null;
		void start(index, pendingSentence);
		pendingSentence = 0;
	}

	function dismissNotice() {
		pendingEngine = null;
		pendingSentence = 0;
	}

	// --- effects (one $effect.root owns them all) --------------------------

	$effect.root(() => {
		/**
		 * Bindings live on runed's PressedKeys (src/lib/keys.ts): the library holds
		 * the pressed state, `onPress` fires once per press and stops the browser
		 * scrolling the page for keys we own. Plain ↑/↓ stay the page's — speed
		 * takes `<`/`>` or Shift + ↑/↓, and `?` belongs to the help component.
		 *
		 * Registered once per store instance (a component-level registration
		 * double-fires when two hosts mount), gated on having a mounted view so a
		 * background instance never steals a keypress from the visible one.
		 */
		const bind = (combo: string | string[], action: () => void) =>
			onPress(combo, () => {
				if (hosts === 0) return;
				action();
			});
		bind(' ', toggle);
		bind('k', toggle);
		bind('arrowleft', () => (pressedKeys.has('shift') ? jump(index - 1) : skip(-1)));
		bind('arrowright', () => (pressedKeys.has('shift') ? jump(index + 1) : skip(1)));
		bind('j', () => skipSeconds(-15));
		bind('l', () => skipSeconds(30));
		bind('<', () => stepSpeed(-1));
		bind('>', () => stepSpeed(1));
		bind(['shift', 'arrowup'], () => stepSpeed(1));
		bind(['shift', 'arrowdown'], () => stepSpeed(-1));
		bind('home', () => speakFrom(0));
		bind('s', cycleSleep);

		// No ramp ⇒ play at the cap; while ramping the timer below climbs.
		$effect(() => {
			if (!rampOn) liveSpeed = cap;
		});

		// +0.1× every 2 minutes of *playing* time — paused time never counts.
		$effect(() => {
			if (!rampOn || status !== 'playing') return;
			let last = performance.now();
			const id = setInterval(() => {
				const now = performance.now();
				if (now - last >= RAMP_MS) {
					last = now;
					liveSpeed = Math.min(Math.round((liveSpeed + 0.1) * 10) / 10, cap);
				}
			}, 1000);
			return () => clearInterval(id);
		});

		// Sleep timer: one interval, alive only while a minute preset is armed. It
		// lives in this root (not in a component), so a route change can neither
		// stop it nor double it; disarming is all the teardown there is — the
		// effect re-runs when `sleepMode` changes, returns early, and this cleanup
		// clears the interval.
		$effect(() => {
			if (sleepMode !== 'minutes') return;
			const tick = () => {
				if (sleepMode !== 'minutes') return; // disarmed since the last tick
				const left = Math.max(0, Math.ceil((sleepUntil - Date.now()) / 1000));
				sleepLeft = left; // what the button shows — a $state, so the label re-renders
				if (left <= 0) sleepExpire();
			};
			tick();
			const id = setInterval(tick, 1000);
			return () => clearInterval(id);
		});

		// Once the download has been accepted, load the model in the background so
		// the first Play doesn't pay the load — it shows up in the telemetry card.
		$effect(() => {
			// A store with no view must not touch the model: on /read the
			// hostless app-global singleton would race release()/load() against
			// the instance that is actually playing.
			if (hosts === 0) return;
			if (ENGINES[engine].downloadMb > 0 && localStorage.getItem(ackKey(engine))) {
				void warmUp(engine).catch(() => {
					/* offline or blocked — Play will retry it */
				});
			}
		});

		/**
		 * Warm bank: once text, voice and speed sit still for a beat, the first
		 * three chunks generate ahead of Play. Chunk 0 covers the press-to-first-
		 * sound wait (4.1 s measured with Kitten); chunks 1–2 give the lookahead
		 * queue something to draw on from the very first boundary, so a slow
		 * inference behind a short chunk no longer cuts an audible gap. Local
		 * engines only — cloud TTS would burn quota on typing.
		 */
		$effect(() => {
			if (hosts === 0) return;
			const opener = sentences.slice(0, 3);
			const speed = liveSpeed;
			if (opener.length === 0 || ENGINES[engine].downloadMb === 0) return;
			// The download notice gates model work for the big engines — same rule as Play.
			if (!localStorage.getItem(ackKey(engine))) return;
			const keys = opener.map((text) => openerKey(engine, voice, speed, text));
			let cancelled = false;
			let chain: Promise<unknown> = Promise.resolve();
			const timer = setTimeout(() => {
				// Read outside the reactive context: `status` must not become a
				// dependency, or the Play press itself would wipe the bank.
				if (status !== 'idle') return;
				for (let s = 0; s < opener.length; s++) {
					const key = keys[s]!;
					const job = chain.then(() => {
						if (cancelled) throw new Error('warm superseded');
						return prepare(engine, voice, opener[s]!, speed);
					});
					warmed.set(key, tracked(job));
					chain = job.catch(() => {});
				}
			}, 500);
			return () => {
				cancelled = true;
				clearTimeout(timer);
				for (const key of keys) warmed.delete(key);
			};
		});

		// --- resume ---------------------------------------------------------

		// Show the chunk the listener stopped on, so Play continues instead of restarting.
		$effect(() => {
			const id = current?.id;
			if (!id || status !== 'idle' || restoredFor === id) return;
			restoredFor = id;
			const point = asResumePoint(resume.current[id]);
			if (!point) return;
			sentenceIndex = Math.min(point.chunk, Math.max(sentences.length - 1, 0));
			// The word only matters for the chunk it was recorded in: a point from a
			// shorter version of the text must not seek into a different sentence.
			pendingResume = point.chunk === sentenceIndex ? point : null;
		});

		// Remember the position while listening. Local only — never leaves the device.
		// Bucketed on purpose: `pointer` moves every animation frame, but a write is
		// only worth making when the chunk changes, when the word crosses a group of
		// ten (a chunk is ~60 words, so every few seconds), or when the listener
		// pauses (that write is exact — it is the one a reload resumes from).
		let savedAt = { id: '', chunk: -1, bucket: -1 };
		$effect(() => {
			const id = current?.id;
			const chunk = sentenceIndex;
			const word = pointer?.word ?? 0;
			if (!id || status === 'idle') return;
			const bucket = Math.floor(word / 10);
			const exact = status === 'paused';
			if (!exact && savedAt.id === id && savedAt.chunk === chunk && savedAt.bucket === bucket)
				return;
			savedAt = { id, chunk, bucket };
			// The bucket decides *when* to write; the value written is always the exact
			// word — writing the bucket itself made every position inside the first ten
			// words persist as word 0, which read as "start of the chunk" on reload.
			savePosition(chunk, word, pointer?.text ?? '');
		});

		// --- lock screen / media keys ---------------------------------------

		$effect(() => {
			if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
			if (hosts === 0) return;
			const session = navigator.mediaSession;
			metaOwner = instance;
			try {
				session.metadata = new MediaMetadata({
					title: current?.title ?? sentences[0]?.slice(0, 80) ?? 'Kikitai',
					artist: ENGINES[engine].label,
					album: 'Kikitai'
				});
			} catch {
				/* Media Metadata is unsupported here — the handlers below still work */
			}
			return () => {
				// Another instance installed its own metadata after us — leave it.
				if (metaOwner !== instance) return;
				metaOwner = null;
				try {
					session.metadata = null;
				} catch {
					/* nothing to clear */
				}
			};
		});

		$effect(() => {
			if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
			if (hosts === 0) return;
			const session = navigator.mediaSession;
			handlerOwner = instance;
			session.playbackState =
				status === 'playing' ? 'playing' : status === 'paused' ? 'paused' : 'none';
			const on = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
				try {
					session.setActionHandler(action, handler);
				} catch {
					/* this browser does not implement that action */
				}
			};
			on('play', () => {
				if (status !== 'playing') toggle();
			});
			on('pause', () => {
				if (status === 'playing') toggle();
			});
			on('stop', () => stop());
			on('previoustrack', () => jump(index - 1));
			on('nexttrack', () => jump(index + 1));
			on('seekbackward', (details) => skipSeconds(-Math.round(details?.seekOffset ?? 15)));
			on('seekforward', (details) => skipSeconds(Math.round(details?.seekOffset ?? 30)));
			return () => {
				// Another instance owns the lock-screen controls now — don't clear them.
				if (handlerOwner !== instance) return;
				handlerOwner = null;
				for (const action of [
					'play',
					'pause',
					'stop',
					'previoustrack',
					'nexttrack',
					'seekbackward',
					'seekforward'
				] as MediaSessionAction[]) {
					on(action, null);
				}
			};
		});
	});

	return {
		// session
		get items() {
			return items;
		},
		get engine() {
			return engine;
		},
		get voice() {
			return voice;
		},
		get index() {
			return index;
		},
		get sentenceIndex() {
			return sentenceIndex;
		},
		get pendingEngine() {
			return pendingEngine;
		},
		// transport
		get status() {
			return status;
		},
		get preparing() {
			return preparing;
		},
		get current() {
			return current;
		},
		get sentences() {
			return sentences;
		},
		/** The reader view's blocks; the component paints these instead of one paragraph. */
		get reader() {
			return reading;
		},
		get playing() {
			return playing;
		},
		get remaining() {
			return remaining;
		},
		// speed
		get cap() {
			return cap;
		},
		get rampOn() {
			return rampOn;
		},
		get liveSpeed() {
			return liveSpeed;
		},
		// pointer
		get pointer() {
			return pointer;
		},
		// persisted
		get prefs() {
			return prefs;
		},
		get autoScroll() {
			return autoScroll;
		},
		get resume() {
			return resume;
		},
		// view slots — the only fields a host may write
		get fullHosts() {
			return fullHosts;
		},
		set fullHosts(next: number) {
			fullHosts = next;
		},
		get hosts() {
			return hosts;
		},
		set hosts(next: number) {
			hosts = next;
		},
		get panels() {
			return panels;
		},
		set panels(next: number) {
			panels = next;
		},
		get onPlayed() {
			return onPlayed;
		},
		set onPlayed(next: ((id: string) => void) | null) {
			onPlayed = next;
		},
		// lifecycle
		adopt,
		start,
		stop,
		toggle,
		jump,
		speakFrom,
		skip,
		skipSeconds,
		track,
		tracked,
		loadErrorHint,
		ackKey,
		openerKey,
		takeWarmed,
		acceptNotice,
		dismissNotice,
		// speed
		selectSpeed,
		setRamp,
		stepSpeed,
		persist,
		// sleep timer
		get sleepMode() {
			return sleepMode;
		},
		get sleepMinutes() {
			return sleepMinutes;
		},
		get sleepLeft() {
			return sleepLeft;
		},
		setSleep,
		cycleSleep
	};
}

export type PlayerStore = ReturnType<typeof createPlayer>;

/** The app-global instance — `Player`'s default store. */
export const appPlayer = createPlayer();
