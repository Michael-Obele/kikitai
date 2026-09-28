<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		AudioLines,
		ListTree,
		LoaderCircle,
		MessagesSquare,
		RefreshCw,
		Volume2,
		WandSparkles
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import Player from '$lib/components/player/player.svelte';
	import FactsChips from './facts-chips.svelte';
	import {
		getInbox,
		getMessage,
		loadDetails,
		loadListenScript,
		loadThreadSummary,
		regenerateSummary,
		saveVoiceChoice,
		simplifyMessage
	} from '$lib/remote';
	import { errorMessage } from '$lib/errors';
	import type { InboxItem, MessageDetails, MessageDto } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';
	import VoicePicker from '$lib/components/player/voice-picker.svelte';
	import TelemetryCard from '$lib/components/player/telemetry-card.svelte';
	import WordLine from '$lib/components/player/word-line.svelte';

	let {
		item,
		engine: initialEngine,
		voice: initialVoice,
		speed = 1,
		ramp = false,
		onsaved
	}: {
		item: InboxItem;
		/** Starting choice from Settings — the panel owns it from here. */
		engine: EngineId;
		voice: string;
		/** Saved speed cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
		/** Fresh row after a successful Re-organize — the host swaps it into its own snapshot. */
		onsaved?: (fresh: MessageDto) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let engine = $state<EngineId>(initialEngine);
	// svelte-ignore state_referenced_locally
	let voice = $state(initialVoice);
	let reorganizing = $state(false);
	let showOriginal = $state(false);
	let simplified = $state<string | null>(null);
	let simplifying = $state(false);
	/** Live position inside the spoken chunk — drives the now-speaking line. */
	let pointer = $state<{ chunk: number; word: number; text: string } | null>(null);
	let details = $state<MessageDetails | null>(null);
	let thread = $state<{ summary: string; highlights: string[]; messageCount: number } | null>(null);
	let spokenText = $state<string | null>(null);
	let loadingDetails = $state(false);
	let loadingThread = $state(false);
	let loadingSpoken = $state(false);

	/**
	 * Cache key suffix unique to this panel instance: `clean_body` is write-once,
	 * so a fetch made after a Simplify is always correct — while a shared cached
	 * query entry read too early can stay stale until a full page reload. Stable
	 * for the component's lifetime, so re-renders hit the cache instead of refetching.
	 */
	const loadKey = crypto.randomUUID();
	async function loadFull(id: string) {
		return getMessage(`${id}#${loadKey}`);
	}

	/**
	 * The dialog swaps `item` without remounting — reset only when the message
	 * itself changes. A same-id swap (Simplify/Re-organize saving a fresh row)
	 * must keep the state that was just set, or the AI rewrite disappears the
	 * moment it lands. Plain (untracked) variable, so the effect still depends
	 * on `item.id` alone.
	 */
	let resetFor = '';
	$effect(() => {
		const id = item.id;
		if (id === resetFor) return;
		resetFor = id;
		details = null;
		thread = null;
		spokenText = null;
		showOriginal = false;
		simplified = null;
		simplifying = false;
		pointer = null;
		loadingDetails = false;
		loadingThread = false;
		loadingSpoken = false;
	});

	async function reorganize() {
		reorganizing = true;
		try {
			details = null;
			thread = null;
			spokenText = null;
			await regenerateSummary(item.id).updates(getInbox);
			onsaved?.(await getMessage(item.id));
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			reorganizing = false;
		}
	}

	async function showDetails() {
		loadingDetails = true;
		try {
			details = (await loadDetails(item.id)).details;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingDetails = false;
		}
	}

	async function summarizeThread() {
		loadingThread = true;
		try {
			thread = await loadThreadSummary(item.id);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingThread = false;
		}
	}

	async function makeListenable() {
		loadingSpoken = true;
		try {
			spokenText = (await loadListenScript(item.id)).spokenText;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingSpoken = false;
		}
	}

	/** The panel owns the voice choice now, so persist it the same way /read does. */
	function persistVoice() {
		void saveVoiceChoice({ engine, voice }).catch(() => {
			/* best effort — the picker keeps working without a settings row */
		});
	}

	/** The only place a body costs an AI call: on request, then stored for good. */
	async function simplify() {
		simplifying = true;
		try {
			// The command answers with the stored row — reading it back through the
			// query cache can lag behind until a full page reload.
			const fresh = await simplifyMessage(item.id);
			simplified = fresh.cleanBody;
			onsaved?.(fresh);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			simplifying = false;
		}
	}
</script>

<div class="space-y-4">
	{#if item.summary}
		<div class="border-l-2 border-primary bg-primary/5 px-3 py-2">
			<p class="text-xs tracking-widest text-primary uppercase">Summary</p>
			<p class="mt-1 text-sm">{item.summary}</p>
			{#if item.actionItems.length > 0}
				<ul class="mt-2 space-y-1">
					{#each item.actionItems as action, i (i)}
						<li class="flex gap-2 text-xs text-muted-foreground">
							<span class="text-primary">→</span>{action}
						</li>
					{/each}
				</ul>
			{/if}
			{#if item.priority}
				<p class="mt-2 text-[11px] text-muted-foreground">Priority {item.priority} of 5</p>
			{/if}
		</div>
	{/if}

	<FactsChips facts={item.facts} />

	<section class="border-t border-border pt-3">
		<div class="flex items-center justify-between gap-2">
			<h4 class="text-xs tracking-widest text-muted-foreground uppercase">Details</h4>
			<Button variant="ghost" size="sm" onclick={showDetails} disabled={loadingDetails}>
				{#if loadingDetails}
					<LoaderCircle class="size-4 animate-spin" /> Thinking…
				{:else}
					<ListTree class="size-4" /> {details ? 'Refresh' : 'Details'}
				{/if}
			</Button>
		</div>
		{#if details}
			<ul class="mt-2 space-y-1">
				{#each details.keyPoints as point, i (i)}
					<li class="flex gap-2 text-sm text-muted-foreground">
						<span class="text-primary">→</span>{point}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-sm">
				<span class="text-xs tracking-widest text-muted-foreground uppercase">Asks of you</span>
				{details.askOfYou}
			</p>
			{#if details.deadlines.length > 0}
				<p class="mt-1 text-xs text-muted-foreground">
					Deadlines: {details.deadlines.join(' · ')}
				</p>
			{/if}
		{:else}
			<p class="mt-1 text-xs text-muted-foreground/70">
				One AI call the first time — bullets, what it's asking of you, and every deadline.
			</p>
		{/if}
	</section>

	{#await loadFull(item.id)}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<LoaderCircle class="size-4 animate-spin" /> Loading message…
		</div>
	{:then full}
		{@const spoken = spokenText ?? full.spokenText}
		{@const cleaned = simplified ?? full.cleanBody}
		{@const body = showOriginal || !cleaned ? full.bodyText : cleaned}
		{#if full.bodyText}
			{#if cleaned}
				<div class="flex items-center justify-between gap-2">
					<p class="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
						<WandSparkles class="size-3 shrink-0 text-primary" />
						<span class="tracking-widest uppercase">AI rewrite</span>
						<span class="truncate text-muted-foreground/60">
							— links, markdown and mailing-list furniture removed
						</span>
					</p>
					<Button
						variant="ghost"
						size="sm"
						class="h-6 shrink-0 px-2 text-xs"
						aria-pressed={showOriginal}
						onclick={() => (showOriginal = !showOriginal)}
					>
						{showOriginal ? 'Show AI rewrite' : 'Show original'}
					</Button>
				</div>
			{/if}
			<div
				class="max-h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground"
			>
				{body}
			</div>
			{#if !cleaned}
				<div class="mt-2 flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" onclick={simplify} disabled={simplifying}>
						{#if simplifying}
							<LoaderCircle class="size-4 animate-spin" /> Simplifying…
						{:else}
							<WandSparkles class="size-4" /> Simplify with AI
						{/if}
					</Button>
					<p class="text-xs text-muted-foreground">
						Drops links and mailing-list furniture, keeps every fact — then it's saved to this
						message, so it never runs twice.
					</p>
				</div>
			{/if}
		{:else}
			<p class="text-sm text-muted-foreground italic">
				No plain-text body was found in this message (it may be image-only).
			</p>
		{/if}

		{#if (full.threadCount ?? 0) > 1}
			<section class="border-t border-border pt-3">
				<h4 class="text-xs tracking-widest text-muted-foreground uppercase">
					Conversation · {thread?.messageCount ?? full.threadCount} messages
				</h4>
				{#if thread}
					<p class="mt-2 text-sm">{thread.summary}</p>
					{#if thread.highlights.length > 0}
						<ul class="mt-2 space-y-1">
							{#each thread.highlights as highlight, i (i)}
								<li class="flex gap-2 text-xs text-muted-foreground">
									<span class="text-primary">·</span>{highlight}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="mt-1 text-xs text-muted-foreground/70">
						One summary for the whole conversation, not just this message.
					</p>
					<Button
						class="mt-2"
						variant="outline"
						size="sm"
						onclick={summarizeThread}
						disabled={loadingThread}
					>
						{#if loadingThread}
							<LoaderCircle class="size-4 animate-spin" /> Summarizing…
						{:else}
							<WandSparkles class="size-4" /> Summarize conversation
						{/if}
					</Button>
				{/if}
			</section>
		{/if}

		<div class="border-t border-border pt-3">
			<VoicePicker bind:engine bind:voice prefix="msg" onchange={persistVoice} />
		</div>

		<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
			<Volume2 class="size-4 shrink-0 text-primary" />
			<div class="min-w-0 flex-1">
				<Player
					compact
					bind:pointer
					{engine}
					{voice}
					{speed}
					{ramp}
					items={[
						{
							id: item.id,
							title: item.subject,
							text:
								spoken ??
								[item.summary ?? '', cleaned ?? full.bodyText]
									.filter(Boolean)
									.join('\n\n')
									.slice(0, 2000)
						}
					]}
				/>
			</div>
			{#if !spoken && (full.bodyText?.length ?? 0) > 1200}
				<Button variant="outline" size="sm" onclick={makeListenable} disabled={loadingSpoken}>
					{#if loadingSpoken}
						<LoaderCircle class="size-4 animate-spin" /> Making listenable…
					{:else}
						<AudioLines class="size-4" /> Make listenable
					{/if}
				</Button>
			{/if}
		</div>
		{#if pointer}
			<p class="mt-2 text-xs leading-relaxed text-muted-foreground">
				<WordLine text={pointer.text} word={pointer.word} />
			</p>
		{/if}

		<TelemetryCard {engine} class="mt-3" />
	{:catch error}
		<p class="text-sm text-destructive">{errorMessage(error)}</p>
	{/await}

	<div class="flex items-center gap-2 border-t border-border pt-3">
		<Button variant="ghost" size="sm" onclick={reorganize} disabled={reorganizing}>
			{#if reorganizing}
				<LoaderCircle class="size-4 animate-spin" /> Re-organizing…
			{:else}
				<RefreshCw class="size-4" /> Re-organize
			{/if}
		</Button>
	</div>
</div>
