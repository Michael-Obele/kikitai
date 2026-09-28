<script lang="ts">
	import { PersistedState } from 'runed';
	import { Button } from '$lib/components/ui/button';
	import { ENGINES, type EngineId } from '$lib/tts';
	import { onTtsStat, sessionId, type TtsStat } from '$lib/tts/telemetry';

	let { engine = 'kitten', class: className = '' }: { engine?: EngineId; class?: string } =
		$props();

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
	{#if telemetry.current.length === 0}
		<p class="mt-1.5 text-muted-foreground/70">No measurements yet — press Play.</p>
	{:else}
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
				{#if worstGen !== null}Worst chunk: {worstGen} s to synthesise ·{' '}{/if}Multi-thread WASM: {isolated
					? 'on (cross-origin isolated)'
					: 'off (single core)'}
			</li>
		</ul>
	{/if}
</div>
