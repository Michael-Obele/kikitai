<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { browser, dev } from '$app/environment';
	import { Agentation, type AnnotationProps } from 'sv-agentation';

	let { children } = $props();

	let playgroundAnnotationProps: AnnotationProps = {
		toolbarPosition: 'bottom-right',
		outputMode: 'forensic',
		pauseAnimations: true,
		clearOnCopy: true,
		includeComponentContext: false,
		includeComputedStyles: false
	};
</script>

<ModeWatcher />
<Toaster richColors position="top-right" />

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}

{#if browser && dev}
	<Agentation {...playgroundAnnotationProps} />
{/if}
