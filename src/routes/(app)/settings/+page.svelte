<script lang="ts">
	import {
		ArrowRight,
		Languages,
		LoaderCircle,
		Mail,
		Plus,
		Save,
		Sparkles,
		Trash2,
		Volume2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import Player from '$lib/components/player/player.svelte';
	import { getAccountStatus, saveSettings, saveVoiceSpeed } from '$lib/remote';
	import { ENGINES, SPEED_STEPS, type EngineId } from '$lib/tts';
	import { pronunciation } from '$lib/tts/pronunciation';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let engine = $state<EngineId>(data.settings.ttsEngine as EngineId);
	// svelte-ignore state_referenced_locally
	let voice = $state(data.settings.ttsVoice);
	// svelte-ignore state_referenced_locally
	let speed = $state(data.settings.ttsSpeed ?? 1);
	// svelte-ignore state_referenced_locally
	let rampOn = $state(data.settings.ttsRamp ?? false);
	// svelte-ignore state_referenced_locally
	let aiBaseUrl = $state(data.settings.aiBaseUrl);
	// svelte-ignore state_referenced_locally
	let aiModel = $state(data.settings.aiModel);
	let aiKey = $state('');
	// svelte-ignore state_referenced_locally
	let syncWindowDays = $state(data.settings.syncWindowDays);

	const meta = $derived(ENGINES[engine]);
	const voices = $derived(meta.voices);
	const status = getAccountStatus();

	/**
	 * Remote-form field props. The shadcn Select renders a hidden input carrying
	 * `name`, so FormData still holds the value on submit; aria-invalid rides on
	 * the trigger.
	 */
	const engineField = saveSettings.fields.ttsEngine.as('select');
	const voiceField = saveSettings.fields.ttsVoice.as('select');
	const baseUrlField = saveSettings.fields.aiBaseUrl.as('text');
	const modelField = saveSettings.fields.aiModel.as('text');
	const keyField = saveSettings.fields.aiKey.as('text');
	const syncWindowField = saveSettings.fields.syncWindowDays.as('number');
	const engineItems = Object.values(ENGINES).map((option) => ({
		value: option.id,
		label: option.label
	}));
	const voiceItems = $derived(voices.map((name) => ({ value: name, label: name })));
	const speedItems = SPEED_STEPS.map((step) => ({ value: String(step), label: `${step}×` }));

	/** Picking an engine re-seeds the voice before the form submits both. */
	function engineChanged(next: string) {
		if (!next || next === engine) return;
		engine = next as EngineId;
		voice = ENGINES[engine].defaultVoice;
	}

	function pickVoice(next: string) {
		if (next) voice = next;
	}

	/** Speed/ramp apply instantly (menu-style toggles, not form inputs). */
	function speedChanged(next: string) {
		if (!next) return;
		speed = Number(next);
		void saveVoiceSpeed({ speed, ramp: rampOn }).catch(() => {});
	}

	function rampChanged(checked: boolean) {
		rampOn = checked;
		void saveVoiceSpeed({ speed, ramp: checked }).catch(() => {});
	}

	// Pronunciation rules are local-only, so they live with the reader, not in
	// the saveSettings form — same deal as Playback above.
	let pronFrom = $state('');
	let pronTo = $state('');

	function addRule() {
		const from = pronFrom.trim();
		const to = pronTo.trim();
		if (!from || !to) return;
		pronunciation.rules = [...pronunciation.rules, { from, to }];
		pronFrom = '';
		pronTo = '';
	}

	function removeRule(index: number) {
		pronunciation.rules = pronunciation.rules.filter((_, i) => i !== index);
	}
</script>

<svelte:head><title>Settings · Kikitai</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6 sm:px-6">
	<h1 class="font-heading text-2xl italic">Settings</h1>
	<p class="mt-1 text-xs text-muted-foreground">
		Everything here is configuration — switching AI provider or voice engine never needs a code
		change.
	</p>

	<form {...saveSettings} class="mt-6 space-y-6">
		<!-- AI -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Sparkles class="size-4 text-primary" /> AI endpoint
				</Card.Title>
				<Card.Description>
					Any OpenAI-compatible server: OpenAI, Groq, OpenRouter — or a local Ollama at
					<code>http://localhost:11434/v1</code>.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="space-y-1.5">
					<Label for="aiBaseUrl">Base URL</Label>
					<Input
						id="aiBaseUrl"
						name={baseUrlField.name}
						aria-invalid={baseUrlField['aria-invalid']}
						placeholder="https://api.openai.com/v1"
						bind:value={aiBaseUrl}
					/>
				</div>

				<div class="space-y-1.5">
					<Label for="aiModel">Model</Label>
					<Input
						id="aiModel"
						name={modelField.name}
						aria-invalid={modelField['aria-invalid']}
						placeholder="gpt-4o-mini · llama3.2 · openai/gpt-4o-mini"
						bind:value={aiModel}
					/>
				</div>

				<div class="space-y-1.5">
					<Label for="aiKey">API key</Label>
					<Input
						id="aiKey"
						name={keyField.name}
						aria-invalid={keyField['aria-invalid']}
						type="password"
						placeholder={data.settings.aiKeySet
							? 'A key is saved — type to replace it'
							: 'Leave empty for local models'}
						bind:value={aiKey}
					/>
					<p class="text-xs text-muted-foreground">
						Stored encrypted at rest. Only sent to the base URL above — never anywhere else.
					</p>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Voice -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Volume2 class="size-4 text-primary" /> Voice
				</Card.Title>
				<Card.Description>
					Kitten and Kokoro synthesize in this browser: the text never leaves your device and it
					costs nothing.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="space-y-1.5">
					<Label for="ttsEngine">Engine</Label>
					<Select.Root
						type="single"
						name={engineField.name}
						items={engineItems}
						value={engine}
						onValueChange={engineChanged}
					>
						<Select.Trigger
							id="ttsEngine"
							class="w-full"
							aria-invalid={engineField['aria-invalid']}
						>
							<Select.Value placeholder="Engine" />
						</Select.Trigger>
						<Select.Content>
							{#each engineItems as option (option.value)}
								<Select.Item value={option.value} label={option.label}>
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-xs text-muted-foreground">{meta.note}</p>
				</div>

				{#if voices.length > 0}
					<div class="space-y-1.5">
						<Label for="ttsVoice">Voice</Label>
						<Select.Root
							type="single"
							name={voiceField.name}
							items={voiceItems}
							value={voice}
							onValueChange={pickVoice}
						>
							<Select.Trigger
								id="ttsVoice"
								class="w-full"
								aria-invalid={voiceField['aria-invalid']}
							>
								<Select.Value placeholder="Voice" />
							</Select.Trigger>
							<Select.Content>
								{#each voiceItems as option (option.value)}
									<Select.Item value={option.value} label={option.label} />
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">
						This engine uses whatever voice your browser or operating system exposes.
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- Sync -->
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Mail class="size-4 text-primary" /> Sync
				</Card.Title>
				<Card.Description>How far back each sync reaches into your inbox.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="space-y-1.5">
					<Label for="syncWindowDays">Sync window (days)</Label>
					<Input
						id="syncWindowDays"
						name={syncWindowField.name}
						aria-invalid={syncWindowField['aria-invalid']}
						type="number"
						min="1"
						max="30"
						class="w-28"
						bind:value={syncWindowDays}
					/>
				</div>

				{#await status then st}
					<p class="text-xs text-muted-foreground">
						{#if st.connected}
							Connected: {st.addresses.join(', ')}
							{#if st.lastSyncAt}
								· last sync {st.lastSyncAt.toLocaleString()}
							{/if}
						{:else}
							No Gmail account connected yet — connect from the Inbox.
						{/if}
					</p>
				{/await}
			</Card.Content>
		</Card.Root>

		<Separator />

		<div class="flex items-center justify-end gap-2">
			<Button type="submit">
				<Save class="size-4" /> Save settings
			</Button>
		</div>
	</form>

	<!-- Playback applies the moment you change it, so it lives OUTSIDE the form:
	     an Enter in an AI field must never carry these along, and no Save is
	     needed for a speed change. -->
	<div class="mt-6">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Volume2 class="size-4 text-primary" /> Playback
				</Card.Title>
				<Card.Description>Changes apply immediately — no Save needed.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="space-y-1.5">
					<Label for="ttsSpeed">Speed</Label>
					<Select.Root
						type="single"
						items={speedItems}
						value={String(speed)}
						onValueChange={speedChanged}
					>
						<Select.Trigger id="ttsSpeed" class="w-full">
							<Select.Value placeholder="Speed" />
						</Select.Trigger>
						<Select.Content>
							{#each speedItems as option (option.value)}
								<Select.Item value={option.value} label={option.label}>
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex items-center justify-between gap-3 border border-border p-3">
					<div>
						<Label for="ttsRamp">Auto ramp</Label>
						<p class="text-xs text-muted-foreground">
							+0.1× every 2 minutes up to the speed above.
						</p>
					</div>
					<Switch id="ttsRamp" checked={rampOn} onCheckedChange={rampChanged} />
				</div>

				<div class="border border-border p-3">
					<p class="mb-2 text-xs tracking-widest text-muted-foreground uppercase">Test it</p>
					<Player
						compact
						{engine}
						{voice}
						{speed}
						ramp={rampOn}
						items={[
							{
								id: 'test',
								text: 'Good morning. Your inbox has three important messages waiting for you.'
							}
						]}
					/>
				</div>
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Pronunciation: also instant, also local, also outside the form. -->
	<div class="mt-6">
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Languages class="size-4 text-primary" /> Pronunciation
				</Card.Title>
				<Card.Description>
					How specific words should be said — acronyms, names, spellings a model gets wrong. Applied
					when audio is generated; the text on screen never changes.
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if pronunciation.rules.length > 0}
					<ul class="space-y-2">
						{#each pronunciation.rules as rule, i (i)}
							<li class="flex items-center justify-between gap-3 border border-border p-2">
								<p class="inline-flex min-w-0 items-center gap-1 truncate text-sm">
									<span class="font-medium">{rule.from}</span>
									<ArrowRight class="size-3 shrink-0 text-muted-foreground" />{rule.to}
								</p>
								<Button
									variant="ghost"
									size="icon-xs"
									aria-label={`Remove the rule for ${rule.from}`}
									onclick={() => removeRule(i)}
								>
									<Trash2 class="size-3.5" />
								</Button>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-xs text-muted-foreground">
						No rules yet. The engines get a free pass on everything else.
					</p>
				{/if}

				<form
					class="flex flex-wrap items-end gap-2"
					onsubmit={(event) => {
						event.preventDefault();
						addRule();
					}}
				>
					<div class="min-w-36 flex-1 space-y-1.5">
						<Label for="pronFrom">Word</Label>
						<Input id="pronFrom" placeholder="Kikitai" bind:value={pronFrom} />
					</div>
					<div class="min-w-36 flex-1 space-y-1.5">
						<Label for="pronTo">Say as</Label>
						<Input id="pronTo" placeholder="kee-kai-tai" bind:value={pronTo} />
					</div>
					<Button type="submit" variant="outline" disabled={!pronFrom.trim() || !pronTo.trim()}>
						<Plus class="size-4" /> Add
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</div>
