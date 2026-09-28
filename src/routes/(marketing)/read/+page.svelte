<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste } from '@lucide/svelte';
	import { PersistedState } from 'runed';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import VoicePicker from '$lib/components/player/voice-picker.svelte';
	import { saveVoiceChoice } from '$lib/remote';
	import { ENGINES, type EngineId } from '$lib/tts';
	import TelemetryCard from '$lib/components/player/telemetry-card.svelte';

	let { data } = $props();

	/** The picked voice, remembered here for everyone (the server copy wins when signed in). */
	const prefs = new PersistedState('kikitai.read.voice', {
		engine: 'kitten' as EngineId,
		voice: ENGINES.kitten.defaultVoice
	});

	let text = $state('');
	// svelte-ignore state_referenced_locally
	let engine = $state<EngineId>((data.settings?.ttsEngine as EngineId) ?? 'kitten');
	// svelte-ignore state_referenced_locally
	let voice = $state(data.settings?.ttsVoice ?? ENGINES.kitten.defaultVoice);
	/** localStorage only exists on the client — adopt it after mount. */
	let hydrated = $state(false);

	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(text.trim() ? [{ id: 'paste', text }] : []);

	/** Survive back-navigation; the text is never sent anywhere. */
	export const snapshot: Snapshot<string> = {
		capture: () => text,
		restore: (value) => (text = value)
	};

	$effect(() => {
		hydrated = true;
		// Signed-out: swap in the remembered voice (SSR rendered the defaults).
		if (!data.settings) {
			engine = prefs.current.engine;
			voice = prefs.current.voice;
		}
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

<div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
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

	<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
		<div class="min-w-0">
			<div class="border border-border p-3">
				<Player
					{items}
					{engine}
					{voice}
					speed={data.settings?.ttsSpeed}
					ramp={data.settings?.ttsRamp}
				/>
			</div>
		</div>

		<aside class="space-y-4 lg:sticky lg:top-6">
			<div class="border border-border p-3">
				<VoicePicker bind:engine bind:voice prefix="read" onchange={voiceChanged} />
			</div>

			<TelemetryCard {engine} />
		</aside>
	</div>
</div>
