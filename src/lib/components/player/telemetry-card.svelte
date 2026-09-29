<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { PersistedState } from 'runed';
	import { Button } from '$lib/components/ui/button';
	import { ENGINES, type EngineId } from '$lib/tts';
	import { onTtsStat, sessionId, type TtsStat } from '$lib/tts/telemetry';
	import { INP_BUDGET_MS, startVitals, vitals } from '$lib/vitals.svelte';

	let { engine = 'kitten', class: className = '' }: { engine?: EngineId; class?: string } =
		$props();

	// One observer set per page — CLS/LCP/INP are page-lifetime numbers, so they
	// are deliberately *not* persisted: a reload starts a fresh measurement.
	startVitals();

	/** Rolling TTS timings, kept so a reload still shows what the last run did. */
	const telemetry = new PersistedState<TtsStat[]>('kikitai.read.telemetry', []);
	/** Cross-origin isolation is what lets ONNX Runtime use more than one core. */
	let isolated = $state(false);

	/**
	 * Only this page load *and* the selected engine — a session that warmed
	 * both engines must not label one's load time as the other's.
	 */
	const mine = $derived(
		telemetry.current.filter((s) => s.session === sessionId && s.engine === engine)
	);
	const loads = $derived(mine.filter((s) => s.kind === 'load'));
	const chunks = $derived(mine.filter((s) => s.kind === 'chunk'));
	const firsts = $derived(mine.filter((s) => s.kind === 'first'));
	const loadMs = $derived(loads.at(-1)?.ms ?? null);
	const firstMs = $derived(firsts.at(-1)?.ms ?? null);
	const cachedCount = $derived(chunks.filter((s) => s.cached).length);
	const mirrored = $derived(loads.at(-1)?.mirror ?? null);
	const fetchMs = $derived(loads.at(-1)?.fetchMs ?? null);
	/** Σgen ÷ Σaudio over the SAME chunks — under 1.0 means playback never waits. */
	const rtf = $derived.by(() => {
		const gen = chunks.reduce((sum, s) => sum + (s.genMs ?? 0), 0);
		const audio = chunks.reduce((sum, s) => sum + s.ms, 0);
		return audio > 0 ? Math.round((gen / audio) * 100) / 100 : null;
	});
	const worstGen = $derived.by(() =>
		chunks.length ? Math.round(Math.max(...chunks.map((s) => s.genMs ?? 0)) / 1000) : null
	);
	/**
	 * A hand-over the listener would hear: chunk N finished, chunk N+1 started
	 * more than a beat later. The lookahead queue exists to keep this at zero —
	 * one of the two P0 metrics every dev build now self-reports.
	 */
	const GAP_MS = 300;
	const gaps = $derived.by(() => {
		let count = 0;
		for (let i = 1; i < chunks.length; i++) {
			const previous = chunks[i - 1]!;
			const current = chunks[i]!;
			if (current.at - current.ms - previous.at > GAP_MS) count++;
		}
		return count;
	});
	/** INP is a p75 by definition; over the budget it is the reason a reader feels lag. */
	const inpOverBudget = $derived(vitals.inp !== null && vitals.inp > INP_BUDGET_MS);
	const inpClass = $derived(inpOverBudget ? 'text-destructive' : '');
	const fmtMs = (value: number | null) => (value === null ? '—' : `${Math.round(value)}ms`);

	$effect(() => {
		isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
	});

	$effect(() => {
		return onTtsStat((stat) => {
			// Loads are rare and always the oldest record — pin them, so the rolling
			// window of gen/play timings can never evict them.
			const pinned = telemetry.current.filter((s) => s.kind === 'load');
			const recent = telemetry.current.filter((s) => s.kind !== 'load').slice(-60);
			telemetry.current = [...recent, ...pinned, stat];
		});
	});
</script>

<!--
	One card, every route: what the last load cost, whether generation keeps up,
	and where the bytes came from. Stats are recorded by the player everywhere;
	this is only the window onto them.
-->
<div class="border border-border p-3 text-[11px] text-muted-foreground {className}">
	<div class="flex items-center justify-between">
		<p class="tracking-widest uppercase">Telemetry</p>
		<Button
			variant="link"
			size="xs"
			class="h-auto p-0 text-[11px] font-normal"
			onclick={() => (telemetry.current = [])}
		>
			Clear
		</Button>
	</div>
	{#if telemetry.current.length === 0 && vitals.inp === null}
		<p class="mt-1.5 text-muted-foreground/70">No measurements yet — press Play.</p>
	{:else}
		<!--
			The headline is one line and always open: RTF (does generation keep up),
			INP (does the interface answer), gaps (does the voice hand over cleanly)
			and the longest main-thread block (did anything stutter). Everything
			else folds away behind it.
		-->
		<details class="group mt-1.5">
			<summary
				class="flex cursor-pointer list-none items-center justify-between gap-2 tabular-nums [&::-webkit-details-marker]:hidden"
			>
				<span class="min-w-0 truncate">
					RTF {rtf ?? '—'} · <span class={inpClass}>INP {fmtMs(vitals.inp)}</span>
					· {gaps} gap{gaps === 1 ? '' : 's'} · block {fmtMs(vitals.maxLongTask)}
				</span>
				<ChevronDown class="size-3 shrink-0 transition-transform group-open:rotate-180" />
			</summary>
			<ul class="mt-1.5 space-y-0.5 tabular-nums">
				<li>
					First audio: {firstMs === null
						? 'not played yet'
						: `${(firstMs / 1000).toFixed(1)} s after Play`}
					{#if loadMs !== null}· load {(loadMs / 1000).toFixed(1)} s{/if}
					{#if fetchMs}· bytes {(fetchMs / 1000).toFixed(1)} s{/if} · {ENGINES[engine].label}
					{#if mirrored !== null}· {mirrored ? 'our mirror' : 'HuggingFace'}{/if}
				</li>
				<li>
					Generation: {chunks.length} chunk{chunks.length === 1 ? '' : 's'}
					{#if rtf !== null}· RTF {rtf} (Σgen ÷ Σaudio — under 1.0 keeps up){/if}
					{#if cachedCount > 0}· {cachedCount} from cache{/if}
				</li>
				<li>
					{#if worstGen !== null}Worst chunk: {worstGen} s to synthesise ·{' '}{/if}Multi-thread
					WASM: {isolated ? 'on (cross-origin isolated)' : 'off (single core)'}
				</li>
				<li>
					Field: CLS {vitals.cls === null ? '—' : vitals.cls.toFixed(3)} · LCP {fmtMs(vitals.lcp)}
					{#if inpOverBudget}· INP over the {INP_BUDGET_MS}ms budget{/if}
				</li>
			</ul>
		</details>
	{/if}
</div>
