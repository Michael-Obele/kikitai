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
	import { prefersReducedMotion } from 'svelte/motion';
	import { appPlayer, type InlineRun, type PlayerStore, type ReaderItem } from '$lib/player.svelte';
	import WordLine from './word-line.svelte';
	import KeyboardHelp from './keyboard-help.svelte';
	import SpeedMenu from './speed-menu.svelte';
	import SleepTimer from './sleep-timer.svelte';
	import ReaderSettings from '$lib/components/reader/reader-settings.svelte';

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
		stickyControls = false,
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
		/**
		 * Pin this reader's control row to the bottom of the viewport while the card is
		 * on screen — for a page whose reader *is* the page's transport (`/read`),
		 * where a long article pushes Play far below the fold. The row stays in flow,
		 * so it settles into its own place at the end of the article and nothing is
		 * ever hidden for good. Ignored when `compact`.
		 */
		stickyControls?: boolean;
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

	/**
	 * Where the spoken sentence comes to rest while auto-scroll follows the voice.
	 * `scrollIntoView({ block: 'nearest' })` cannot express this: it aligns the
	 * bottom edge coming up from below but the top edge coming back from above, so
	 * a sentence that drifted off the top landed flush against the top of the
	 * screen — measured 72% down the screen from below, 0% from above. These two
	 * numbers place it the same way either direction: it stays put while it is
	 * inside the band, and lands at `FOLLOW_BAND_BOTTOM` when it leaves it.
	 */
	const FOLLOW_BAND_TOP = 0.3;
	const FOLLOW_BAND_BOTTOM = 0.75;

	/**
	 * Long pastes scroll away — keep the spoken sentence in view, but only when it
	 * isn't. Deliberately not `scrollIntoView` (see the band above): the follow is
	 * symmetric, so the sentence lands in the same comfortable place whether it
	 * drifted below or above. Instant, not smooth, when less motion was asked for.
	 */
	$effect(() => {
		const current = store.sentenceIndex;
		if (store.status !== 'playing' || !store.autoScroll.current || !chunkList) return;
		const el = chunkList.querySelector(`[data-chunk="${current}"]`);
		if (!el) return;
		const box = el.getBoundingClientRect();
		const viewport = window.innerHeight;
		const bandTop = viewport * FOLLOW_BAND_TOP;
		const bandBottom = viewport * FOLLOW_BAND_BOTTOM;
		// A sentence taller than the band can never satisfy both edges: anchor by
		// its top, so it still stops moving instead of scrolling on every word.
		const settled =
			box.height > bandBottom - bandTop
				? box.top >= bandTop && box.top <= bandBottom
				: box.top >= bandTop && box.bottom <= bandBottom;
		if (settled) return;
		window.scrollBy({
			top: box.bottom - bandBottom,
			behavior: prefersReducedMotion.current ? 'auto' : 'smooth'
		});
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
				/>{:else}{#each item.runs as run, runIndex (runIndex)}<span class={runClass(run)}
						>{run.text}</span
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
			<div
				bind:this={chunkList}
				class="reading mt-2 space-y-2 leading-(--reader-leading) wrap-anywhere"
			>
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
						<!--
							`0.85em` rather than a fixed `text-xs`: a code block is read at the
							same size as the prose around it, so it follows the reader's choice
							instead of sitting at 12px while everything else grows.
							`wrap-normal` opts this block out of `.reading`'s `wrap-anywhere`:
							code is precise, so a long line scrolls rather than splitting
							mid-identifier. It wins where a utility on the reader itself could
							not — this value is inherited, and a declaration on the element
							always beats inheritance.
						-->
						<pre
							class="overflow-x-auto rounded-sm bg-muted p-3 font-mono text-[0.85em] wrap-normal whitespace-pre-wrap">{@render chunks(
								row.items
							)}</pre>
					{:else if row.block.kind === 'quote'}
						<blockquote class="border-l-2 border-border pl-3 text-muted-foreground italic">
							<p>{@render chunks(row.items)}</p>
						</blockquote>
					{:else if row.block.kind === 'heading'}
						<svelte:element
							this={`h${row.block.depth ?? 2}`}
							class="reading-heading pt-2 font-semibold text-foreground"
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

	<!--
		One row, three hosts: the global compact bar, a page that pins it, and the
		plain row in flow. A snippet, so the pinned and in-flow cases cannot drift.
	-->
	{#snippet controls()}
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

				<!-- Only the full reader shows article text, so only it needs the control. -->
				{#if !compact}
					<ReaderSettings align="start" />
				{/if}

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
	{/snippet}

	{#if stickyControls && !compact}
		<!--
			Sticky and still in flow, the way `(app)/+layout.svelte` pins its own
			transport: it floats over the tail of a long article and then settles into
			its own row at the end, so nothing needs a fixed offset. It takes the
			card's surface, because while stuck the text passes underneath it. The
			follow band keeps the spoken sentence in the upper three quarters, so the
			bar never covers the line being read.

			`data-bottom-chrome` tells `scroll-nav.svelte` this bar has the bottom of
			the viewport while the article is on screen, so the pill parks above it
			instead of on top of a control.
		-->
		<div data-bottom-chrome class="sticky bottom-0 z-10 border-t border-border bg-card py-2">
			{@render controls()}
		</div>
	{:else}
		{@render controls()}
	{/if}

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
