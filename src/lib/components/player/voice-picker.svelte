<script lang="ts">
	import { Cloud, Cpu, HardDrive, Mic } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { ENGINES, type EngineId } from '$lib/tts';
	import { engineAvailable } from '$lib/player-prefs.svelte';

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
	/**
	 * Offline: only engines that can still speak — plus the one already picked,
	 * which always stays in the list so a choice is never silently replaced; its
	 * `note` below explains why it cannot play. The alternative (a disabled
	 * option) would hide it from the click path and put its label at a contrast
	 * we have never measured, so the note carries the news instead.
	 */
	const engineItems = $derived(
		Object.values(ENGINES)
			.filter((option) => engineAvailable(option.id) || option.id === engine)
			.map((option) => ({ value: option.id, label: option.label }))
	);
	const voiceItems = $derived(meta.voices.map((name) => ({ value: name, label: name })));

	/** Picking an engine re-seeds the voice before the host persists both. */
	function pickEngine(next: string) {
		if (!next || next === engine) return;
		engine = next as EngineId;
		voice = ENGINES[engine].defaultVoice;
		onchange?.();
	}

	function pickVoice(next: string) {
		if (!next || next === voice) return;
		voice = next;
		onchange?.();
	}

	/** The engine's own note, plus why it cannot play right now (offline only). */
	const note = $derived.by(() => {
		if (engineAvailable(engine)) return meta.note;
		// Local and cloud fail differently: only one of them gets fixed by waiting.
		return ENGINES[engine].local
			? `${meta.note} Offline: this model is not saved in this browser, so it cannot play yet.`
			: `${meta.note} Offline: this engine sends text to a server, so it needs a connection.`;
	});
</script>

<!--
	Engine + voice, shared by the read page and the message panel. Local engines
	hide the voice list when the model owns its own voice names (webspeech).
-->
<div class="flex flex-wrap items-end gap-3">
	<div class="space-y-1.5">
		<Label for="{prefix}-engine">Engine</Label>
		<Select.Root type="single" value={engine} items={engineItems} onValueChange={pickEngine}>
			<Select.Trigger id="{prefix}-engine" class="min-w-44" aria-describedby="{prefix}-note">
				<span class="flex items-center gap-1.5">
					<Cpu class="size-4 text-muted-foreground" />
					<Select.Value placeholder="Engine" />
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each engineItems as option (option.value)}
					<Select.Item value={option.value} label={option.label}>
						{option.label}
						{#if ENGINES[option.value].local}
							<HardDrive class="ml-auto size-3.5 text-muted-foreground" />
						{:else}
							<Cloud class="ml-auto size-3.5 text-muted-foreground" />
						{/if}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	{#if meta.voices.length > 0}
		<div class="space-y-1.5">
			<Label for="{prefix}-voice">Voice</Label>
			<Select.Root type="single" value={voice} items={voiceItems} onValueChange={pickVoice}>
				<Select.Trigger id="{prefix}-voice" class="min-w-40" aria-describedby="{prefix}-note">
					<span class="flex items-center gap-1.5">
						<Mic class="size-4 text-muted-foreground" />
						<Select.Value placeholder="Voice" />
					</span>
				</Select.Trigger>
				<Select.Content>
					{#each voiceItems as option (option.value)}
						<Select.Item value={option.value} label={option.label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}
	<p id="{prefix}-note" class="max-w-56 text-[11px] leading-tight text-muted-foreground">
		{note}
	</p>
</div>
