<script lang="ts">
	import { BadgeDollarSign, CalendarDays, Link2, Users } from '@lucide/svelte';
	import type { Facts } from '$lib/types/mail';

	let { facts }: { facts: Facts | null } = $props();

	const dates = $derived(facts?.dates ?? []);
	const amounts = $derived(facts?.amounts ?? []);
	const links = $derived(facts?.links ?? []);
	const people = $derived(facts?.people ?? []);
</script>

{#if dates.length > 0 || amounts.length > 0 || links.length > 0 || people.length > 0}
	<div class="mt-2 flex flex-wrap gap-1.5">
		{#each dates as date (date)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<CalendarDays class="size-3" />
				{date}
			</span>
		{/each}
		{#each amounts as amount (amount)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<BadgeDollarSign class="size-3" />
				{amount}
			</span>
		{/each}
		{#each links as link (link.url)}
			<a
				href={link.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex max-w-48 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-primary hover:underline"
			>
				<Link2 class="size-3 shrink-0" />
				<span class="truncate">{link.label || link.url}</span>
			</a>
		{/each}
		{#each people as person (person)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<Users class="size-3" />
				{person}
			</span>
		{/each}
	</div>
{/if}
