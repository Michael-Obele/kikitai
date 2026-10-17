<script lang="ts">
	import { Check, Moon } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { SLEEP_PRESETS, type SleepChoice } from '$lib/player.svelte';

	/**
	 * Presentational sleep-timer control — the same shape as `speed-menu`: the
	 * store owns the timer (state + the interval that drives it), this component
	 * only renders it and reports picks. `left` is seconds remaining, rounded up
	 * so 4.5 min still reads "5m".
	 */
	let {
		mode,
		minutes,
		left,
		onselect
	}: {
		mode: 'off' | 'end' | 'minutes';
		/** The armed preset (5/10/…) — only meaningful while `mode === 'minutes'`. */
		minutes: number;
		/** Seconds until the deadline, ticking once a second while minutes are armed. */
		left: number;
		onselect: (choice: SleepChoice) => void;
	} = $props();

	/** Armed state drives the icon colour and the readout next to it. */
	const armed = $derived(mode !== 'off');
	/** "" when off (icon only), "12m" for minutes, "End" for end-of-item. */
	const label = $derived(
		mode === 'off' ? '' : mode === 'end' ? 'End' : `${Math.max(1, Math.ceil(left / 60))}m`
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				aria-label="Sleep timer: {mode === 'off' ? 'off' : label}"
				title="Sleep timer (S)"
			>
				<Moon class="size-4 {armed ? 'text-primary' : ''}" />
				{#if label}<span class="ml-0.5 text-xs tabular-nums">{label}</span>{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-56">
		<DropdownMenu.Label>Sleep timer</DropdownMenu.Label>
		<DropdownMenu.Item onclick={() => onselect('off')}>
			<span>Off</span>
			{#if mode === 'off'}<Check class="ml-auto size-3.5 text-primary" />{/if}
		</DropdownMenu.Item>
		{#each SLEEP_PRESETS as preset (preset)}
			<DropdownMenu.Item onclick={() => onselect(preset)}>
				<span>{preset} minutes</span>
				{#if mode === 'minutes' && minutes === preset}
					<Check class="ml-auto size-3.5 text-primary" />
				{/if}
			</DropdownMenu.Item>
		{/each}
		<DropdownMenu.Separator />
		<DropdownMenu.Item onclick={() => onselect('end')}>
			<span>End of item</span>
			{#if mode === 'end'}<Check class="ml-auto size-3.5 text-primary" />{/if}
		</DropdownMenu.Item>
		<p class="px-2 pb-2 text-xs text-muted-foreground">
			Playback pauses when the timer runs out — your place is kept.
		</p>
	</DropdownMenu.Content>
</DropdownMenu.Root>
