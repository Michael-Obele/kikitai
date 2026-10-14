<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste, Download, LoaderCircle, Undo2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import VoicePicker from '$lib/components/player/voice-picker.svelte';
	import OfflineBanner from '$lib/components/offline-banner.svelte';
	import { resolveVoicePrefs, seedVoicePrefs, voicePrefs } from '$lib/player-prefs.svelte';
	import { importUrl, saveVoiceChoice } from '$lib/remote';
	import type { EngineId } from '$lib/tts';
	import TelemetryCard from '$lib/components/player/telemetry-card.svelte';
	import { readPlayer } from './read-player.svelte';

	let { data } = $props();

	let text = $state('');
	/**
	 * First paint: the server copy or the module defaults — deliberately the
	 * same answer on server and client, because localStorage can take no part
	 * in SSR (seeding from the remembered copy here would paint a voice the
	 * server never rendered). The remembered copy lands in the effect below.
	 */
	// svelte-ignore state_referenced_locally -- deliberate first-paint capture; the post-mount effect owns the remembered copy.
	const seeded = seedVoicePrefs(data.settings);
	let engine = $state<EngineId>(seeded.engine);
	let voice = $state(seeded.voice);
	/** Server copy when signed in, remembered copy otherwise — speed + ramp. */
	const resolved = $derived(resolveVoicePrefs(data.settings));

	/** Name of the page the last import brought in, so the player can label the
	 *  item after the article instead of after its first sentence. */
	let importedTitle = $state('');
	/** What the box held before an import, so Undo can put it back. */
	let undoText = $state<string | null>(null);
	/** Set when the *transport* failed (network gone, server restarted). Field
	 *  issues and refusals arrive through `importUrl.result`; this is the one
	 *  case that would otherwise make SvelteKit navigate to the error page. */
	let submitError = $state('');

	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(
		text.trim() ? [{ id: 'paste', text, title: importedTitle || undefined }] : []
	);

	/** Survive back-navigation; the text is never sent anywhere. */
	export const snapshot: Snapshot<string> = {
		capture: () => text,
		restore: (value) => (text = value)
	};

	// Post-mount swap to the remembered voice — the same `resolveVoicePrefs`
	// rule every host uses (signed in it simply re-lands on the server values).
	$effect(() => {
		const remembered = resolveVoicePrefs(data.settings);
		engine = remembered.engine;
		voice = remembered.voice;
	});

	/**
	 * The import writes the one source of truth (`text`) straight from the
	 * submit result, so there is no `$effect` here: this runs exactly once per
	 * submission, in an event, and never mirrors state back and forth.
	 * A non-ok result is *not* thrown — a thrown error would navigate `/read`
	 * to an error page, and the message belongs next to the field instead.
	 */
	/** The field props the form lends us: `name` ties the input to the schema
	 *  key and `aria-invalid` marks it after a failed submission. */
	const urlField = importUrl.fields.url.as('text');

	// `enhance` hands back only the spreadable form props (its type, not its
	// runtime shape), so the markup keeps reading `importUrl` for fields, result
	// and pending — this call is only here to swap in our submit handler.
	importUrl.enhance(async (f) => {
		const before = text;
		submitError = '';
		try {
			if (!(await f.submit())) return; // field issues are rendered below
		} catch {
			// A rejected submit is a transport failure, not a validation one: kit
			// would show the full-page error, and the brief wants it inline.
			submitError = 'The import could not reach the server. Try again in a moment.';
			return;
		}
		if (!f.result?.ok) return; // the failure message is rendered below
		text = f.result.text;
		importedTitle = f.result.title;
		undoText = before;
	});

	/** Typing makes the text theirs: the import notice (and its Undo) is moot. */
	function textEdited() {
		undoText = null;
		importedTitle = '';
		submitError = '';
	}

	function undoImport() {
		if (undoText === null) return;
		text = undoText;
		undoText = null;
		importedTitle = '';
	}

	/** Remember the choice here; signed-in users get it on the server too. */
	function voiceChanged() {
		voicePrefs.current = { engine, voice };
		void saveVoiceChoice({ engine, voice }).catch(() => {
			/* signed out — localStorage is the source of truth */
		});
	}
