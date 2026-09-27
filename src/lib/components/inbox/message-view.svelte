<script lang="ts">
	import { ExternalLink, LoaderCircle, RefreshCw, Volume2 } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import Player from '$lib/components/player/player.svelte';
	import { getMessage, regenerateSummary } from '$lib/remote';
	import { errorMessage } from '$lib/errors';
	import { CATEGORY_LABELS, type InboxItem } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';

	let {
		item = null,
		open = $bindable(false),
		engine,
		voice
	}: {
		item: InboxItem | null;
		open?: boolean;
		engine: EngineId;
		voice: string;
	} = $props();

	let reorganizing = $state(false);

	async function reorganize() {
		if (!item) return;
		reorganizing = true;
		try {
			await regenerateSummary(item.id);
		} catch (error) {
			console.error(errorMessage(error));
		} finally {
			reorganizing = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-2xl">
		{#if item}
			<Dialog.Header>
				<div class="flex items-start justify-between gap-3">
					<Dialog.Title class="leading-snug">{item.subject}</Dialog.Title>
					{#if item.category}
						<Badge class="shrink-0">{CATEGORY_LABELS[item.category]}</Badge>
					{/if}
				</div>
				<Dialog.Description>
					{item.fromName || item.fromEmail}
					{#if item.fromName && item.fromEmail}
						<span class="text-muted-foreground">· {item.fromEmail}</span>
					{/if}
					·
					{item.receivedAt.toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short'
					})}
				</Dialog.Description>
			</Dialog.Header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				{#if item.summary}
					<div class="border-l-2 border-primary bg-primary/5 px-3 py-2">
						<p class="text-xs tracking-widest text-primary uppercase">Summary</p>
						<p class="mt-1 text-sm">{item.summary}</p>
						{#if item.actionItems.length > 0}
							<ul class="mt-2 space-y-1">
								{#each item.actionItems as action, i (i)}
									<li class="flex gap-2 text-xs text-muted-foreground">
										<span class="text-primary">→</span>{action}
									</li>
								{/each}
							</ul>
						{/if}
						{#if item.priority}
							<p class="mt-2 text-[11px] text-muted-foreground">Priority {item.priority} of 5</p>
						{/if}
					</div>
				{/if}

				{#await getMessage(item.id)}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderCircle class="size-4 animate-spin" /> Loading message…
					</div>
				{:then full}
					{#if full.bodyText}
						<div
							class="max-h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground"
						>
							{full.bodyText}
						</div>
					{:else}
						<p class="text-sm text-muted-foreground italic">
							No plain-text body was found in this message (it may be image-only).
						</p>
					{/if}

					<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
						<Volume2 class="size-4 shrink-0 text-primary" />
						<div class="min-w-0 flex-1">
							<Player
								compact
								{engine}
								{voice}
								items={[
									{
										id: item.id,
										title: item.subject,
										text: [item.summary ?? '', full.bodyText]
											.filter(Boolean)
											.join('\n\n')
											.slice(0, 2000)
									}
								]}
							/>
						</div>
					</div>
				{:catch error}
					<p class="text-sm text-destructive">{errorMessage(error)}</p>
				{/await}
			</div>

			<Separator />

			<div class="flex flex-wrap items-center justify-between gap-2">
				<Button variant="ghost" size="sm" onclick={reorganize} disabled={reorganizing}>
					{#if reorganizing}
						<LoaderCircle class="size-4 animate-spin" /> Re-organizing…
					{:else}
						<RefreshCw class="size-4" /> Re-organize
					{/if}
				</Button>
				<div class="flex items-center gap-2">
					<a
						href="https://mail.google.com/mail/u/0/#all/{item.gmailId}"
						target="_blank"
						rel="noreferrer"
					>
						<Button variant="outline" size="sm">
							<ExternalLink class="size-4" /> Open in Gmail
						</Button>
					</a>
					<Button size="sm" onclick={() => (open = false)}>Close</Button>
				</div>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
