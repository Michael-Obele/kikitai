<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';

	let { children } = $props();
</script>

<ModeWatcher />
<Toaster richColors position="top-right" />

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
