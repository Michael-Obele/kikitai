<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import ThemeToggle from '$lib/components/theme-toggle.svelte';
	import Player from '$lib/components/player/player.svelte';
	import { appPlayer } from '$lib/player.svelte';
	import OfflineBanner from '$lib/components/offline-banner.svelte';
	import { onDestroy } from 'svelte';

	let { children, data } = $props();

	/**
	 * One transport, one rule: this bar is the transport for every `(app)` route
	 * while the store is running, and it steps aside the moment the page shows a
	 * player of its own — compact ones too (the inbox panel's player is compact,
	 * and counting only full readers put two identical transports on screen).
	 * It counts `panels`, not its own mount: a bar that watched its own host would
	 * hide itself, unmount, and immediately qualify again — an infinite loop.
	 * `/read` lives outside this layout and drives its own store — no bar there.
	 */
	const showBar = $derived(appPlayer.status !== 'idle' && appPlayer.panels === 0);

	/**
	 * Leaving `(app)` unmounts this layout, and with it the only transport the
	 * store has. The play loop is not tied to a host, so it would keep speaking
	 * with nothing on screen to stop it, and `/read` would then install its own
	 * media handlers over a session it does not own. Stop on the way out rather
	 * than orphan a session nothing can reach.
	 */
	onDestroy(() => {
		if (appPlayer.status !== 'idle') appPlayer.stop();
	});
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

		<!--
			Offline strip directly under the header: in-flow, so it needs no fixed
			positioning and cannot collide with the sticky transport bar at the
			bottom of this same column.
		-->
		<OfflineBanner />

		<div class="flex-1">{@render children()}</div>

		{#if showBar}
			<!--
				Sticky and in-flow, last child of `main`: it reserves its own row at
				the end of the page instead of floating over content, so nothing can
				slide underneath it and no padding math is needed. The props echo the
				store's own session — content-identical, so `adopt()` is a no-op (an
				empty `items` array would reset an idle session, and omitting speed
				would let the persisted prefs clobber the live cap).
			-->
			<div
				class="sticky bottom-0 z-10 shrink-0 overflow-x-auto border-t border-border bg-background px-3 py-2 sm:px-4"
			>
				<Player
					compact
					bar
					items={appPlayer.items}
					engine={appPlayer.engine}
					voice={appPlayer.voice}
					speed={appPlayer.cap}
					ramp={appPlayer.rampOn}
				/>
			</div>
		{/if}
	</main>
</Sidebar.Provider>
