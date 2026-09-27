<script lang="ts">
	import { LoaderCircle, Mail, Save, Sparkles, Volume2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { Switch } from '$lib/components/ui/switch';
	import Player from '$lib/components/player/player.svelte';
	import { getAccountStatus, saveSettings, saveVoiceSpeed } from '$lib/remote';
	import { ENGINES, SPEED_STEPS, type EngineId } from '$lib/tts';

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

	function engineChanged(event: Event) {
		const next = (event.currentTarget as HTMLSelectElement).value as EngineId;
		engine = next;
		voice = ENGINES[next].defaultVoice;
	}

	/** Speed/ramp apply instantly (menu-style toggles, not form inputs). */
	function speedChanged(event: Event) {
		speed = Number((event.currentTarget as HTMLSelectElement).value);
		void saveVoiceSpeed({ speed, ramp: rampOn }).catch(() => {});
	}

	function rampChanged(checked: boolean) {
		rampOn = checked;
		void saveVoiceSpeed({ speed, ramp: checked }).catch(() => {});
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
						{...saveSettings.fields.aiBaseUrl.as('text')}
						placeholder="https://api.openai.com/v1"
						bind:value={aiBaseUrl}
					/>
				</div>

				<div class="space-y-1.5">
					<Label for="aiModel">Model</Label>
					<Input
						id="aiModel"
						{...saveSettings.fields.aiModel.as('text')}
						placeholder="gpt-4o-mini · llama3.2 · openai/gpt-4o-mini"
						bind:value={aiModel}
					/>
				</div>

				<div class="space-y-1.5">
					<Label for="aiKey">API key</Label>
					<Input
						id="aiKey"
						{...saveSettings.fields.aiKey.as('text')}
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
					<select
						id="ttsEngine"
						{...saveSettings.fields.ttsEngine.as('select')}
						class="flex h-8 w-full border border-input bg-background px-2 text-sm"
						value={engine}
						onchange={engineChanged}
					>
						{#each Object.values(ENGINES) as option (option.id)}
							<option value={option.id}>{option.label}</option>
						{/each}
					</select>
					<p class="text-xs text-muted-foreground">{meta.note}</p>
				</div>

				{#if voices.length > 0}
					<div class="space-y-1.5">
						<Label for="ttsVoice">Voice</Label>
						<select
							id="ttsVoice"
							{...saveSettings.fields.ttsVoice.as('select')}
							class="flex h-8 w-full border border-input bg-background px-2 text-sm"
							bind:value={voice}
						>
							{#each voices as option (option)}
								<option value={option}>{option}</option>
							{/each}
						</select>
					</div>
				{:else}
					<p class="text-xs text-muted-foreground">
						This engine uses whatever voice your browser or operating system exposes.
					</p>
				{/if}

				<div class="space-y-1.5">
					<Label for="ttsSpeed">Speed</Label>
					<select
						id="ttsSpeed"
						class="flex h-8 w-full border border-input bg-background px-2 text-sm"
						value={String(speed)}
						onchange={speedChanged}
					>
						{#each SPEED_STEPS as step (step)}
							<option value={String(step)}>{step}×</option>
						{/each}
					</select>
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
						{...saveSettings.fields.syncWindowDays.as('number')}
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
</div>
