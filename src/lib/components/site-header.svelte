<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { ArrowRight, AudioLines, LayoutDashboard, Menu } from '@lucide/svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import ThemeToggle from '$lib/components/theme-toggle.svelte';

	/** The landing-page sections. Linked from every marketing route, not just `/`. */
	const anchors = [
		{ id: 'how', label: 'How it works', class: 'hidden sm:inline-flex' },
		{ id: 'privacy', label: 'Privacy', class: 'hidden sm:inline-flex' },
		{ id: 'faq', label: 'Questions', class: 'hidden md:inline-flex' }
	];

	const path = $derived(page.url.pathname);
	const onLanding = $derived(path === '/');
	const onLogin = $derived(path === '/login');
	const onRead = $derived(path === '/read');

	/** Section ids only exist on `/` — anywhere else, land on the homepage first. */
	function anchorHref(id: string) {
		return onLanding ? `#${id}` : `${resolve('/')}#${id}`;
	}

	let menuOpen = $state(false);
	const closeMenu = () => (menuOpen = false);

	/** Signed-in visitors get a way back into the app instead of Sign in / Connect. */
	let { signedIn = false }: { signedIn?: boolean } = $props();
</script>

<header
	class="sticky top-0 z-50 border-b border-transparent bg-background/80 backdrop-blur-md supports-backdrop-filter:border-border/60"
>
	<div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
		<a href={resolve('/')} class="flex items-center gap-2.5">
			<span class="grid size-7 place-items-center bg-primary text-primary-foreground">
				<AudioLines class="size-4" />
			</span>
			<span class="font-heading text-lg italic">Kikitai</span>
		</a>

		<div class="flex items-center gap-1">
			<nav aria-label="Primary" class="hidden items-center gap-1 sm:flex">
				{#each anchors as item (item.id)}
					<Button variant="ghost" size="sm" href={anchorHref(item.id)} class={item.class}>
						{item.label}
					</Button>
				{/each}
			</nav>

			<ThemeToggle />

			{#if signedIn}
				<div class="hidden items-center gap-1 sm:flex">
					<Button size="sm" href={resolve('/dashboard')}>
						<LayoutDashboard class="size-3.5" /> Dashboard
					</Button>
				</div>
			{:else if !onLogin}
				<div class="hidden items-center gap-1 sm:flex">
					<Button variant="ghost" size="sm" href={resolve('/login')}>Sign in</Button>
					<Button size="sm" href={resolve('/login')}>
						Connect <ArrowRight class="size-3.5" />
					</Button>
				</div>
			{/if}

			<!-- Below `sm` the anchor links collapse into this sheet. -->
			<div class="sm:hidden">
				<Sheet.Root bind:open={menuOpen}>
					<Sheet.Trigger
						aria-label="Open menu"
						class={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
					>
						<Menu class="size-4" />
					</Sheet.Trigger>
					<Sheet.Content side="right" class="w-72">
						<Sheet.Header>
							<Sheet.Title class="font-heading text-lg italic">Kikitai</Sheet.Title>
							<Sheet.Description class="text-xs text-muted-foreground">
								聞きたい — “I want to hear it.”
							</Sheet.Description>
						</Sheet.Header>

						<nav aria-label="Primary" class="grid gap-1 px-4">
							{#each anchors as item (item.id)}
								<Button
									variant="ghost"
									size="sm"
									href={anchorHref(item.id)}
									class="w-full justify-start"
									onclick={closeMenu}
								>
									{item.label}
								</Button>
							{/each}
							{#if !onRead}
								<Button
									variant="ghost"
									size="sm"
									href={resolve('/read')}
									class="w-full justify-start"
									onclick={closeMenu}
								>
									Paste &amp; read
								</Button>
							{/if}
						</nav>

						{#if signedIn}
							<div class="mt-auto grid gap-2 border-t border-border p-4">
								<Button href={resolve('/dashboard')} onclick={closeMenu}>
									<LayoutDashboard class="size-3.5" /> Dashboard
								</Button>
							</div>
						{:else if !onLogin}
							<div class="mt-auto grid gap-2 border-t border-border p-4">
								<Button variant="outline" href={resolve('/login')} onclick={closeMenu}>
									Sign in
								</Button>
								<Button href={resolve('/login')} onclick={closeMenu}>
									Connect <ArrowRight class="size-3.5" />
								</Button>
							</div>
						{/if}
					</Sheet.Content>
				</Sheet.Root>
			</div>
		</div>
	</div>
</header>
