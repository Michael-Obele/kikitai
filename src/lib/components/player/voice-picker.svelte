<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { ENGINES, type EngineId } from '$lib/tts';

	let {
		engine = $bindable<EngineId>('kitten'),
		voice = $bindable(''),
		prefix = 'voice',
		onchange
	}: {
		engine?: EngineId;
		voice?: string;
		/** Ids are prefixed so two pickers can share a page without colliding. */
		prefix?: string;
		/** Fires after either field settles, with both values already bound — the host persists them. */
		onchange?: () => void;
	} = $props();

	const meta = $derived(ENGINES[engine]);

	function pickEngine(event: Event) {
		engine = (event.currentTarget as HTMLSelectElement).value as EngineId;
		voice = ENGINES[engine].defaultVoice;
		onchange?.();
	}

	function pickVoice(event: Event) {
		voice = (event.currentTarget as HTMLSelectElement).value;
		onchange?.();
	}
</script>

<!--
	Engine + voice, shared by the read page and the message panel. Local engines
	hide the voice list when the model owns its own voice names (webspeech).
-->
<div class="flex flex-wrap items-end gap-3">
	<div class="space-y-1.5">
		<Label for="{prefix}-engine">Engine</Label>
		<select
			id="{prefix}-engine"
			class="flex h-8 border border-input bg-background px-2 text-sm"
			value={engine}
			onchange={pickEngine}
		>
			{#each Object.values(ENGINES) as option (option.id)}
				<option value={option.id}>{option.label}</option>
			{/each}
		</select>
	</div>
	{#if meta.voices.length > 0}
		<div class="space-y-1.5">
			<Label for="{prefix}-voice">Voice</Label>
			<select
				id="{prefix}-voice"
				class="flex h-8 border border-input bg-background px-2 text-sm"
				value={voice}
				onchange={pickVoice}
			>
				{#each meta.voices as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
	{/if}
	<p class="max-w-56 text-[11px] leading-tight text-muted-foreground">{meta.note}</p>
</div>
