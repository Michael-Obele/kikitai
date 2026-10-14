<script lang="ts">
	import { ALargeSmall, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		DEFAULT_READER_PREFS,
		READER_FONTS,
		READER_LEADINGS,
		READER_SIZES,
		currentReaderPrefs,
		isReaderFont,
		readerPrefsChanged,
		resetReaderPrefs,
		setReaderFont,
		setReaderLeading,
		setReaderSize
	} from '$lib/reader-prefs.svelte';

	/**
	 * The reading-settings control: text size, face and line spacing, for the
	 * text you read rather than the page around it.
	 *
	 * It is mounted wherever reading happens (the site header, the reader's
	 * control row, the message panel) and every instance drives the same store,
	 * so a change made in one is already true in the others.
	 *
	 * Built on DropdownMenu rather than a hand-rolled popover because the
	 * primitive already gets the hard parts right: `menuitemradio` semantics,
	 * arrow-key navigation, typeahead, and the check indicator.
	 */
	let { align = 'end' }: { align?: 'start' | 'center' | 'end' } = $props();

	const prefs = $derived(currentReaderPrefs());
	const changed = $derived(readerPrefsChanged());
	const sizeLabel = $derived(`${Math.round(prefs.size * 100)}%`);
	const currentFont = $derived(READER_FONTS.find((font) => font.id === prefs.font));

	/**
	 * A menu radio item's value is typed as a string, so the two numeric ladders
	 * are stringified on the way in and parsed back here. The store's setters
	 * reject anything off the ladder, so an unparseable value cannot reach storage
	 * and the checked state can always find its item.
	 */
	function pickSize(value: unknown) {
		if (typeof value === 'string') setReaderSize(Number(value));
	}

	function pickFont(value: unknown) {
		if (isReaderFont(value)) setReaderFont(value);
	}

	function pickLeading(value: unknown) {
		if (typeof value === 'string') setReaderLeading(Number(value));
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="ghost"
				size="icon-sm"
				aria-label="Reading settings — text size {sizeLabel}"
				title="Text size and font"
			>
				<ALargeSmall class="size-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<!--
		`w-64` because the trigger is an icon: DropdownMenu's default width is the
		anchor's, which for a 28px button would be unusable.
	-->
	<DropdownMenu.Content {align} class="w-64">
		<DropdownMenu.Label>Text size</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={String(prefs.size)} onValueChange={pickSize}>
			{#each READER_SIZES as size (size)}
				<DropdownMenu.RadioItem value={String(size)}>
					<span class="tabular-nums">{Math.round(size * 100)}%</span>
					{#if size === DEFAULT_READER_PREFS.size}
						<span class="text-xs text-muted-foreground">· default</span>
					{/if}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>

		<DropdownMenu.Separator />
		<DropdownMenu.Label>Font</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={prefs.font} onValueChange={pickFont}>
			{#each READER_FONTS as font (font.id)}
				<!-- Each option is set in its own face: the list is the preview. -->
				<DropdownMenu.RadioItem value={font.id}>
					<span style="font-family: {font.stack}">{font.label}</span>
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>

		<DropdownMenu.Separator />
		<DropdownMenu.Label>Line spacing</DropdownMenu.Label>
		<DropdownMenu.RadioGroup value={String(prefs.leading)} onValueChange={pickLeading}>
			{#each READER_LEADINGS as leading (leading)}
				<DropdownMenu.RadioItem value={String(leading)}>
					{#if leading === 1.4}Tight{:else if leading === 1.625}Normal{:else if leading === 1.8}Relaxed{:else}Loose{/if}
					{#if leading === DEFAULT_READER_PREFS.leading}
						<span class="text-xs text-muted-foreground">· default</span>
					{/if}
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>

		<DropdownMenu.Separator />
		<p class="px-2 py-1.5 text-xs text-muted-foreground">
			Applies to the article and message text. Currently {sizeLabel}, {currentFont?.label}.
		</p>

		{#if changed}
			<DropdownMenu.Item onclick={resetReaderPrefs}>
				<RotateCcw class="size-3.5" />
				Reset to default
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
