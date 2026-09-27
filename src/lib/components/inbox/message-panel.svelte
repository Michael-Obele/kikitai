<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		AudioLines,
		ListTree,
		LoaderCircle,
		MessagesSquare,
		RefreshCw,
		Volume2,
		WandSparkles
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Player from '$lib/components/player/player.svelte';
	import FactsChips from './facts-chips.svelte';
	import {
		getInbox,
		getMessage,
		loadDetails,
		loadListenScript,
		loadThreadSummary,
		regenerateSummary
	} from '$lib/remote';
	import { errorMessage } from '$lib/errors';
	import type { InboxItem, MessageDetails, MessageDto } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';

	let {
		item,
		engine,
		voice,
		speed = 1,
		ramp = false,
		onsaved
	}: {
		item: InboxItem;
		engine: EngineId;
		voice: string;
		/** Saved speed cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
		/** Fresh row after a successful Re-organize — the host swaps it into its own snapshot. */
		onsaved?: (fresh: MessageDto) => void;
	} = $props();

	let reorganizing = $state(false);
	let details = $state<MessageDetails | null>(null);
	let thread = $state<{ summary: string; highlights: string[]; messageCount: number } | null>(null);
	let spokenText = $state<string | null>(null);
	let loadingDetails = $state(false);
	let loadingThread = $state(false);
	let loadingSpoken = $state(false);

	/** The dialog swaps `item` without remounting — drop the previous message's AI state. */
	$effect(() => {
		const id = item.id;
		details = null;
		thread = null;
		spokenText = null;
		loadingDetails = false;
		loadingThread = false;
		loadingSpoken = false;
		void id;
	});

	async function reorganize() {
		reorganizing = true;
		try {
			details = null;
			thread = null;
			spokenText = null;
			await regenerateSummary(item.id).updates(getInbox);
			onsaved?.(await getMessage(item.id));
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			reorganizing = false;
		}
	}

	async function showDetails() {
		loadingDetails = true;
		try {
			details = (await loadDetails(item.id)).details;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingDetails = false;
		}
	}

	async function summarizeThread() {
		loadingThread = true;
		try {
			thread = await loadThreadSummary(item.id);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingThread = false;
		}
	}

	async function makeListenable() {
		loadingSpoken = true;
		try {
			spokenText = (await loadListenScript(item.id)).spokenText;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingSpoken = false;
		}
	}
</script>

<div class="space-y-4">
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

	<FactsChips facts={item.facts} />

	<section class="border-t border-border pt-3">
		<div class="flex items-center justify-between gap-2">
			<h4 class="text-xs tracking-widest text-muted-foreground uppercase">Details</h4>
			<Button variant="ghost" size="sm" onclick={showDetails} disabled={loadingDetails}>
				{#if loadingDetails}
					<LoaderCircle class="size-4 animate-spin" /> Thinking…
				{:else}
					<ListTree class="size-4" /> {details ? 'Refresh' : 'Details'}
				{/if}
			</Button>
		</div>
		{#if details}
			<ul class="mt-2 space-y-1">
				{#each details.keyPoints as point, i (i)}
					<li class="flex gap-2 text-sm text-muted-foreground">
						<span class="text-primary">→</span>{point}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-sm">
				<span class="text-xs tracking-widest text-muted-foreground uppercase">Asks of you</span>
				{details.askOfYou}
			</p>
			{#if details.deadlines.length > 0}
				<p class="mt-1 text-xs text-muted-foreground">
					Deadlines: {details.deadlines.join(' · ')}
				</p>
			{/if}
		{:else}
			<p class="mt-1 text-xs text-muted-foreground/70">
				One AI call the first time — bullets, what it's asking of you, and every deadline.
			</p>
		{/if}
	</section>

	{#await getMessage(item.id)}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<LoaderCircle class="size-4 animate-spin" /> Loading message…
		</div>
	{:then full}
		{@const spoken = spokenText ?? full.spokenText}
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

		{#if (full.threadCount ?? 0) > 1}
			<section class="border-t border-border pt-3">
				<h4 class="text-xs tracking-widest text-muted-foreground uppercase">
					Conversation · {thread?.messageCount ?? full.threadCount} messages
				</h4>
				{#if thread}
					<p class="mt-2 text-sm">{thread.summary}</p>
					{#if thread.highlights.length > 0}
						<ul class="mt-2 space-y-1">
							{#each thread.highlights as highlight, i (i)}
								<li class="flex gap-2 text-xs text-muted-foreground">
									<span class="text-primary">·</span>{highlight}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="mt-1 text-xs text-muted-foreground/70">
						One summary for the whole conversation, not just this message.
					</p>
					<Button
						class="mt-2"
						variant="outline"
						size="sm"
						onclick={summarizeThread}
						disabled={loadingThread}
					>
						{#if loadingThread}
							<LoaderCircle class="size-4 animate-spin" /> Summarizing…
						{:else}
							<WandSparkles class="size-4" /> Summarize conversation
						{/if}
					</Button>
				{/if}
			</section>
		{/if}

		<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
			<Volume2 class="size-4 shrink-0 text-primary" />
			<div class="min-w-0 flex-1">
				<Player
					compact
					{engine}
					{voice}
					{speed}
					{ramp}
					items={[
						{
							id: item.id,
							title: item.subject,
							text:
								spoken ??
								[item.summary ?? '', full.bodyText].filter(Boolean).join('\n\n').slice(0, 2000)
						}
					]}
				/>
			</div>
			{#if !spoken && (full.bodyText?.length ?? 0) > 1200}
				<Button variant="outline" size="sm" onclick={makeListenable} disabled={loadingSpoken}>
					{#if loadingSpoken}
						<LoaderCircle class="size-4 animate-spin" /> Making listenable…
					{:else}
						<AudioLines class="size-4" /> Make listenable
					{/if}
				</Button>
			{/if}
		</div>
	{:catch error}
		<p class="text-sm text-destructive">{errorMessage(error)}</p>
	{/await}

	<div class="flex items-center gap-2 border-t border-border pt-3">
		<Button variant="ghost" size="sm" onclick={reorganize} disabled={reorganizing}>
			{#if reorganizing}
				<LoaderCircle class="size-4 animate-spin" /> Re-organizing…
			{:else}
				<RefreshCw class="size-4" /> Re-organize
			{/if}
		</Button>
	</div>
</div>
