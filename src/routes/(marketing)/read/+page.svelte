<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste } from '@lucide/svelte';
	import { PersistedState } from 'runed';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import VoicePicker from '$lib/components/player/voice-picker.svelte';
	import { saveVoiceChoice } from '$lib/remote';
	import { ENGINES, type EngineId } from '$lib/tts';
	import { onTtsStat, sessionId, type TtsStat } from '$lib/tts/telemetry';

	let { data } = $props();

	/** The picked voice, remembered here for everyone (the server copy wins when signed in). */
	const prefs = new PersistedState('kikitai.read.voice', {
		engine: 'kitten' as EngineId,
		voice: ENGINES.kitten.defaultVoice
	});
	/** Rolling TTS timings, kept so a reload still shows what the last run did. */
	const telemetry = new PersistedState<TtsStat[]>('kikitai.read.telemetry', []);

	let text = $state('');
	// svelte-ignore state_referenced_locally
	let engine = $state<EngineId>((data.settings?.ttsEngine as EngineId) ?? 'kitten');
	// svelte-ignore state_referenced_locally
	let voice = $state(data.settings?.ttsVoice ?? ENGINES.kitten.defaultVoice);
	/** Cross-origin isolation is what lets ONNX Runtime use more than one core. */
	let isolated = $state(false);
	/** localStorage only exists on the client — adopt it after mount. */
	let hydrated = $state(false);

	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(text.trim() ? [{ id: 'paste', text }] : []);

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

	/** Survive back-navigation; the text is never sent anywhere. */
	export const snapshot: Snapshot<string> = {
		capture: () => text,
		restore: (value) => (text = value)
	};

	$effect(() => {
		isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
	});

	$effect(() => {
		hydrated = true;
		// Signed-out: swap in the remembered voice (SSR rendered the defaults).
		if (!data.settings) {
			engine = prefs.current.engine;
			voice = prefs.current.voice;
		}
	});

	$effect(() => {
		return onTtsStat((stat) => {
			// Loads are rare and always the oldest record — pin them, so the rolling
			// window of gen/play timings can never evict them.
			const loads = telemetry.current.filter((s) => s.kind === 'load');
			const recent = telemetry.current.filter((s) => s.kind !== 'load').slice(-60);
			telemetry.current = [...recent, ...loads, stat];
		});
	});

	/** Remember the choice here; signed-in users get it on the server too. */
	function voiceChanged() {
		prefs.current = { engine, voice };
		void saveVoiceChoice({ engine, voice }).catch(() => {
			/* signed out — localStorage is the source of truth */
		});
	}
</script>

<svelte:head>
	<title>Paste & read · Kikitai</title>
	<meta
		name="description"
		content="Paste any text and hear it read aloud in your browser — free, offline, nothing uploaded."
	/>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6 sm:px-6">
	<h1 class="flex items-center gap-2 font-heading text-2xl italic">
		<ClipboardPaste class="size-5 text-primary" /> Paste &amp; read
	</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		Anything you paste is read aloud right here. It stays on this device — no upload, no account
		needed.
	</p>

	<div class="mt-6 space-y-1.5">
		<Label for="pasteText">Text</Label>
		<textarea
			id="pasteText"
			rows={10}
			bind:value={text}
			placeholder="Paste an article, a chapter, a PDF page…"
			class="flex w-full border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50"
		></textarea>
		<p class="text-xs text-muted-foreground">{words} words · nothing leaves your device</p>
	</div>

	<div class="mt-4">
		<VoicePicker bind:engine bind:voice prefix="read" onchange={voiceChanged} />
	</div>

	<div class="mt-4 border border-border p-3">
		<Player
			{items}
			{engine}
			{voice}
			speed={data.settings?.ttsSpeed}
			ramp={data.settings?.ttsRamp}
		/>
	</div>

	{#if hydrated && telemetry.current.length > 0}
		<div class="mt-4 border border-border p-3 text-[11px] text-muted-foreground">
			<div class="flex items-center justify-between">
				<p class="tracking-widest uppercase">Telemetry</p>
				<button
					type="button"
					class="text-primary hover:underline"
					onclick={() => (telemetry.current = [])}
				>
					Clear
				</button>
			</div>
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
			</ul>
		</div>
	{/if}
</div>
