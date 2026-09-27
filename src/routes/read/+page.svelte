<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import { ENGINES, type EngineId } from '$lib/tts';

	let { data } = $props();

	let text = $state('');
	// svelte-ignore state_referenced_locally
	let engine = $state<EngineId>((data.settings?.ttsEngine as EngineId) ?? 'kitten');
	// svelte-ignore state_referenced_locally
	let voice = $state(data.settings?.ttsVoice ?? ENGINES.kitten.defaultVoice);

	const meta = $derived(ENGINES[engine]);
	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(text.trim() ? [{ id: 'paste', text }] : []);

	/** Survive back-navigation; the text is never sent anywhere. */
	export const snapshot: Snapshot<string> = {
		capture: () => text,
		restore: (value) => (text = value)
	};

	function engineChanged(event: Event) {
		engine = (event.currentTarget as HTMLSelectElement).value as EngineId;
		voice = ENGINES[engine].defaultVoice;
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
	<header class="flex items-center justify-between">
		<a href="/" class="font-heading text-lg italic">Kikitai</a>
		<Button href="/" variant="ghost" size="sm">Home</Button>
	</header>

	<h1 class="mt-6 flex items-center gap-2 font-heading text-2xl italic">
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
			speed={data.settings?.ttsSpeed ?? 1}
			ramp={data.settings?.ttsRamp ?? false}
		/>
	</div>
</div>
