<script lang="ts">
	import SiteHeader from '$lib/components/site-header.svelte';

	let { children, data } = $props();
</script>

<div class="flex min-h-svh flex-col">
	<SiteHeader signedIn={data.signedIn} />
	{@render children()}
</div>
