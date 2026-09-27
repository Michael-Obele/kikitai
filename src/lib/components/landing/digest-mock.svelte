<script lang="ts">
	import { AudioLines, Pause, Play, SkipForward } from '@lucide/svelte';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { linear } from 'svelte/easing';
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils';

	/**
	 * The product shot. It plays the same loop the real digest player runs:
	 * one item at a time, sentence by sentence, with the progress bar tweened.
	 *
	 * The counts here are a sample inbox, not a measurement of anything.
	 */
	const items = [
		{
			from: 'Ada, Ledger',
			subject: 'Invoice #2291 is due Friday',
			category: 'Needs reply',
			priority: 5,
			line: 'Ada needs a reply. Invoice 2291 is due Friday and the payment link is attached.'
		},
		{
			from: 'Buildkite',
			subject: 'Pipeline #482 passed',
			category: 'Updates',
			priority: 2,
			line: 'Pipeline 482 passed in 3 minutes 12 seconds. Nothing to do here.'
		},
		{
			from: 'This week in WebGPU',
			subject: 'Issue 91 is out',
			category: 'News',
			priority: 1,
			line: 'A newsletter you subscribed to. No action needed.'
		}
	];

	/** Seconds of audio each item stands for, only used to render the clock. */
	const PER_ITEM = 14;
	const TOTAL = items.length * PER_ITEM;

	/** One tween runs the whole digest. Everything below is derived from it. */
	const progress = new Tween(0, { duration: TOTAL * 1000 });

	const elapsed = $derived((progress.current / 100) * TOTAL);
	const index = $derived(Math.min(items.length - 1, Math.floor(elapsed / PER_ITEM)));
	const sub = $derived((elapsed % PER_ITEM) / PER_ITEM);
	const current = $derived(items[index] ?? items[0]!);
	const parts = $derived(current.line.split(/(?<=\.)\s+/));
	const activePart = $derived(Math.min(parts.length - 1, Math.floor(sub * parts.length)));

	/** mm:ss for a number of seconds. */
	function clock(seconds: number) {
		const s = Math.max(0, Math.floor(seconds));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	$effect(() => {
		if (prefersReducedMotion.current) {
			untrack(() => progress.set(38, { duration: 0 }));
			return;
		}

		return untrack(() => {
			let alive = true;
			void (async () => {
				while (alive) {
					await progress.set(0, { duration: 0 });
					if (!alive) return;
					await progress.set(100, { duration: TOTAL * 1000, easing: linear });
				}
			})();
			return () => {
				alive = false;
			};
		});
	});
</script>

<div class="overflow-hidden border bg-card shadow-2xl shadow-primary/5">
	<!-- Header -->
	<div class="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
		<div class="flex items-center gap-2">
			<AudioLines class="size-4 text-primary" />
			<p class="text-sm font-medium">Morning digest</p>
			<span class="hidden text-[11px] text-muted-foreground tabular-nums sm:inline">
				{items.length} of 47
			</span>
		</div>
		<span
			class="flex items-center gap-2 text-[11px] tracking-wider text-muted-foreground uppercase"
		>
			<span class="flex h-3 items-end gap-0.5" aria-hidden="true">
				{#each [0, 1, 2, 3] as bar (bar)}
					<span class="digest-bar w-0.5 bg-primary" style="animation-delay: {bar * 140}ms"></span>
				{/each}
			</span>
			listening
		</span>
	</div>

	<!-- Items -->
	<div class="divide-y">
		{#each items as item, i (item.subject)}
			{@const active = i === index}
			{@const rowParts = item.line.split(/(?<=\.)\s+/)}
			<div
				class={cn(
					'relative px-4 py-3 motion-safe:transition-colors motion-safe:duration-500',
					active ? 'bg-signal/5' : 'bg-transparent'
				)}
			>
				<span
					class={cn(
						'absolute inset-y-0 left-0 w-0.75 motion-safe:transition-colors motion-safe:duration-500',
						active ? 'bg-signal' : 'bg-transparent'
					)}
				></span>

				<div class="flex items-baseline justify-between gap-3">
					<p class="truncate text-sm font-medium">{item.subject}</p>
					<span
						class={cn(
							'shrink-0 border px-1.5 py-px text-[10px] tracking-wider uppercase tabular-nums',
							item.priority >= 4
								? 'border-signal/40 bg-signal/10 text-signal-foreground dark:text-signal'
								: 'border-border text-muted-foreground'
						)}
					>
						P{item.priority}
					</span>
				</div>

				<p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<span class="truncate">{item.from}</span>
					<span class="text-border">/</span>
					<span class="shrink-0">{item.category}</span>
				</p>

				<p class="mt-2 text-sm leading-relaxed">
					{#each rowParts as part, p (part)}
						<span
							class={cn(
								'motion-safe:transition-colors motion-safe:duration-300',
								active && p === activePart
									? 'bg-signal/20 text-foreground'
									: active
										? 'text-foreground'
										: 'text-muted-foreground'
							)}>{part}{p < rowParts.length - 1 ? ' ' : ''}</span
						>
					{/each}
				</p>
			</div>
		{/each}
	</div>

	<!-- Player -->
	<div class="flex items-center gap-3 border-t bg-muted/40 px-4 py-3">
		<span class="grid size-7 shrink-0 place-items-center bg-primary text-primary-foreground">
			{#if progress.current > 0 && progress.current < 100}
				<Play class="size-3.5 fill-current" />
			{:else}
				<Pause class="size-3.5 fill-current" />
			{/if}
		</span>
		<div class="h-1 flex-1 bg-border">
			<div class="h-full bg-primary" style="width: {progress.current}%"></div>
		</div>
		<span class="shrink-0 text-[11px] text-muted-foreground tabular-nums">
			{clock(elapsed)} / {clock(TOTAL)}
		</span>
		<SkipForward class="size-3.5 shrink-0 text-muted-foreground" />
	</div>
</div>

<style>
	.digest-bar {
		height: 100%;
		animation: digest-pulse 900ms ease-in-out infinite alternate;
	}

	@keyframes digest-pulse {
		from {
			transform: scaleY(0.3);
		}
		to {
			transform: scaleY(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.digest-bar {
			animation: none;
			transform: scaleY(0.6);
		}
	}
</style>
