<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import ThemeToggle from '$lib/components/theme-toggle.svelte';

	let { children, data } = $props();
</script>

<Sidebar.Provider>
	<AppSidebar user={data.user} />

	<main class="flex min-h-svh w-full flex-col">
		<header class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-4">
			<Sidebar.Trigger />
			<span class="text-xs text-muted-foreground">
				read-only · your mail never leaves this app
			</span>
			<div class="ml-auto"><ThemeToggle /></div>
		</header>

		<div class="flex-1">{@render children()}</div>
	</main>
</Sidebar.Provider>
