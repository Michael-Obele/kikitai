<script lang="ts">
	import {
		Inbox as InboxIcon,
		Link2,
		LoaderCircle,
		RefreshCw,
		Search,
		Sparkles
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import MessageCard from '$lib/components/inbox/message-card.svelte';
	import MessageView from '$lib/components/inbox/message-view.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		connectGmail,
		getAccountStatus,
		getDigest,
		getInbox,
		getMessage,
		getSettings,
		organizeMail,
		syncMail
	} from '$lib/remote';
	import { errorMessage } from '$lib/errors';
	import { CATEGORIES, CATEGORY_LABELS, type InboxFilter, type InboxItem } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';

	let search = $state('');
	let category = $state<string>('all');
	let priority = $state<'all' | 'high' | 'unorganized'>('all');
	let busy = $state<null | 'connect' | 'sync' | 'organize'>(null);

	const PRIORITY_OPTIONS = [
		{ value: 'all', label: 'Any priority' },
		{ value: 'high', label: 'Priority 4–5' },
		{ value: 'unorganized', label: 'Not organized' }
	];
	/** Snapshot of the open message — a list refetch can never blank the dialog. */
	let selectedItem = $state<InboxItem | null>(null);

	/** `?message=<id>` is the source of truth: survives refresh, Back and list refetches. */
	const messageParam = $derived(page.url.searchParams.get('message'));
	const open = $derived(Boolean(messageParam));

	$effect(() => {
		const id = messageParam;
		if (id && selectedItem?.id !== id) void selectById(id);
	});

	function selectItem(item: InboxItem) {
		selectedItem = item;
		if (messageParam !== item.id) {
			void goto(`?message=${item.id}`, { keepFocus: true, noScroll: true });
		}
	}

	async function selectById(id: string) {
		try {
			selectedItem = await getMessage(id);
		} catch (error) {
			toast.error(errorMessage(error));
			if (messageParam) void goto(page.url.pathname, { keepFocus: true, noScroll: true });
		}
	}

	/** Esc · ✕ · Close — the browser Back button clears the param by itself. */
	function closeMessage() {
		if (messageParam) void goto(page.url.pathname, { keepFocus: true, noScroll: true });
	}

	function openFullPage() {
		if (!selectedItem) return;
		void goto(`/inbox/${selectedItem.id}`);
	}

	/** Narrow the Select's free string back to the filter union. */
	function setPriority(next: string) {
		if (next === 'all' || next === 'high' || next === 'unorganized') priority = next;
	}

	const filter = $derived<InboxFilter>({
		category: category as InboxFilter['category'],
		priority,
		search: search.trim() || undefined
	});

	const inbox = $derived(getInbox(filter));
	const status = getAccountStatus();
	const settings = getSettings();

	async function run(action: 'connect' | 'sync' | 'organize') {
		busy = action;
		try {
			if (action === 'connect') {
				const result = await connectGmail().updates(getInbox);
				toast.success(`Connected ${result.address}. Pulling mail…`);
				const sync = await syncMail().updates(getInbox, getDigest);
				reportSync(sync);
			} else if (action === 'sync') {
				reportSync(await syncMail().updates(getInbox, getDigest));
			} else {
				const result = await organizeMail().updates(getInbox, getDigest);
				if (result.organized === 0 && result.failed === 0) {
					toast.info('Everything is already organized.');
				} else {
					toast.success(
						`Organized ${result.organized} message${result.organized === 1 ? '' : 's'}.`
					);
				}
			}
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			busy = null;
		}
	}

	function reportSync(result: {
		fetched: number;
		added: number;
		organized: number;
		failed: number;
	}) {
		const parts = [
			`${result.fetched} fetched`,
			`${result.added} new`,
			`${result.organized} organized`
		];
		if (result.failed > 0) parts.push(`${result.failed} failed`);
		toast.success(parts.join(' · '));
	}
</script>

<svelte:head><title>Inbox · Kikitai</title></svelte:head>

