<script lang="ts">
	import { Keyboard } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { onPress } from '$lib/keys';

	/**
	 * The player's shortcut help. Ships its own trigger, dialog and `?` handler
	 * so any host can drop it in — one component, no duplicated key tables.
	 *
	 * `keys` are rendered as written: one `<kbd>` per entry, entries joined by
	 * "or". Put a chord inside a single entry ("Shift + ←").
	 */
	let {
		rows = [],
		size = 'icon-sm'
	}: { rows?: { keys: string[]; label: string }[]; size?: 'icon-sm' | 'xs' | 'default' } = $props();

	/** Familiar bindings: Space/K, J/L (YouTube), ←/→ (Soundslice), ? (GitHub/Notion). */
	const BUILT_IN: { keys: string[]; label: string }[] = [
		{ keys: ['Space', 'K'], label: 'Play / pause' },
		{ keys: ['←'], label: 'Previous sentence' },
		{ keys: ['→'], label: 'Next sentence' },
		{ keys: ['J'], label: 'Back 15 seconds' },
		{ keys: ['L'], label: 'Forward 30 seconds' },
		{ keys: ['Shift + ←', 'Shift + →'], label: 'Previous / next item' },
		{ keys: ['<', '>'], label: 'Slower / faster (also Shift + ↑ / ↓)' },
		{ keys: ['Home'], label: 'Restart this item' },
		{ keys: ['?'], label: 'This help' },
		{ keys: ['Esc'], label: 'Close dialogs & menus' }
	];

	const all = $derived([...BUILT_IN, ...rows]);

	let open = $state(false);

	/** `?` is the web's "show shortcuts" key (GitHub, Notion, Spotify). */
	onPress('?', () => (open = !open));
</script>

<Button
	variant="ghost"
	{size}
	aria-label="Keyboard shortcuts"
	title="Keyboard shortcuts (?)"
	onclick={() => (open = true)}
>
	<Keyboard class="size-4" />
</Button>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<Keyboard class="size-4" /> Keyboard shortcuts
			</Dialog.Title>
			<Dialog.Description
				>These work anywhere on the page while a player is on screen.</Dialog.Description
			>
		</Dialog.Header>
		<dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
			{#each all as row (row.label)}
				<dt class="flex justify-end gap-1.5">
					{#each row.keys as key, i (key)}
						{#if i > 0}<span class="text-xs text-muted-foreground">or</span>{/if}
						<kbd
							class="inline-flex min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
						>
							{key}
						</kbd>
					{/each}
				</dt>
				<dd class="text-sm text-muted-foreground">{row.label}</dd>
			{/each}
		</dl>
	</Dialog.Content>
</Dialog.Root>
