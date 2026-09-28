<script lang="ts">
	import { AudioLines, ClipboardPaste, Inbox, LogOut, Settings } from '@lucide/svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { Button } from '$lib/components/ui/button';

	let { user }: { user: { name: string; email: string; image?: string | null } } = $props();

	/** Labeled groups: the app itself, then the public routes outside (app). */
	const groups = [
		{
			label: 'Listen',
			items: [
				{ title: 'Inbox', url: '/dashboard', icon: Inbox },
				{ title: 'Digest', url: '/digest', icon: AudioLines },
				{ title: 'Settings', url: '/settings', icon: Settings }
			]
		},
		{
			/** Works without an account — opens in the public shell, not this one. */
			label: 'Public',
			items: [{ title: 'Paste & read', url: '/read', icon: ClipboardPaste }]
		}
	] as const;

	const initials = $derived(
		(user.name || user.email || '?')
			.split(/\s|@/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('')
	);

	async function signOut() {
		await authClient.signOut();
		location.href = '/';
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<a href="/" class="flex items-center gap-2 px-1 py-1.5">
			<span class="grid size-7 place-items-center bg-primary text-primary-foreground">
				<AudioLines class="size-4" />
			</span>
			<div class="flex flex-col leading-none">
				<span class="font-heading text-base italic">Kikitai</span>
				<span class="text-[10px] tracking-widest text-muted-foreground">聞きたい</span>
			</div>
		</a>
	</Sidebar.Header>

	<Sidebar.Content>
		{#each groups as group (group.label)}
			<Sidebar.Group>
				<Sidebar.GroupLabel>{group.label}</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each group.items as item (item.url)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton isActive={page.url.pathname.startsWith(item.url)}>
									{#snippet child({ props })}
										<a href={resolve(item.url)} {...props}>
											<item.icon />
											<span>{item.title}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>

	<Sidebar.Footer>
		<div class="flex items-center gap-2 border-t border-border px-2 pt-3 pb-1">
			<span
				class="grid size-7 shrink-0 place-items-center bg-muted text-xs font-medium text-muted-foreground"
			>
				{initials}
			</span>
			<div class="min-w-0 flex-1 leading-tight">
				<p class="truncate text-xs font-medium">{user.name || 'You'}</p>
				<p class="truncate text-[11px] text-muted-foreground">{user.email}</p>
			</div>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label="Sign out"
				title="Sign out"
				onclick={signOut}
			>
				<LogOut class="size-3.5" />
			</Button>
		</div>
	</Sidebar.Footer>
</Sidebar.Root>