<div class="flex min-h-full flex-col">
	<header class="border-b border-border px-4 py-4 sm:px-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="font-heading text-2xl italic">Inbox</h1>
				<p class="mt-0.5 text-xs text-muted-foreground">
					read-only · labels are stored here, never written back to Gmail
				</p>
			</div>
			<div class="flex items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => run('organize')}
					disabled={busy !== null}
				>
					{#if busy === 'organize'}
						<LoaderCircle class="size-4 animate-spin" /> Organizing…
					{:else}
						<Sparkles class="size-4" /> Organize
					{/if}
				</Button>
				<Button size="sm" onclick={() => run('sync')} disabled={busy !== null}>
					{#if busy === 'sync'}
						<LoaderCircle class="size-4 animate-spin" /> Syncing…
					{:else}
						<RefreshCw class="size-4" /> Sync
					{/if}
				</Button>
			</div>
		</div>

		<div class="mt-4 flex flex-wrap items-center gap-2">
			<div class="relative min-w-52 flex-1">
				<Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input class="pl-8" placeholder="Search subject, sender…" bind:value={search} />
			</div>

			<Select.Root
				type="single"
				items={PRIORITY_OPTIONS}
				value={priority}
				onValueChange={setPriority}
			>
				<Select.Trigger class="w-44" aria-label="Filter by priority">
					<Select.Value placeholder="Any priority" />
				</Select.Trigger>
				<Select.Content>
					{#each PRIORITY_OPTIONS as option (option.value)}
						<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		<Tabs.Root class="mt-3" bind:value={category}>
			<!--
				The list defaults to w-fit, which outruns a phone and drags the whole
				page sideways. Keep hugging on desktop; on a phone it caps at the row
				and scrolls inside itself.
			-->
			<Tabs.List
				class="max-w-full scrollbar-none justify-start overflow-x-auto [&::-webkit-scrollbar]:hidden"
			>
				<Tabs.Trigger value="all">All</Tabs.Trigger>
				{#each CATEGORIES as cat (cat)}
					<Tabs.Trigger value={cat}>{CATEGORY_LABELS[cat]}</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</Tabs.Root>
	</header>

	{#await status}
		<div class="space-y-3 p-6">
			{#each Array(5) as _, i (i)}
				<div class="h-16 animate-pulse bg-muted"></div>
			{/each}
		</div>
	{:then st}
		{#if !st.connected}
			<div class="grid flex-1 place-items-center p-6">
				<div class="max-w-md text-center">
					<span class="mx-auto grid size-10 place-items-center bg-primary/10 text-primary">
						<Link2 class="size-5" />
					</span>
					<h2 class="mt-4 font-heading text-xl italic">Connect your Gmail</h2>
					<p class="mt-2 text-sm text-muted-foreground">
						Kikitai signs in with your own Google OAuth client and asks for exactly one permission:
						<strong>gmail.readonly</strong>. Nothing can be sent, deleted or modified. Tokens are
						encrypted at rest on your server.
					</p>
					<Button class="mt-5" onclick={() => run('connect')} disabled={busy !== null}>
						{#if busy === 'connect'}
							<LoaderCircle class="size-4 animate-spin" /> Connecting…
						{:else}
							Connect Gmail
						{/if}
					</Button>
					<p class="mt-3 text-xs text-muted-foreground">
						No Google client yet? Add <code>GOOGLE_CLIENT_ID</code> /
						<code>GOOGLE_CLIENT_SECRET</code>
						to your <code>.env</code> — the README walks through the console step by step.
					</p>
				</div>
			</div>
		{:else}
			{#await inbox}
				<div class="space-y-3 p-6">
					{#each Array(6) as _, i (i)}
						<div class="h-16 animate-pulse bg-muted"></div>
					{/each}
				</div>
			{:then items}
				{#if items.length === 0}
					<div class="grid flex-1 place-items-center p-10 text-center">
						<div class="max-w-sm">
							<InboxIcon class="mx-auto size-8 text-muted-foreground" />
							<h2 class="mt-3 font-heading text-lg italic">Nothing here</h2>
							<p class="mt-1.5 text-sm text-muted-foreground">
								{search.trim() || category !== 'all' || priority !== 'all'
									? 'No messages match this filter.'
									: st.lastSyncAt
										? `Last sync ${st.lastSyncAt.toLocaleString()}. Press Sync to pull new mail.`
										: 'Press Sync to pull the last window of mail from Gmail.'}
							</p>
						</div>
					</div>
				{:else}
					<div class="divide-y divide-border border-b border-border">
						{#each items as item (item.id)}
							<MessageCard
								{item}
								selected={selectedItem?.id === item.id}
								onclick={() => selectItem(item)}
							/>
						{/each}
					</div>
				{/if}

				<!-- Rendered outside the inbox {#await} so a refetch never unmounts it. -->
				{#await settings then cfg}
					<MessageView
						{open}
						item={selectedItem}
						engine={cfg.ttsEngine as EngineId}
						voice={cfg.ttsVoice}
						speed={cfg.ttsSpeed}
						ramp={cfg.ttsRamp}
						ondismiss={closeMessage}
						onfullpage={openFullPage}
						onsaved={(fresh) => (selectedItem = fresh)}
					/>
				{/await}
			{:catch error}
				<p class="p-6 text-sm text-destructive">{errorMessage(error)}</p>
			{/await}
		{/if}
	{:catch error}
		<p class="p-6 text-sm text-destructive">{errorMessage(error)}</p>
	{/await}
</div>
