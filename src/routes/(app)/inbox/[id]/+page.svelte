<script lang="ts">
	import { ArrowLeft, ExternalLink, LoaderCircle } from '@lucide/svelte';
	import type { PageProps } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import MessagePanel from '$lib/components/inbox/message-panel.svelte';
	import { getMessage, getSettings } from '$lib/remote';
	import { errorMessage } from '$lib/errors';
	import { CATEGORY_LABELS, type MessageDto } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';

	let { params }: PageProps = $props();

	const settings = getSettings();
	/** Set by the panel after Re-organize so the header badge/summary stay in sync. */
	let override = $state<MessageDto | null>(null);
</script>

<svelte:head><title>Message · Kikitai</title></svelte:head>

<div class="flex min-h-full flex-col">
	<header class="border-b border-border px-4 py-4 sm:px-6">
		<Button variant="ghost" size="sm" href="/dashboard">
			<ArrowLeft class="size-4" /> Back to inbox
		</Button>
	</header>

	<main class="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
		{#await getMessage(params.id)}
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<LoaderCircle class="size-4 animate-spin" /> Loading message…
			</div>
		{:then message}
			{@const item = override && override.id === message.id ? override : message}

			<h1 class="font-heading text-2xl leading-snug italic">{item.subject}</h1>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span>{item.fromName || item.fromEmail}</span>
				{#if item.fromName && item.fromEmail}
					<span>· {item.fromEmail}</span>
				{/if}
				<time datetime={item.receivedAt.toISOString()}>
					{item.receivedAt.toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short'
					})}
				</time>
				{#if item.category}
					<Badge>{CATEGORY_LABELS[item.category]}</Badge>
				{/if}
			</div>

			<div class="mt-6">
				{#await settings then cfg}
					<MessagePanel
						{item}
						engine={cfg.ttsEngine as EngineId}
						voice={cfg.ttsVoice}
						speed={cfg.ttsSpeed}
						ramp={cfg.ttsRamp}
						onsaved={(fresh) => (override = fresh)}
					/>
				{/await}
			</div>

			<div class="mt-6 flex justify-end border-t border-border pt-4">
				<a
					href="https://mail.google.com/mail/u/0/#all/{item.gmailId}"
					target="_blank"
					rel="noreferrer"
				>
					<Button variant="outline" size="sm">
						<ExternalLink class="size-4" /> Open in Gmail
					</Button>
				</a>
			</div>
		{:catch error}
			<p class="text-sm text-destructive">{errorMessage(error)}</p>
			<Button variant="outline" size="sm" href="/dashboard" class="mt-4">
				<ArrowLeft class="size-4" /> Back to inbox
			</Button>
		{/await}
	</main>
</div>
