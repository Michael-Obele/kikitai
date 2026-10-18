<script lang="ts">
	import { countWords, importUrl } from '$lib/api-client';
	import { clearBearer, createMobileAuthClient, loadBearer } from '$lib/auth';
	import { mode, toggleMode } from 'mode-watcher';

	let webOrigin = $state('https://kikitai.example.com');
	let text = $state('');
	let url = $state('');
	let status = $state('');
	let importedTitle = $state('');
	let undoText = $state<string | null>(null);
	let importing = $state(false);

	const words = $derived(countWords(text));
	const authClient = $derived(createMobileAuthClient(webOrigin));

	async function doImport() {
		if (importing) return;
		importing = true;
		status = '';
		try {
			const out = await importUrl(webOrigin, loadBearer(), url);
			undoText = text;
			text = out.text;
			importedTitle = out.title;
			status = `Imported “${out.title}”.`;
		} catch (e) {
			if (e instanceof Error && e.message.startsWith('Unauthorized')) {
				clearBearer();
				status = 'Session expired — sign in again.';
			} else status = e instanceof Error ? e.message : 'Import failed.';
		} finally {
			importing = false;
		}
	}

	function undo() {
		if (undoText !== null) {
			text = undoText;
			undoText = null;
			importedTitle = '';
		}
	}
</script>

<svelte:head><title>Read · Kikitai Mobile</title></svelte:head>

<main class="mx-auto w-full max-w-2xl px-4 pt-[env(safe-area-inset-top)]">
	<div class="flex items-start justify-between gap-2">
		<h1 class="pt-6 text-2xl font-bold">Paste &amp; read</h1>
		<button
			type="button"
			class="mt-6 min-h-11 min-w-11 cursor-pointer border border-border p-2"
			aria-label={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
			title={mode.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
			onclick={() => toggleMode()}
		>
			{#if mode.current === 'dark'}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"
					><circle cx="12" cy="12" r="4" /><path
						d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
					/></svg
				>
			{:else}
				<svg
					width="20"
					height="20"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg
				>
			{/if}
		</button>
	</div>
	<p class="text-sm opacity-70">
		Stays on this device until you import or play. Hybrid TTS: on-device first, cloud opt-in.
	</p>

	<label class="mt-4 block text-sm font-medium" for="origin">Web backend origin</label>
	<input
		id="origin"
		class="mt-1 w-full border p-3 text-base"
		bind:value={webOrigin}
		inputmode="url"
		autocomplete="url"
	/>

	<label class="mt-4 block text-sm font-medium" for="paste">Text</label>
	<textarea
		id="paste"
		rows={8}
		bind:value={text}
		placeholder="Paste an article…"
		class="mt-1 w-full border p-3 text-base"></textarea>
	<p class="text-xs opacity-70">{words} words</p>

	<form
		class="mt-4 flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void doImport();
		}}
	>
		<input
			class="min-w-0 flex-1 border p-3 text-base"
			bind:value={url}
			placeholder="https://example.com/article"
			inputmode="url"
			aria-label="Import from URL"
		/>
		<button
			class="min-h-11 min-w-11 cursor-pointer border border-border px-4 disabled:opacity-50"
			type="submit"
			disabled={importing}
			aria-busy={importing}
		>
			{importing ? 'Importing…' : 'Import'}
		</button>
	</form>
	{#if status}<p class="mt-2 text-sm" role="status">{status}</p>{/if}
	{#if undoText !== null}
		<button class="mt-1 cursor-pointer text-sm underline" type="button" onclick={undo}
			>Undo import</button
		>
	{/if}
	{#if importedTitle}<p class="text-xs opacity-70">Reading: {importedTitle}</p>{/if}
	<p class="mt-6 text-xs opacity-70">
		Voice, speed 0.75–3×, ramp +0.1×/2min, sleep timer, and typography controls land here next —
		same ladder as web.
	</p>
</main>
