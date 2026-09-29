<script lang="ts">
	import {
		AudioLines,
		ChevronLeft,
		ChevronRight,
		Download,
		FastForward,
		LoaderCircle,
		MoveVertical,
		Pause,
		Play,
		Rewind,
		SkipBack,
		SkipForward,
		Square
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { toast } from 'svelte-sonner';
	import { PersistedState } from 'runed';
	import { saveVoiceSpeed } from '$lib/remote';
	import { onPress, pressedKeys } from '$lib/keys';
	import {
		CHARS_PER_SECOND,
		DEFAULT_SPEED,
		ENGINES,
		SPEED_STEPS,
		downloadEstimate,
		estimateMs,
		firstChunk,
		halt,
		pausePlayback,
		prepare,
		playPrepared,
		resumePlayback,
		toSentences,
		warmUp,
		type PreparedSpeech
	} from '$lib/tts';
	import type { EngineId } from '$lib/tts';
	import { recordTts, sessionId } from '$lib/tts/telemetry';
	import WordLine from './word-line.svelte';
	import KeyboardHelp from './keyboard-help.svelte';
	import SpeedMenu from './speed-menu.svelte';

	type Item = { id: string; text: string; title?: string };

	let {
		items,
		engine,
		voice,
		compact = false,
		onPlayed,
		speed,
		ramp,
		pointer = $bindable<{ chunk: number; word: number; text: string } | null>(null)
	}: {
		items: Item[];
		engine: EngineId;
		voice: string;
		compact?: boolean;
		onPlayed?: (id: string) => void;
		/** Server copy (settings.ttsSpeed) — omitted on the public /read page. */
		speed?: number;
		/** Server copy (settings.ttsRamp). */
		ramp?: boolean;
		/** Live position in the spoken text, so a compact host can render its own line. */
		pointer?: { chunk: number; word: number; text: string } | null;
	} = $props();

	let index = $state(0);
	let sentenceIndex = $state(0);
	/** The paragraph the reader view draws its chunks into — used to keep the spoken one in view. */
	let chunkList = $state<HTMLElement | null>(null);
	let status = $state<'idle' | 'loading' | 'playing' | 'paused'>('idle');
	/** True from Play until the first chunk actually starts sounding. */
	let preparing = $state(false);
	let noticeOpen = $state(false);

	let current = $derived(items[index] ?? null);
	/** Same split the play loop uses, so the highlight tracks the real chunk. */
	let sentences = $derived(current ? firstChunk(toSentences(current.text)) : []);
	let playing = $derived(status === 'playing' || status === 'loading');

	/** Generation counter — any stale loop bails out as soon as it changes. */
	let run = 0;
	let pendingEngine = $state<EngineId | null>(null);
	/** Chunk the reader clicked while the download notice was up — replayed on accept. */
	let pendingSentence = 0;

	/** Remembered choice — works without an account (public /read) and offline. */
	const prefs = new PersistedState('kikitai.player.prefs', { speed: 1, ramp: false });

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
	 */
	const resume = new PersistedState<Record<string, number>>('kikitai.player.resume', {});
	let restoredFor = '';

	/**
	 * Cap + ramp. The first render matches the server (the remembered value
	 * only exists client-side) — the effect below adopts it after mount.
	 */
	// svelte-ignore state_referenced_locally
	let cap = $state(speed ?? 1);
	// svelte-ignore state_referenced_locally
	let rampOn = $state(ramp ?? false);
	/** What is actually playing: the cap, or the climbing value while ramping. */
	let liveSpeed = $state(DEFAULT_SPEED);

	/** Seconds of audio still ahead, at the current speed (measured chars/s). */
	let remaining = $derived.by(() => {
		const here = sentences.slice(sentenceIndex).join(' ').length;
		const later = items.slice(index + 1).reduce((n, item) => n + item.text.length, 0);
		return Math.round((here + later) / (CHARS_PER_SECOND * Math.max(0.25, liveSpeed)));
	});

	const RAMP_MS = 120_000;

	$effect(() => {
		if (speed !== undefined) cap = speed;
	});
	$effect(() => {
		if (ramp !== undefined) rampOn = ramp;
	});
	$effect(() => {
		// Signed out: adopt the remembered choice (it does not exist during SSR).
		if (speed === undefined) {
			cap = prefs.current.speed;
			rampOn = prefs.current.ramp;
		}
	});
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

	// Once the download has been accepted, load the model in the background so
	// the first Play doesn't pay the load — it shows up in the telemetry card.
	$effect(() => {
		if (ENGINES[engine].downloadMb > 0 && localStorage.getItem(ackKey(engine))) {
			void warmUp(engine).catch(() => {
				/* offline or blocked — Play will retry it */
			});
		}
	});

	/** Key that both the warm-up and `start()` build for a chunk. */
	function openerKey(engineId: EngineId, voiceName: string, speed: number, text: string) {
		return JSON.stringify([engineId, voiceName, speed, text]);
	}

	/** Warmed chunk keys → their in-flight generation; each entry is consumed once. */
	const warmed = new Map<string, Promise<PreparedSpeech>>();

	/** Take a warmed chunk out of the bank — never twice, never stale. */
	function takeWarmed(text: string, engineId: EngineId, voiceName: string, speed: number) {
		const key = openerKey(engineId, voiceName, speed, text);
		const promise = warmed.get(key);
		if (promise) warmed.delete(key);
		return promise ?? null;
	}

	/**
	 * Warm bank: once text, voice and speed sit still for a beat, the first
	 * three chunks generate ahead of Play. Chunk 0 covers the press-to-first-
	 * sound wait (4.1 s measured with Kitten); chunks 1–2 give the lookahead
	 * queue something to draw on from the very first boundary, so a slow
	 * inference behind a short chunk no longer cuts an audible gap. Local
	 * engines only — cloud TTS would burn quota on typing.
	 */
	$effect(() => {
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

	/**
	 * ONNX Runtime reports memory trouble as "no available backend found … out of
	 * memory", which tells the reader nothing. Say what broke and what to do.
	 */
	function loadErrorHint(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (/out of memory|no available backend|Aborted/i.test(message)) {
			return 'The voice model ran out of memory. Close a few tabs and press Play again — or switch to Web Speech.';
		}
		return message || 'Could not load the voice model.';
	}

	function ackKey(engineId: EngineId) {
		return `kikitai-tts-ack:${engineId}`;
	}

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
			noticeOpen = true;
			return;
		}

		const myRun = ++run;
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
			const parts = firstChunk(toSentences(items[i]!.text));
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
					const opener = firstChunk(toSentences(items[i + 1]!.text))[0];
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
					toast.error(error instanceof Error ? error.message : String(error));
					// Never leave the transport stuck on "playing" after a failed prepare.
					if (run === myRun) status = 'idle';
					return;
				}
				if (run !== myRun) return;
				if (run !== myRun) return;
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
				const stopTracking = track(s, parts[s]!, prepared.audioMs, performance.now());
				try {
					await playPrepared(engine, prepared);
				} catch (error) {
					toast.error(error instanceof Error ? error.message : String(error));
				} finally {
					stopTracking();
				}
				if (run !== myRun) return;
			}
			onPlayed?.(items[i]!.id);
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
			run++;
			halt();
			status = 'idle';
			preparing = false;
			return;
		}
		if (status === 'playing') {
			pausePlayback();
			status = 'paused';
		} else if (status === 'paused') {
			resumePlayback();
			status = 'playing';
		} else {
			// Idle: continue from whatever is highlighted — a click, or the saved
			// position from last time — instead of restarting at chunk 0.
			void start(index, sentenceIndex);
		}
	}

	function stop() {
		run++;
		halt();
		status = 'idle';
		preparing = false;
		sentenceIndex = 0;
		pointer = null;
	}

	/**
	 * Follows the chunk being spoken frame by frame so the reader can light up the
	 * current word. Paused time never counts against the chunk's duration.
	 */
	function track(chunk: number, text: string, audioMs: number, beganAt: number) {
		const total = text.split(/\s+/).filter(Boolean).length || 1;
		let pausedAt = 0;
		let pausedTotal = 0;
		let frame = 0;
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
		return () => cancelAnimationFrame(frame);
	}

	/** Long pastes scroll away — keep the spoken chunk in view, but only when it isn't. */
	$effect(() => {
		const current = sentenceIndex;
		if (status !== 'playing' || !autoScroll.current || !chunkList) return;
		chunkList
			.querySelector(`[data-chunk="${current}"]`)
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	/** Click a sentence in the text — the voice starts there instead of at the top. */
	function speakFrom(to: number) {
		if (to < 0 || to >= sentences.length) return;
		run++;
		halt();
		status = 'idle';
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

	/** "~4 min" / "~40s" — a progress number a listener can act on. */
	function formatLeft(seconds: number): string {
		if (seconds < 60) return `~${Math.max(seconds, 1)}s`;
		return `~${Math.round(seconds / 60)} min`;
	}

	/**
	 * Bindings live on runed's PressedKeys (src/lib/keys.ts): the library holds
	 * the pressed state, `onPress` fires once per press and stops the browser
	 * scrolling the page for keys we own. Plain ↑/↓ stay the page's — speed
	 * takes `<`/`>` or Shift + ↑/↓, and `?` belongs to the help component.
	 */
	onPress(' ', toggle);
	onPress('k', toggle);
	onPress('arrowleft', () => (pressedKeys.has('shift') ? jump(index - 1) : skip(-1)));
	onPress('arrowright', () => (pressedKeys.has('shift') ? jump(index + 1) : skip(1)));
	onPress('j', () => skipSeconds(-15));
	onPress('l', () => skipSeconds(30));
	onPress('<', () => stepSpeed(-1));
	onPress('>', () => stepSpeed(1));
	onPress(['shift', 'arrowup'], () => stepSpeed(1));
	onPress(['shift', 'arrowdown'], () => stepSpeed(-1));
	onPress('home', () => speakFrom(0));

	function jump(to: number) {
		if (to < 0 || to >= items.length) return;
		run++;
		halt();
		status = 'idle';
		void start(to);
	}

	function acceptNotice() {
		localStorage.setItem(ackKey(pendingEngine ?? engine), '1');
		noticeOpen = false;
		void start(index, pendingSentence);
		pendingSentence = 0;
	}

	/** A prefetch nobody awaits any more must not raise an unhandled rejection. */
	function tracked(promise: Promise<PreparedSpeech>) {
		promise.catch(() => {});
		return promise;
	}

	// --- resume -------------------------------------------------------------

	// Show the chunk the listener stopped on, so Play continues instead of restarting.
	$effect(() => {
		const id = current?.id;
		if (!id || status !== 'idle' || restoredFor === id) return;
		restoredFor = id;
		const saved = resume.current[id];
		if (saved) sentenceIndex = Math.min(saved, Math.max(sentences.length - 1, 0));
	});

	// Remember the position while listening. Local only — never leaves the device.
	$effect(() => {
		const id = current?.id;
		const chunk = sentenceIndex;
		if (!id || status === 'idle' || resume.current[id] === chunk) return;
		resume.current = { ...resume.current, [id]: chunk };
	});

	// --- lock screen / media keys -------------------------------------------

	$effect(() => {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
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
			try {
				session.metadata = null;
			} catch {
				/* nothing to clear */
			}
		};
	});

	$effect(() => {
		if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
		const session = navigator.mediaSession;
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

	$effect(() => {
		return () => {
			run++;
			halt();
		};
	});
</script>

<!-- Keys are bound in <script> via runed's PressedKeys — no window listener here. -->

<!-- One place builds the progress line, so the card and the compact row can't drift apart. -->
{#snippet progress()}
	{sentenceIndex + 1}/{sentences.length} · {formatLeft(remaining)}
{/snippet}

<div class={compact ? 'flex items-center gap-2' : 'space-y-4'}>
	{#if !compact && current}
		<div class="border border-border bg-card p-4">
			<div class="flex items-start justify-between gap-3">
				<p class="text-xs tracking-widest text-muted-foreground uppercase">
					{index + 1} / {items.length} · {@render progress()}
				</p>
				<Button
					variant="ghost"
					size="xs"
					class="shrink-0 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
					aria-pressed={autoScroll.current}
					onclick={() => (autoScroll.current = !autoScroll.current)}
					title="Keep the page following the voice as it reads"
				>
					<MoveVertical class="size-3.5" />
					Auto-scroll {autoScroll.current ? 'on' : 'off'}
				</Button>
			</div>
			{#if current.title}
				<p class="mt-1 text-sm font-medium">{current.title}</p>
			{/if}
			<p bind:this={chunkList} class="mt-2 text-sm leading-relaxed">
				{#each sentences as part, i (i)}
					<!--
						A real <button> is layout-atomic in Chromium: even at display:inline it
						breaks after every sentence (+32% paragraph height, measured). A span keeps
						the text flowing; role/tabindex + keydown keep it operable (WCAG 2.1.1).
					-->
					<span
						role="button"
						tabindex="0"
						data-chunk={i}
						class="cursor-pointer transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/30 {i ===
							sentenceIndex && playing
							? 'bg-primary/15'
							: 'text-muted-foreground'}"
						onclick={() => speakFrom(i)}
						onkeydown={(event) => {
							if (event.key === 'Enter' || event.key === ' ') {
								event.preventDefault();
								speakFrom(i);
							}
						}}
					>
						{#if i === sentenceIndex && pointer && pointer.text === part}
							<WordLine text={part} word={pointer.word} />
						{:else}{part}{/if}
					</span>
				{/each}
			</p>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 {compact ? '' : 'justify-between'}">
		<div class="flex flex-wrap items-center gap-3 space-x-3">
			<Button
				variant={playing ? 'secondary' : 'default'}
				size={compact ? 'icon-sm' : 'default'}
				onclick={toggle}
				disabled={items.length === 0}
				aria-label={playing ? 'Pause' : 'Play'}
			>
				{#if status === 'loading'}
					<LoaderCircle class="size-4 animate-spin" />
				{:else if playing}
					<Pause class="size-4" />
				{:else}
					<Play class="size-4" />
				{/if}
				{#if !compact}
					<span class="ml-1">
						{status === 'loading'
							? 'Loading voice…'
							: preparing
								? 'Preparing audio…'
								: playing
									? 'Pause'
									: 'Play'}
					</span>
				{/if}
			</Button>

			<!-- Sentence step (fine) and Audible-style time skip (coarse), side by side. -->
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous sentence"
					title="Previous sentence (←)"
					onclick={() => skip(-1)}
					disabled={sentenceIndex <= 0}
				>
					<ChevronLeft class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next sentence"
					title="Next sentence (Right Arrow)"
					onclick={() => skip(1)}
					disabled={sentenceIndex >= sentences.length - 1}
				>
					<ChevronRight class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back 15 seconds"
					title="Back 15 seconds (J)"
					onclick={() => skipSeconds(-15)}
					disabled={sentenceIndex <= 0}
				>
					<Rewind class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Forward 30 seconds"
					title="Forward 30 seconds (L)"
					onclick={() => skipSeconds(30)}
					disabled={sentenceIndex >= sentences.length - 1}
				>
					<FastForward class="size-4" />
				</Button>
			</div>

			{#if items.length > 1}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous"
					onclick={() => jump(index - 1)}
				>
					<SkipBack class="size-4" />
				</Button>
				<Button variant="ghost" size="icon-sm" aria-label="Next" onclick={() => jump(index + 1)}>
					<SkipForward class="size-4" />
				</Button>
			{/if}

			<SpeedMenu {cap} ramp={rampOn} live={liveSpeed} onselect={selectSpeed} ontoggle={setRamp} />

			{#if status !== 'idle'}
				<Button variant="ghost" size="icon-sm" aria-label="Stop" onclick={stop}>
					<Square class="size-4" />
				</Button>
			{/if}

			<KeyboardHelp />
		</div>

		{#if compact}
			<span class="flex items-center gap-3 text-xs text-muted-foreground">
				<AudioLines class="size-3.5 {playing ? 'text-primary' : ''}" />
				{#if sentences.length > 0}
					<span class="tabular-nums">{@render progress()}</span>
				{/if}
				{ENGINES[engine].label}
			</span>
		{/if}
	</div>

	<Dialog.Root bind:open={noticeOpen}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<Download class="size-4 text-primary" />
					Downloads {downloadEstimate(pendingEngine ?? engine)}MB once
				</Dialog.Title>
				<Dialog.Description>
					{ENGINES[pendingEngine ?? engine].label} runs entirely in this browser: the voice model is downloaded
					a single time, cached, and reused offline. Nothing is sent anywhere. On mobile data this counts
					against your allowance.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => (noticeOpen = false)}>Not now</Button>
				<Button onclick={acceptNotice}>Download & play</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>
