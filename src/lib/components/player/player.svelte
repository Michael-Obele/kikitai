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
	import { ENGINES, downloadEstimate } from '$lib/tts';
	import type { EngineId } from '$lib/tts';
	import { onMount } from 'svelte';
	import { appPlayer, type InlineRun, type PlayerStore, type ReaderItem } from '$lib/player.svelte';
	import WordLine from './word-line.svelte';
	import KeyboardHelp from './keyboard-help.svelte';
	import SpeedMenu from './speed-menu.svelte';
	import SleepTimer from './sleep-timer.svelte';

	type Item = { id: string; text: string; title?: string };

	/** Extra rows for the help dialog — `keyboard-help` ships the built-in table. */
	const HELP_ROWS: { keys: string[]; label: string }[] = [
		{ keys: ['S'], label: 'Sleep timer (cycles 5 / 10 / 15 / 30 / 45 min, end of item, off)' }
	];

	let {
		items,
		engine,
		voice,
		compact = false,
		bar = false,
		onPlayed,
		speed,
		ramp,
		pointer = $bindable<{ chunk: number; word: number; text: string } | null>(null),
		store = appPlayer
	}: {
		items: Item[];
		engine: EngineId;
		voice: string;
		compact?: boolean;
		/** The global bar itself — it mounts a player but is not page content. */
		bar?: boolean;
		onPlayed?: (id: string) => void;
		/** Server copy (settings.ttsSpeed) — omitted on the public /read page. */
		speed?: number;
		/** Server copy (settings.ttsRamp). */
		ramp?: boolean;
		/** Live position in the spoken text, so a compact host can render its own line. */
		pointer?: { chunk: number; word: number; text: string } | null;
		/** Which session owns the transport — `/read` passes its own instance. */
		store?: PlayerStore;
	} = $props();

	/** The paragraph the reader view draws its chunks into — used to keep the spoken one in view. */
	let chunkList = $state<HTMLElement | null>(null);

	// First paint (and SSR) already carries the session; the effect keeps it in
	// step afterwards (a new paste, new settings, a changed message body).
	// The store owns the adoption policy — ignoring a prop mid-playback is what
	// lets playback survive `/inbox/[id] → /dashboard → back`.
	// svelte-ignore state_referenced_locally -- deliberate first-paint capture; the effect below owns updates.
	store.adopt({ items, engine, voice, speed, ramp });
	$effect(() => {
		store.adopt({ items, engine, voice, speed, ramp });
	});

	// Read-only mirror of the store's pointer for hosts that `bind:pointer`
	// (message-panel) — the store never writes into a detached component.
	$effect(() => {
		pointer = store.pointer;
	});

	// The store calls this only while it is set.
	$effect(() => {
		store.onPlayed = onPlayed ?? null;
		return () => {
			store.onPlayed = null;
		};
	});

	// The view is a view: detaching never stops playback (`run`/`status` belong
	// to the store). Stop pressed is the only thing that halts the transport.
	onMount(() => {
		store.hosts += 1;
		if (!bar) store.panels += 1;
		if (!compact) store.fullHosts += 1;
		return () => {
			store.hosts -= 1;
			if (!bar) store.panels -= 1;
			if (!compact) store.fullHosts -= 1;
			chunkList = null;
		};
	});

	/** Long pastes scroll away — keep the spoken chunk in view, but only when it isn't. */
	$effect(() => {
		const current = store.sentenceIndex;
		if (store.status !== 'playing' || !store.autoScroll.current || !chunkList) return;
		chunkList
			.querySelector(`[data-chunk="${current}"]`)
			?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	});

	/** "~4 min" / "~40s" — a progress number a listener can act on. */
	function formatLeft(seconds: number): string {
		if (seconds < 60) return `~${Math.max(seconds, 1)}s`;
		return `~${Math.round(seconds / 60)} min`;
	}

	/**
	 * The emphasis a run carried, as classes. Markdown syntax never survives into
	 * this: `runs` are already plain text, so nothing is ever spoken as "asterisk".
	 */
	function runClass(run: InlineRun): string {
		if (run.code) return 'rounded-sm bg-muted px-1 font-mono text-[0.9em]';
		if (run.strong) return 'font-semibold text-foreground';
		if (run.em) return 'italic';
		if (run.del) return 'line-through';
		return '';
	}
