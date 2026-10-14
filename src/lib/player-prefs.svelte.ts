import { PersistedState } from 'runed';
import { DEFAULT_SPEED, ENGINES } from '$lib/tts';
import type { EngineId } from '$lib/tts';
import { hasModel } from '$lib/tts/model-cache';

/**
 * One source of truth for the four playback choices: engine, voice, speed, ramp.
 *
 * They used to live in two places that could disagree — the server settings
 * (`ttsEngine`/`ttsVoice`/`ttsSpeed`/`ttsRamp`, passed as props by every
 * signed-in host) and two `PersistedState` copies in localStorage — with each
 * host re-deriving its own fallbacks. `resolveVoicePrefs` writes the rule once;
 * hosts pass their server copy (or `null` when anonymous) and get the answer.
 */
export type VoicePrefs = { engine: EngineId; voice: string; speed: number; ramp: boolean };

/**
 * The settings fields a host may hold — structurally typed, so both the full
 * `SettingsDto` and `/read`'s smaller load payload fit. `null`/`undefined`
 * means "no account": the anonymous half of the rule.
 */
export type ServerPrefs =
	| {
			ttsEngine?: string | null;
			ttsVoice?: string | null;
			ttsSpeed?: number | null;
			ttsRamp?: boolean | null;
	  }
	| null
	| undefined;

/** Missing values land here: `ENGINES.kitten`, its default voice, 1×, ramp off. */
export const DEFAULT_PREFS: VoicePrefs = {
	engine: 'kitten',
	voice: ENGINES.kitten.defaultVoice,
	speed: DEFAULT_SPEED,
	ramp: false
};

/**
 * The remembered engine/voice (public `/read`). Key and shape unchanged from
 * the copy that used to live in the page, so saves from before still count.
 */
export const voicePrefs = new PersistedState('kikitai.read.voice', {
	engine: DEFAULT_PREFS.engine,
	voice: DEFAULT_PREFS.voice
});

/**
 * The remembered speed/ramp. One shared instance for every player store — the
 * two stores used to build their own copy of the same key, so a speed picked
 * on `/read` could sit a render behind the app store's view of it.
 */
export const playbackPrefs = new PersistedState('kikitai.player.prefs', {
	speed: DEFAULT_PREFS.speed,
	ramp: DEFAULT_PREFS.ramp
});

function isEngineId(value: string | null | undefined): value is EngineId {
	return Boolean(value && value in ENGINES);
}

/** Assemble the answer from whichever source won, defaults underneath. */
function assemble(source: Exclude<ServerPrefs, null | undefined>): VoicePrefs {
	const engine = isEngineId(source.ttsEngine) ? source.ttsEngine : DEFAULT_PREFS.engine;
	return {
		engine,
		// A missing voice falls to the default of the *resolved* engine (kitten's
		// Luna only when the engine itself resolved to kitten); `||` because an
		// empty string is how "no voice named" reaches us (Web Speech).
		voice: source.ttsVoice || ENGINES[engine].defaultVoice,
		speed: source.ttsSpeed ?? DEFAULT_PREFS.speed,
		ramp: source.ttsRamp ?? DEFAULT_PREFS.ramp
	};
}

/**
 * THE rule, in one place:
 * - signed in → the server copy wins, field by field (a gap falls to the
 *   defaults, never to a stale device-local copy — the account is the truth);
 * - anonymous (`/read`) → the remembered local copy is the source of truth;
 * - anything missing → `DEFAULT_PREFS`.
 *
 * The local copy is only read when there is no server copy, and every read of
 * a `PersistedState` is reactive, so signed-in callers never re-run on a local
 * write while anonymous callers track it live.
 */
export function resolveVoicePrefs(server: ServerPrefs): VoicePrefs {
	return assemble(
		server ?? {
			ttsEngine: voicePrefs.current.engine,
			ttsVoice: voicePrefs.current.voice,
			ttsSpeed: playbackPrefs.current.speed,
			ttsRamp: playbackPrefs.current.ramp
		}
	);
}

/**
 * First paint only: `server ?? defaults`, with localStorage deliberately not
 * consulted — SSR cannot read it, so a component seeded from
 * `resolveVoicePrefs` would paint the stored voice where the server painted
 * the default (a hydration mismatch). The remembered copy lands after mount
 * through `resolveVoicePrefs`.
 */
export function seedVoicePrefs(server: ServerPrefs): VoicePrefs {
	return assemble(server ?? {});
}

// --- offline ---------------------------------------------------------------

/**
 * `navigator.onLine` behind one module-level `$state`. The window events are
 * registered once here — not in a component — because the banner and the voice
 * picker live in different trees (`/read` vs every `(app)` route) and must not
 * each install their own listeners or disagree about when they fire. The
 * listeners outlive every view, so module scope (behind a browser guard) is
 * their home: no `$effect` is needed, and SSR keeps the `true` default, so the
 * server renders no banner and an unfiltered picker.
 */
let onlineState = $state(true);

export const online = {
	/** Reading `.current` inside a template subscribes to the flag. */
	get current() {
		return onlineState;
	}
};

/**
 * Engines proven usable with no network. Seeded with Web Speech (OS voices,
 * nothing to download), then refilled by a cache probe on load and on every
 * drop — a model download that landed since the last probe has to count.
 * `$state.raw`: the set is replaced wholesale, never mutated, so a reactive
 * proxy over a `Set` would buy nothing.
 */
let offlineOk = $state.raw<ReadonlySet<EngineId>>(new Set<EngineId>(['webspeech']));

/**
 * Can this engine still produce speech with no network?
 * - online → yes, everything (the cache is not even consulted);
 * - offline → only what `hasModel` proves is already in the browser: cached
 *   local weights or Web Speech. The cloud engines are never available
 *   offline — their audio is synthesized on a server, so hiding them there is
 *   the honest answer: they cannot work, and waiting does not help.
 */
export function engineAvailable(engine: EngineId): boolean {
	return onlineState || offlineOk.has(engine);
}

async function probeOfflineEngines(): Promise<void> {
	const found = new Set<EngineId>();
	for (const id of Object.keys(ENGINES) as EngineId[]) {
		if (await hasModel(id)) found.add(id);
	}
	offlineOk = found;
}

if (typeof window !== 'undefined') {
	const sync = () => {
		onlineState = navigator.onLine;
		// Every drop re-probes: downloads and cache evictions both happen while online.
		if (!onlineState) void probeOfflineEngines();
	};
	sync();
	window.addEventListener('online', sync);
	window.addEventListener('offline', sync);
	// Warm the answer up front so the first drop cannot briefly hide a cached engine.
	void probeOfflineEngines();
}
