<script lang="ts">
	import {
		AudioLines,
		Download,
		LoaderCircle,
		Pause,
		Play,
		SkipBack,
		SkipForward,
		Square
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { toast } from 'svelte-sonner';
	import { saveVoiceSpeed } from '$lib/remote';
	import {
		DEFAULT_SPEED,
		ENGINES,
		halt,
		pausePlayback,
		resumePlayback,
		speak,
		toSentences,
		warmUp
	} from '$lib/tts';
	import type { EngineId } from '$lib/tts';
	import SpeedMenu from './speed-menu.svelte';

	type Item = { id: string; text: string; title?: string };

	let {
		items,
		engine,
		voice,
		compact = false,
		onPlayed,
		speed = 1,
		ramp = false
	}: {
		items: Item[];
		engine: EngineId;
		voice: string;
		compact?: boolean;
		onPlayed?: (id: string) => void;
		/** Saved speed cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
	} = $props();

	let index = $state(0);
	let sentenceIndex = $state(0);
	let status = $state<'idle' | 'loading' | 'playing' | 'paused'>('idle');
	let noticeOpen = $state(false);

	let current = $derived(items[index] ?? null);
	let sentences = $derived(current ? toSentences(current.text) : []);
	let playing = $derived(status === 'playing' || status === 'loading');

	/** Generation counter — any stale loop bails out as soon as it changes. */
	let run = 0;
	let pendingEngine = $state<EngineId | null>(null);

	/** Cap + ramp mirrored from the props so menu edits win until a refresh lands. */
	// svelte-ignore state_referenced_locally
	let cap = $state(speed);
	// svelte-ignore state_referenced_locally
	let rampOn = $state(ramp);
	/** What is actually playing: the cap, or the climbing value while ramping. */
	let liveSpeed = $state(DEFAULT_SPEED);

	const RAMP_MS = 120_000;

	$effect(() => {
		cap = speed;
	});
	$effect(() => {
		rampOn = ramp;
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

	function ackKey(engineId: EngineId) {
		return `kikitai-tts-ack:${engineId}`;
	}

	async function start(from: number) {
		const meta = ENGINES[engine];
		if (meta.downloadMb > 0 && !localStorage.getItem(ackKey(engine))) {
			index = Math.min(Math.max(from, 0), items.length - 1);
			pendingEngine = engine;
			noticeOpen = true;
			return;
		}

		const myRun = ++run;
		status = 'loading';
		try {
			await warmUp(engine);
		} catch (error) {
			if (run === myRun) status = 'idle';
			toast.error(error instanceof Error ? error.message : 'Could not load the voice model.');
			return;
		}
		if (run !== myRun) return;

		status = 'playing';
		for (let i = Math.max(from, 0); i < items.length; i++) {
			if (run !== myRun) return;
			index = i;
			const parts = toSentences(items[i]!.text);
			for (let s = 0; s < parts.length; s++) {
				if (run !== myRun) return;
				sentenceIndex = s;
				await speak(engine, voice, parts[s]!, (message) => toast.error(message), liveSpeed);
				if (run !== myRun) return;
			}
			onPlayed?.(items[i]!.id);
		}
		if (run === myRun) {
			status = 'idle';
			index = 0;
			sentenceIndex = 0;
		}
	}

	function persist(next: { speed: number; ramp: boolean }) {
		void saveVoiceSpeed(next).catch(() => {
			/* signed out (public /read) — keep it session-local */
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

	function toggle() {
		if (status === 'playing') {
			pausePlayback();
			status = 'paused';
		} else if (status === 'paused') {
			resumePlayback();
			status = 'playing';
		} else {
			void start(index);
		}
	}

	function stop() {
		run++;
		halt();
		status = 'idle';
		sentenceIndex = 0;
	}

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
		void start(index);
	}

	$effect(() => {
		return () => {
			run++;
			halt();
		};
	});
</script>

<div class={compact ? 'flex items-center gap-2' : 'space-y-4'}>
	{#if !compact && current}
		<div class="border border-border bg-card p-4">
			<p class="text-xs tracking-widest text-muted-foreground uppercase">
				{index + 1} / {items.length}
			</p>
			{#if current.title}
				<p class="mt-1 text-sm font-medium">{current.title}</p>
			{/if}
			<p class="mt-2 text-sm leading-relaxed">
				{#each sentences as part, i (i)}
					<span class={i === sentenceIndex && playing ? 'bg-primary/15' : 'text-muted-foreground'}
						>{part}
					</span>
				{/each}
			</p>
		</div>
	{/if}

	<div class="flex items-center gap-1.5 {compact ? '' : 'justify-between'}">
		<div class="flex items-center gap-1.5">
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
						{status === 'loading' ? 'Loading voice…' : playing ? 'Pause' : 'Play'}
					</span>
				{/if}
			</Button>

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
		</div>

		{#if compact}
			<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<AudioLines class="size-3.5 {playing ? 'text-primary' : ''}" />
				{ENGINES[engine].label}
			</span>
		{/if}
	</div>

	<Dialog.Root bind:open={noticeOpen}>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<Download class="size-4 text-primary" />
					Downloads {ENGINES[pendingEngine ?? engine].downloadMb}MB once
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
