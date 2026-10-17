<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { AreaChart } from 'layerchart';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';

	/**
	 * Category split. Rendered as plain bars because it is one bar per category:
	 * a charting library would be a lot of machinery for five rectangles.
	 * Counts are a sample inbox, not a measurement.
	 */
	const categories = [
		{ key: 'needs_reply', label: 'Needs reply', count: 6, color: 'var(--chart-1)' },
		{ key: 'updates', label: 'Updates', count: 14, color: 'var(--chart-2)' },
		{ key: 'promo', label: 'Promo', count: 17, color: 'var(--chart-3)' },
		{ key: 'news', label: 'News', count: 8, color: 'var(--chart-4)' },
		{ key: 'spam_suspect', label: 'Spam suspect', count: 2, color: 'var(--chart-5)' }
	];

	const peak = Math.max(...categories.map((c) => c.count));

	/**
	 * Minutes spent on mail each morning, same sample week. This one is a real
	 * time series, so it goes through LayerChart.
	 */
	const week = [
		{ day: 'Mon', all: 16, digest: 3 },
		{ day: 'Tue', all: 22, digest: 4 },
		{ day: 'Wed', all: 14, digest: 2 },
		{ day: 'Thu', all: 19, digest: 3 },
		{ day: 'Fri', all: 26, digest: 5 },
		{ day: 'Sat', all: 9, digest: 2 },
		{ day: 'Sun', all: 7, digest: 2 }
	];

	const chartConfig = {
		all: { label: 'Read it all', color: 'var(--muted-foreground)' },
		digest: { label: 'Listen to the digest', color: 'var(--chart-3)' }
	} satisfies Chart.ChartConfig;

	/** Growth factor, so both charts draw themselves in rather than appearing. */
	const grow = new Tween(0, { duration: 1100 });
	let root: HTMLElement | null = $state(null);

	/**
	 * Remount the chart when its container width changes. Layerchart measures
	 * clientWidth once at construction; its ResizeObserver re-measure does not
	 * report in every context (hidden or throttled tabs), which would leave a
	 * stale wide SVG. A direct read on window resize is reliable everywhere.
	 */
	let boxWidth = $state(0);

	$effect(() => {
		const node = root;
		if (!node) return;

		const measure = () => (boxWidth = Math.round(node.clientWidth));
		measure();

		let timer: ReturnType<typeof setTimeout> | undefined;
		const onResize = () => {
			clearTimeout(timer);
			timer = setTimeout(measure, 120);
		};
		// A resize that happened while the tab was hidden may never have fired
		// resize for us; re-measure when it comes back.
		const onVisible = () => {
			if (document.visibilityState === 'visible') measure();
		};
		window.addEventListener('resize', onResize);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			window.removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVisible);
			clearTimeout(timer);
		};
	});

	$effect(() => {
		if (prefersReducedMotion.current) {
			untrack(() => grow.set(1, { duration: 0 }));
			return;
		}

		const node = root;
		if (!node) return;

		const draw = () => void grow.set(1, { duration: 1100, easing: cubicOut });

		// Already on screen: draw straight away rather than waiting for the observer.
		const rect = node.getBoundingClientRect();
		if (rect.top < window.innerHeight && rect.bottom > 0) {
			draw();
			return;
		}

		let reported = false;

		const io = new IntersectionObserver(
			(entries) => {
				reported = true;
				if (!entries[0]?.isIntersecting) return;
				io.disconnect();
				draw();
			},
			{ threshold: 0.2 }
		);
		io.observe(node);

		// An observer always reports once, even for off-screen targets. Silence means
		// it is not running, so draw anyway rather than leaving empty axes on screen.
		const failsafe = setTimeout(() => {
			if (!reported) draw();
		}, 1200);

		return () => {
			io.disconnect();
			clearTimeout(failsafe);
		};
	});

	const scaled = $derived(
		week.map((d) => ({ ...d, all: d.all * grow.current, digest: d.digest * grow.current }))
	);
	const totalAll = $derived(Math.round(week.reduce((sum, d) => sum + d.all, 0) * grow.current));
	const totalDigest = $derived(
		Math.round(week.reduce((sum, d) => sum + d.digest, 0) * grow.current)
	);
</script>

<div bind:this={root} class="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
	<!-- Category split -->
	<div class="min-w-0">
		<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
			47 messages, one Tuesday
		</p>
		<h3 class="mt-3 font-heading text-title italic">Sorted before you read a word</h3>
		<p class="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
			Each message gets a category, a two line summary and a priority from 1 to 5. Six of these need
			you. The other forty one do not.
		</p>

		<ul class="mt-8 space-y-4">
			{#each categories as cat (cat.key)}
				<li>
					<div class="flex items-baseline justify-between gap-3 text-sm">
						<span class="flex items-center gap-2">
							<span class="size-2.5 shrink-0" style="background: {cat.color}"></span>
							{cat.label}
						</span>
						<span class="text-muted-foreground tabular-nums">
							{Math.round(cat.count * grow.current)}
						</span>
					</div>
					<div class="mt-2 h-1.5 bg-muted">
						<div
							class="h-full"
							style="background: {cat.color}; width: {(cat.count / peak) * 100 * grow.current}%"
						></div>
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<!-- Reading time -->
	<div class="min-w-0">
		<div class="flex flex-wrap items-baseline justify-between gap-4">
			<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
				Minutes on mail, sample week
			</p>
			<div class="flex items-center gap-4 text-[11px]">
				<span class="flex items-center gap-1.5 text-muted-foreground">
					<span class="h-2.5 w-2.5" style="background: {chartConfig.all.color}"></span>
					Read it all
				</span>
				<span class="flex items-center gap-1.5">
					<span class="h-2.5 w-2.5" style="background: {chartConfig.digest.color}"></span>
					Digest
				</span>
			</div>
		</div>

		<div class="mt-4 flex items-baseline gap-4">
			<p class="font-heading text-4xl italic tabular-nums">{totalAll}</p>
			<span class="text-muted-foreground">minutes</span>
			<ArrowRight class="size-5 shrink-0 text-border" />
			<p class="font-heading text-4xl text-primary italic tabular-nums">{totalDigest}</p>
			<span class="text-muted-foreground">minutes</span>
		</div>

		{#key boxWidth}
			<Chart.Container config={chartConfig} class="mt-6 aspect-auto w-full">
				<AreaChart
					data={scaled}
					x="day"
					series={[
						{ key: 'all', label: chartConfig.all.label, color: chartConfig.all.color },
						{ key: 'digest', label: chartConfig.digest.label, color: chartConfig.digest.color }
					]}
					yNice
					height={256}
				>
					{#snippet tooltip()}
						<Chart.Tooltip labelKey="day" />
					{/snippet}
				</AreaChart>
			</Chart.Container>
		{/key}

		<p class="mt-2 text-xs text-muted-foreground">
			Same mail, counted both ways. The digest is the six that need you plus a one line note on the
			rest.
		</p>
	</div>
</div>
