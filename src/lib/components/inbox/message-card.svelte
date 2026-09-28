<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { CATEGORY_LABELS, type InboxItem } from '$lib/types/mail';
	import FactsChips from './facts-chips.svelte';

	let {
		item,
		selected = false,
		onclick
	}: { item: InboxItem; selected?: boolean; onclick?: () => void } = $props();

	const dateFormat = new Intl.DateTimeFormat(undefined, {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});

	const badgeVariant = (category: InboxItem['category']) =>
		category === 'needs_reply'
			? 'default'
			: category === 'spam_suspect'
				? 'destructive'
				: category === 'updates'
					? 'secondary'
					: 'outline';
</script>

<Button
	variant="ghost"
	class="block h-auto w-full rounded-none border-b border-border px-4 py-3 text-left font-normal transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none {selected
		? 'bg-muted'
		: ''}"
	{onclick}
>
	<div class="flex gap-3">
		<!-- priority: 5 blocks, filled up to the score -->
		<div
			class="mt-1.5 flex shrink-0 flex-col gap-0.5"
			title={item.priority ? `Priority ${item.priority} of 5` : 'Not organized yet'}
		>
			{#each Array(5) as _, i (i)}
				<span
					class="h-1 w-3 {item.priority && i < item.priority
						? item.priority >= 4
							? 'bg-primary'
							: 'bg-primary/50'
						: 'bg-muted'}"
				></span>
			{/each}
		</div>

		<div class="min-w-0 flex-1">
			<div class="flex items-start justify-between gap-2">
				<p class="truncate text-sm font-medium">{item.subject}</p>
				<time
					class="shrink-0 text-[11px] text-muted-foreground"
					datetime={item.receivedAt.toISOString()}
				>
					{dateFormat.format(item.receivedAt)}
				</time>
			</div>

			<div class="mt-1 flex flex-wrap items-center gap-1.5">
				<p class="truncate text-xs text-muted-foreground">
					{item.fromName || item.fromEmail}
				</p>
				{#if item.category}
					<Badge variant={badgeVariant(item.category)} class="px-1.5 py-0 text-[10px]">
						{CATEGORY_LABELS[item.category]}
					</Badge>
				{/if}
			</div>

			{#if item.summary}
				<p class="mt-1.5 line-clamp-2 text-sm leading-snug text-muted-foreground">{item.summary}</p>
			{:else if item.organizeError}
				<p class="mt-1.5 text-xs text-destructive">{item.organizeError}</p>
			{:else}
				<p class="mt-1.5 text-xs text-muted-foreground/70 italic">not organized yet</p>
			{/if}
			<FactsChips facts={item.facts} />
		</div>
	</div>
</Button>
