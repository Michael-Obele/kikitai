<script lang="ts">
	import { ExternalLink, Maximize2 } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import MessagePanel from './message-panel.svelte';
	import { CATEGORY_LABELS, type InboxItem, type MessageDto } from '$lib/types/mail';
	import type { EngineId } from '$lib/tts';

	let {
		item = null,
		open = false,
		engine,
		voice,
		speed = 1,
		ramp = false,
		ondismiss,
		onfullpage,
		onsaved
	}: {
		item: InboxItem | null;
		/** Controlled by the host (driven by `?message=<id>`). */
		open?: boolean;
		engine: EngineId;
		voice: string;
		/** Saved speed cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
		/** The user dismissed it (Esc · X · Close) — the host clears the URL state. */
		ondismiss?: () => void;
		/** Open this message as its own page (`/inbox/[id]`). */
		onfullpage?: () => void;
		/** Fresh row after Re-organize. */
		onsaved?: (fresh: MessageDto) => void;
	} = $props();
</script>

<Dialog.Root {open} onOpenChange={(next) => (!next ? ondismiss?.() : undefined)}>
	<!--
		interactOutsideBehavior="ignore" — clicking the list behind the dialog no longer
		closes it (the state killer). Esc and the ✕ still work, so it stays accessible.
	-->
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-2xl" interactOutsideBehavior="ignore">
		{#if item}
			<Dialog.Header>
				<div class="flex items-start justify-between gap-3">
					<Dialog.Title class="leading-snug">{item.subject}</Dialog.Title>
					{#if item.category}
						<Badge class="shrink-0">{CATEGORY_LABELS[item.category]}</Badge>
					{/if}
				</div>
				<Dialog.Description>
					{item.fromName || item.fromEmail}
					{#if item.fromName && item.fromEmail}
						<span class="text-muted-foreground">· {item.fromEmail}</span>
					{/if}
					·
					{item.receivedAt.toLocaleString(undefined, {
						dateStyle: 'medium',
						timeStyle: 'short'
					})}
				</Dialog.Description>
			</Dialog.Header>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				<MessagePanel {item} {engine} {voice} {speed} {ramp} {onsaved} />
			</div>

			<Separator />

			<div class="flex flex-wrap items-center justify-end gap-2">
				<Button variant="outline" size="sm" onclick={() => onfullpage?.()}>
					<Maximize2 class="size-4" /> Full page
				</Button>
				<a
					href="https://mail.google.com/mail/u/0/#all/{item.gmailId}"
					target="_blank"
					rel="noreferrer"
				>
					<Button variant="outline" size="sm">
						<ExternalLink class="size-4" /> Open in Gmail
					</Button>
				</a>
				<Button size="sm" onclick={() => ondismiss?.()}>Close</Button>
			</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
