<script lang="ts">
	import { Check, ChevronsUp, Gauge } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Switch } from '$lib/components/ui/switch';
	import { SPEED_STEPS } from '$lib/tts';

	/**
	 * Presentational speed control. `cap` is the step the user picked (what
	 * gets persisted), `live` is the speed playing right now — between steps
	 * while auto-ramp climbs.
	 */
	let {
		cap,
		ramp,
		live,
		onselect,
		ontoggle
	}: {
		cap: number;
		ramp: boolean;
		live: number;
		onselect: (speed: number) => void;
		ontoggle: (ramp: boolean) => void;
	} = $props();

	const label = $derived(`${trim(live)}×`);

	function trim(n: number) {
		return String(Math.round(n * 100) / 100);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon-sm" aria-label="Playback speed {label}">
				<Gauge class="size-4" />
				<span class="ml-0.5 text-xs tabular-nums">{label}</span>
				{#if ramp}<ChevronsUp class="size-3 text-primary" />{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-48">
		<DropdownMenu.Label>Speed</DropdownMenu.Label>
		{#each SPEED_STEPS as step (step)}
			<DropdownMenu.Item onclick={() => onselect(step)}>
				<span class="tabular-nums">{step}×</span>
				{#if cap === step}<Check class="ml-auto size-3.5 text-primary" />{/if}
			</DropdownMenu.Item>
		{/each}
		<DropdownMenu.Separator />
		<DropdownMenu.Label class="flex items-center justify-between gap-3">
			<span>Auto ramp</span>
			<Switch checked={ramp} onCheckedChange={(next) => ontoggle(next)} />
		</DropdownMenu.Label>
		<p class="px-2 pb-2 text-xs text-muted-foreground">
			+0.1× every 2 minutes up to the speed above.
		</p>
	</DropdownMenu.Content>
</DropdownMenu.Root>