</script>

<!-- Keys are bound in the store via runed's PressedKeys — no window listener here. -->

<!-- One place builds the progress line, so the card and the compact row can't drift apart. -->
{#snippet progress()}
	{store.sentenceIndex + 1}/{store.sentences.length} · {formatLeft(store.remaining)}
{/snippet}

<!--
	A real <button> is layout-atomic in Chromium: even at display:inline it breaks
	after every sentence (+32% paragraph height, measured). A span keeps the text
	flowing; role/tabindex + keydown keep it operable (WCAG 2.1.1). One snippet
	serves every Markdown block, so a heading, a quote and a list item are all
	clickable the same way.

	The `{' '}` closing each sentence is load-bearing, not decoration: the compiler
	trims template whitespace that sits between blocks, so without it two chunks
	run together as "…your own plan.Here's the honest answer" (measured gap 0px).
-->
{#snippet chunks(list: ReaderItem[])}
	{#each list as item (item.index)}
		{@const spoken = item.index === store.sentenceIndex && store.pointer?.text === item.text}
		<span
			role="button"
			tabindex="0"
			data-chunk={item.index}
			class="cursor-pointer transition-colors hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/30 {item.index ===
				store.sentenceIndex && store.playing
				? 'bg-primary/15'
				: 'text-muted-foreground'}"
			onclick={() => store.speakFrom(item.index)}
			onkeydown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					store.speakFrom(item.index);
				}
			}}
		>
			{#if spoken}<WordLine
					text={item.text}
					word={store.pointer?.word ?? -1}
				/>{:else}{#each item.runs as run, runIndex (runIndex)}<span class={runClass(run)}>{run.text}</span
					>{/each}{/if}
		</span>{' '}
	{/each}
{/snippet}

<div class={compact ? 'flex items-center gap-2' : 'space-y-4'}>
	{#if !compact && store.current}
		<div class="border border-border bg-card p-4">
			<div class="flex items-start justify-between gap-3">
				<p class="text-xs tracking-widest text-muted-foreground uppercase">
					{store.index + 1} / {store.items.length} · {@render progress()}
				</p>
				<Button
					variant="ghost"
					size="xs"
					class="shrink-0 text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
					aria-pressed={store.autoScroll.current}
					onclick={() => (store.autoScroll.current = !store.autoScroll.current)}
					title="Keep the page following the voice as it reads"
				>
					<MoveVertical class="size-3.5" />
					Auto-scroll {store.autoScroll.current ? 'on' : 'off'}
				</Button>
			</div>
			{#if store.current.title}
				<p class="mt-1 text-sm font-medium">{store.current.title}</p>
			{/if}
			<!--
				The pasted text as the reader wrote it: one element per Markdown block, so
				paragraphs stay apart, headings stay headings and a quote stays quoted.
				Bullets and numbers come from `block.marker` — the syntax that produced
				them is already gone, which is why the voice never reads it.
			-->
			<div bind:this={chunkList} class="mt-2 space-y-2 text-sm leading-relaxed">
				{#each store.reader.rows as row}
					{#if row.kind === 'list'}
						<svelte:element this={row.ordered ? 'ol' : 'ul'} role="list" class="ml-4 space-y-1">
							{#each row.items as item}
								<li>
									<!--
										The marker is drawn, not inherited: `list-style` is off (Tailwind's
										preflight), so the browser would otherwise draw a second bullet beside this
										one — and an <ol> would restart at 1 instead of honouring its `start`.
										It is decoration: `role="list"` above is what tells a screen reader.
									-->
									<span class="mr-1 text-muted-foreground" aria-hidden="true"
										>{item.block.marker}</span
									>{@render chunks(item.items)}
								</li>
							{/each}
						</svelte:element>
					{:else if row.block.kind === 'rule'}
						<hr class="border-border" />
					{:else if row.block.kind === 'code'}
						<pre
							class="overflow-x-auto rounded-sm bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{@render chunks(
								row.items
							)}</pre>
					{:else if row.block.kind === 'quote'}
						<blockquote class="border-l-2 border-border pl-3 text-muted-foreground italic">
							<p>{@render chunks(row.items)}</p>
						</blockquote>
					{:else if row.block.kind === 'heading'}
						<svelte:element
							this={`h${row.block.depth ?? 2}`}
							class="pt-2 font-heading font-semibold text-foreground"
						>
							{@render chunks(row.items)}
						</svelte:element>
					{:else}
						<p>{@render chunks(row.items)}</p>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-3 {compact ? '' : 'justify-between'}">
		<div class="flex flex-wrap items-center gap-3 space-x-3">
			<Button
				variant={store.playing ? 'secondary' : 'default'}
				size={compact ? 'icon-sm' : 'default'}
				onclick={store.toggle}
				disabled={store.items.length === 0}
				aria-label={store.playing ? 'Pause' : 'Play'}
			>
				{#if store.status === 'loading'}
					<LoaderCircle class="size-4 animate-spin" />
				{:else if store.playing}
					<Pause class="size-4" />
				{:else}
					<Play class="size-4" />
				{/if}
				{#if !compact}
					<span class="ml-1">
						{store.status === 'loading'
							? 'Loading voice…'
							: store.preparing
								? 'Preparing audio…'
								: store.playing
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
					onclick={() => store.skip(-1)}
					disabled={store.sentenceIndex <= 0}
				>
					<ChevronLeft class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next sentence"
					title="Next sentence (Right Arrow)"
					onclick={() => store.skip(1)}
					disabled={store.sentenceIndex >= store.sentences.length - 1}
				>
					<ChevronRight class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Back 15 seconds"
					title="Back 15 seconds (J)"
					onclick={() => store.skipSeconds(-15)}
					disabled={store.sentenceIndex <= 0}
				>
					<Rewind class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Forward 30 seconds"
					title="Forward 30 seconds (L)"
					onclick={() => store.skipSeconds(30)}
					disabled={store.sentenceIndex >= store.sentences.length - 1}
				>
					<FastForward class="size-4" />
				</Button>
			</div>

			{#if store.items.length > 1}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous"
					onclick={() => store.jump(store.index - 1)}
				>
					<SkipBack class="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next"
					onclick={() => store.jump(store.index + 1)}
				>
					<SkipForward class="size-4" />
				</Button>
			{/if}

			<SpeedMenu
				cap={store.cap}
				ramp={store.rampOn}
				live={store.liveSpeed}
				onselect={store.selectSpeed}
				ontoggle={store.setRamp}
			/>

			<SleepTimer
				mode={store.sleepMode}
				minutes={store.sleepMinutes}
				left={store.sleepLeft}
				onselect={store.setSleep}
			/>

			{#if store.status !== 'idle'}
				<Button variant="ghost" size="icon-sm" aria-label="Stop" onclick={store.stop}>
					<Square class="size-4" />
				</Button>
			{/if}

			<KeyboardHelp rows={HELP_ROWS} />
		</div>

		{#if compact}
			<span class="flex items-center gap-3 text-xs text-muted-foreground">
				<AudioLines class="size-3.5 {store.playing ? 'text-primary' : ''}" />
				{#if store.sentences.length > 0}
					<span class="tabular-nums">{@render progress()}</span>
				{/if}
				{ENGINES[store.engine].label}
			</span>
		{/if}
	</div>

	<!-- Open ⇔ the store has a pending (not yet acknowledged) engine download. -->
	<Dialog.Root
		open={store.pendingEngine !== null}
		onOpenChange={(open) => {
			if (!open) store.dismissNotice();
		}}
	>
		<Dialog.Content class="sm:max-w-sm">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<Download class="size-4 text-primary" />
					Downloads {downloadEstimate(store.pendingEngine ?? store.engine)}MB once
				</Dialog.Title>
				<Dialog.Description>
					{ENGINES[store.pendingEngine ?? store.engine].label} runs entirely in this browser: the voice
					model is downloaded a single time, cached, and reused offline. Nothing is sent anywhere. On
					mobile data this counts against your allowance.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Footer>
				<Button variant="ghost" onclick={() => store.dismissNotice()}>Not now</Button>
				<Button onclick={store.acceptNotice}>Download & play</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>