</script>

<svelte:head>
	<title>Paste & read · Kikitai</title>
	<meta
		name="description"
		content="Paste any text and hear it read aloud in your browser — free, offline, nothing uploaded."
	/>
</svelte:head>

<!-- Same strip as (app): one component, one module. -->
<OfflineBanner />

<div class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
	<h1 class="flex items-center gap-2 font-heading text-2xl italic">
		<ClipboardPaste class="size-5 text-primary" /> Paste &amp; read
	</h1>
	<!--
		`text-sm` stays on the two elements below for the line-height ratio it
		carries; `.reading` supplies the size and the face and deliberately sets no
		leading, so keeping the utility is what holds their spacing still.
		The paste box keeps the browser's own wrapping, which is why it alone has no
		`wrap-anywhere` — an input scrolls rather than splitting a URL mid-word while
		you edit it.
	-->
	<p class="reading mt-1 text-sm text-muted-foreground">
		Anything you paste is read aloud right here. It stays on this device — no upload, no account
		needed.
	</p>

	<div class="mt-6 space-y-1.5">
		<Label for="pasteText">Text</Label>
		<!--
			Locked while an import flies: the result replaces `text`, so typing
			during those seconds would be silently overwritten — and Undo would put
			back the submit-time copy, not what they were in the middle of writing.
		-->
		<textarea
			id="pasteText"
			rows={10}
			bind:value={text}
			oninput={textEdited}
			disabled={importUrl.pending > 0}
			placeholder="Paste an article, a chapter, a PDF page…"
			class="reading flex w-full border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50"
		></textarea>
		<p class="text-xs text-muted-foreground">{words} words · nothing leaves your device</p>
	</div>

	<!-- Import from URL: the server fetches the page and sends back text only, so
	     the HTML never reaches this device and nothing is stored anywhere. -->
	<form {...importUrl} class="mt-4 space-y-1.5">
		<div class="flex flex-wrap items-end gap-2">
			<div class="min-w-0 flex-1 space-y-1.5">
				<Label for="importUrlInput">Import from URL</Label>
				<Input
					id="importUrlInput"
					name={urlField.name}
					aria-invalid={urlField['aria-invalid']}
					inputmode="url"
					autocomplete="url"
					placeholder="https://example.com/article"
				/>
			</div>
			<Button type="submit" disabled={importUrl.pending > 0}>
				{#if importUrl.pending > 0}
					<LoaderCircle class="size-4 animate-spin" /> Importing…
				{:else}
					<Download class="size-4" /> Import
				{/if}
			</Button>
		</div>

		{#each importUrl.fields.url.issues() ?? [] as issue (issue.message)}
			<p class="text-xs text-destructive" role="alert">{issue.message}</p>
		{/each}

		{#if importUrl.result && !importUrl.result.ok}
			<p class="text-xs text-destructive" role="alert">{importUrl.result.error}</p>
		{/if}

		{#if submitError}
			<p class="text-xs text-destructive" role="alert">{submitError}</p>
		{/if}

		{#if undoText !== null}
			<p class="text-xs text-muted-foreground" role="status">
				Imported “{importedTitle}” into the box above.
				<button
					type="button"
					class="text-primary underline underline-offset-2"
					onclick={undoImport}
				>
					<Undo2 class="inline-block size-3" /> Undo
				</button>
			</p>
		{/if}
	</form>

	<div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
		<div class="min-w-0">
			<!--
				No wrapper box: the reader draws its own frame, and the transport has to
				run the full width of the column to pin itself to the viewport cleanly.
			-->
			<Player
				store={readPlayer}
				{items}
				{engine}
				{voice}
				speed={resolved.speed}
				ramp={resolved.ramp}
				stickyControls
			/>
		</div>

		<aside class="space-y-4 lg:sticky lg:top-20">
			<div class="border border-border p-3">
				<VoicePicker bind:engine bind:voice prefix="read" onchange={voiceChanged} />
			</div>

			<TelemetryCard {engine} />
		</aside>
	</div>
</div>
