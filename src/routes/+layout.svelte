<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { browser, dev } from '$app/environment';
	import { Agentation, type AnnotationProps } from 'sv-agentation';
	import { applyReaderPrefs, currentReaderPrefs } from '$lib/reader-prefs.svelte';

	let { children } = $props();

	/**
	 * The reader's text size, face and leading are plain CSS variables, so every
	 * reading surface follows them without knowing the preference exists. They
	 * are written here — client only — rather than during SSR, because
	 * localStorage is unreadable on the server and painting it into the markup
	 * would be a hydration mismatch. The same reason the voice seed waits for
	 * mount. Nothing to undo: the variables simply stay set.
	 */
	$effect(() => {
		applyReaderPrefs(currentReaderPrefs(), document.documentElement);
	});

	let playgroundAnnotationProps: AnnotationProps = {
		toolbarPosition: 'bottom-left',
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
