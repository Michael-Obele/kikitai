<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste } from '@lucide/svelte';
	import { PersistedState } from 'runed';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import { saveVoiceChoice } from '$lib/remote';
	import { ENGINES, type EngineId } from '$lib/tts';
	import { onTtsStat, type TtsStat } from '$lib/tts/telemetry';

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

	const meta = $derived(ENGINES[engine]);
	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(text.trim() ? [{ id: 'paste', text }] : []);

	const loads = $derived(telemetry.current.filter((s) => s.kind === 'load'));
	const gens = $derived(telemetry.current.filter((s) => s.kind === 'gen'));
	const plays = $derived(telemetry.current.filter((s) => s.kind === 'play'));
	const genAvg = $derived(avgMs(gens));
	const playAvg = $derived(avgMs(plays));
	/** Below 1.0 means generation keeps up with playback — no silent gaps. */
	const ratio = $derived(playAvg > 0 ? Math.round((genAvg / playAvg) * 100) / 100 : 0);

	function avgMs(list: TtsStat[]) {
		if (list.length === 0) return 0;
		return Math.round(list.reduce((sum, s) => sum + s.ms, 0) / list.length);
	}

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

	function engineChanged(event: Event) {
		engine = (event.currentTarget as HTMLSelectElement).value as EngineId;
		voice = ENGINES[engine].defaultVoice;
		voiceChanged();
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

	<div class="mt-4 flex flex-wrap items-end gap-3">
		<div class="space-y-1.5">
			<Label for="readEngine">Engine</Label>
			<select
				id="readEngine"
				class="flex h-8 border border-input bg-background px-2 text-sm"
				value={engine}
				onchange={engineChanged}
			>
				{#each Object.values(ENGINES) as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
			</select>
		</div>
		{#if meta.voices.length > 0}
			<div class="space-y-1.5">
				<Label for="readVoice">Voice</Label>
				<select
					id="readVoice"
					class="flex h-8 border border-input bg-background px-2 text-sm"
					bind:value={voice}
					onchange={voiceChanged}
				>
					{#each meta.voices as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
			</div>
		{/if}
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
					Model load: {loads.length > 0
						? `${Math.round(loads[loads.length - 1]!.ms)} ms`
						: 'not loaded this session'}
					· {ENGINES[engine].label}
				</li>
				<li>
					Generation: {genAvg} ms avg over {gens.length} sentence{gens.length === 1 ? '' : 's'}
				</li>
				<li>
					Playback: {playAvg} ms avg · gen/play = {ratio}
					{ratio === 0 ? '' : ratio < 1 ? '(keeps up — no gaps)' : '(gaps ahead)'}
				</li>
				<li>
					Multi-thread WASM: {isolated ? 'on (cross-origin isolated)' : 'off (single core)'}
				</li>
			</ul>
		</div>
	{/if}
</div>
