<script lang="ts">
	import ScrollNav from '$lib/components/scroll-nav.svelte';
	import SiteHeader from '$lib/components/site-header.svelte';

	let { children, data } = $props();
</script>

<div class="flex min-h-svh flex-col">
	<SiteHeader signedIn={data.signedIn} />
	{@render children()}
	<!--
		Covers the landing page and `/read`. Fixed, so it costs this column nothing
		when it is not there, and `/login` is too short to ever reveal it. On `/read`
		it lifts clear of the reader's pinned transport bar (see its own comment).
	-->
	<ScrollNav />
</div>
