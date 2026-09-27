<script lang="ts">
	import SiteHeader from '$lib/components/site-header.svelte';

	let { children } = $props();
</script>

<div class="flex min-h-svh flex-col">
	<SiteHeader />
	{@render children()}
</div>
