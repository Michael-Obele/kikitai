<script lang="ts">
	import { AudioLines, Check, Inbox as InboxIcon, ListOrdered } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import Player from '$lib/components/player/player.svelte';
	import { getDigest, getSettings, markDigested } from '$lib/remote';
	import { errorMessage } from '$lib/errors';

	const digest = getDigest();
	const settings = getSettings();

	let playedIds = $state<string[]>([]);

	function onPlayed(id: string) {
		playedIds = [...playedIds, id];
		void markDigested(id).catch(() => {
			/* the toast-less path: played state still shows locally */
		});
	}
</script>

<svelte:head><title>Digest · Kikitai</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="font-heading text-2xl italic">Morning digest</h1>
			<p class="mt-1 text-xs text-muted-foreground">
				Important mail, ordered for listening — highest priority first, oldest first inside that.
			</p>
		</div>
		<Button variant="outline" size="sm" onclick={() => (location.href = '/dashboard')}>
			<ListOrdered class="size-4" /> Back to inbox
		</Button>
	</div>

	{#await digest}
		<div class="mt-6 space-y-3">
			{#each Array(4) as _, i (i)}
				<div class="h-20 animate-pulse bg-muted"></div>
			{/each}
		</div>
	{:then items}
		{#if items.length === 0}
			<div class="mt-6 grid place-items-center border border-dashed border-border p-10 text-center">
				<div class="max-w-sm">
					<InboxIcon class="mx-auto size-8 text-muted-foreground" />
					<h2 class="mt-3 font-heading text-lg italic">Nothing worth hearing yet</h2>
					<p class="mt-1.5 text-sm text-muted-foreground">
						The digest collects messages at priority 4–5 plus anything that needs a reply. Sync and
						organize your inbox first.
					</p>
					<Button class="mt-4" variant="outline" onclick={() => (location.href = '/dashboard')}>
						Go to inbox
					</Button>
				</div>
			</div>
		{:else}
			{#await settings then cfg}
				<Card.Root class="mt-6">
					<Card.Header class="flex-row items-center justify-between space-y-0">
						<div class="flex items-center gap-2">
							<AudioLines class="size-4 text-primary" />
							<Card.Title class="text-sm">
								Play all · {items.length} message{items.length === 1 ? '' : 's'}
							</Card.Title>
						</div>
						{#if playedIds.length > 0}
							<span class="text-xs text-muted-foreground">{playedIds.length} played</span>
						{/if}
					</Card.Header>
					<Card.Content>
						<Player
							engine={cfg.ttsEngine}
							voice={cfg.ttsVoice}
							{onPlayed}
							items={items.map((item) => ({
								id: item.id,
								title: `${item.subject} — ${item.fromName || 'unknown sender'}`,
								text: [
									item.summary,
									item.actionItems.length ? `Next: ${item.actionItems.join('; ')}.` : ''
								]
									.filter(Boolean)
									.join(' ')
							}))}
						/>
					</Card.Content>
				</Card.Root>
			{/await}

			<div class="mt-6 space-y-3">
				{#each items as item, i (item.id)}
					{@const isPlayed = playedIds.includes(item.id)}
					<Card.Root class={isPlayed ? 'opacity-60' : ''}>
						<Card.Content class="flex gap-4 p-4">
							<div class="flex shrink-0 flex-col items-center gap-1 pt-1">
								<span class="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
								{#if isPlayed}
									<Check class="size-4 text-primary" />
								{:else}
									<div class="flex flex-col gap-0.5">
										{#each Array(5) as _, p (p)}
											<span
												class="h-1 w-3 {item.priority > p
													? item.priority >= 4
														? 'bg-primary'
														: 'bg-primary/50'
													: 'bg-muted'}"
											></span>
										{/each}
									</div>
								{/if}
							</div>

							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">{item.subject}</p>
								<p class="mt-0.5 text-xs text-muted-foreground">
									{item.fromName || 'unknown sender'} · {item.receivedAt.toLocaleString(undefined, {
										dateStyle: 'medium',
										timeStyle: 'short'
									})}
								</p>
								<p class="mt-2 text-sm text-muted-foreground">{item.summary}</p>
								{#if item.actionItems.length > 0}
									<ul class="mt-2 space-y-1">
										{#each item.actionItems as action, i (i)}
											<li class="flex gap-2 text-xs text-muted-foreground">
												<span class="text-primary">→</span>{action}
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		{/if}
	{:catch error}
		<p class="mt-6 text-sm text-destructive">{errorMessage(error)}</p>
	{/await}
</div>
