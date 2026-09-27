<script lang="ts">
	import { Moon, Sun } from '@lucide/svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import { Button } from '$lib/components/ui/button';
</script>

<Button
	variant="ghost"
	size="icon-sm"
	aria-label="Toggle dark mode"
	title={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
	onclick={() => toggleMode()}
>
	{#if mode.current === 'dark'}
		<Sun class="size-4" />
	{:else}
		<Moon class="size-4" />
	{/if}
</Button>
