<script lang="ts">
	let {
		text,
		word = -1,
		class: className = ''
	}: { text: string; word?: number; class?: string } = $props();

	const words = $derived(text.split(/\s+/).filter(Boolean));
</script>

<!-- One line of spoken text with the current word lit — shared by the player's
     reader view and the message panel's compact now-speaking line. -->
<span class={className}>
	{#each words as w, i (i)}<span
			class={i === word ? 'rounded-sm bg-primary/30 font-medium text-foreground' : ''}
			>{w}{' '}</span
		>{/each}
</span>
