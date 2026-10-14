<script lang="ts">
	import { WifiOff } from '@lucide/svelte';
	import { online } from '$lib/player-prefs.svelte';
</script>

<!--
	Plain-words strip for a dropped connection. `role="status"` announces it when
	the module's online/offline events flip the flag — politely, without stealing
	focus. Colours are existing tokens only: `text-foreground` on `bg-muted`
	clears WCAG AA in both themes (the axe gate's requirement). In-flow under the
	host's header, so it never fights the sticky player bar at the bottom.
-->
{#if !online.current}
	<p
		role="status"
		class="shrink-0 border-b border-border bg-muted px-3 py-2 text-sm text-foreground sm:px-4"
	>
		<WifiOff class="mr-1.5 inline-block size-4 align-text-bottom" />
		You're offline — playback of downloaded voices still works.
	</p>
{/if}
