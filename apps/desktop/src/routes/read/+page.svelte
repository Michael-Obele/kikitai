<script lang="ts">
	import { countWords, importUrl } from '$lib/api-client';
	import { mode, toggleMode } from 'mode-watcher';

	let webOrigin = $state('http://localhost:5173');
	let text = $state('');
	let url = $state('');
	let status = $state('');
	let importing = $state(false);

	const words = $derived(countWords(text));

	async function doImport() {
		if (importing) return;
		importing = true;
		status = '';
		try {
			const out = await importUrl(webOrigin, '', url);
			text = out.text;
			status = `Imported “${out.title}”.`;
		} catch (err) {
			status = err instanceof Error ? err.message : 'Import failed.';
		} finally {
			importing = false;
		}
	}

	function focusPaste(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			document.getElementById('paste')?.focus();
		}
	}
</script>

<svelte:window onkeydown={focusPaste} />
<svelte:head><title>Read · Kikitai Desktop</title></svelte:head>

<main class="mx-auto max-w-3xl px-6 py-8">
	<div class="flex items-start justify-between gap-2">
		<h1 class="text-2xl font-bold">Paste &amp; read</h1>
		<button
			type="button"
			class="cursor-pointer border border-border p-2"
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
		Press Cmd/Ctrl+K to jump to the paste box. File-open and drag-drop land next.
	</p>
	<label class="mt-4 block text-sm font-medium" for="origin">Web backend origin</label>
	<input id="origin" class="mt-1 w-full border p-2" bind:value={webOrigin} />
	<label class="mt-4 block text-sm font-medium" for="paste">Text</label>
	<textarea
		id="paste"
		rows={10}
		bind:value={text}
		class="mt-1 w-full border p-2"
		placeholder="Paste an article…"></textarea>
	<p class="text-xs opacity-70">{words} words · nothing uploaded until import/play</p>
	<form
		class="mt-3 flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void doImport();
		}}
	>
		<input
			class="min-w-0 flex-1 border p-2"
			bind:value={url}
			placeholder="https://example.com/article"
			aria-label="Import from URL"
		/>
		<button
			class="cursor-pointer border border-border px-4 disabled:opacity-50"
			type="submit"
			disabled={importing}
			aria-busy={importing}
		>
			{importing ? 'Importing…' : 'Import'}
		</button>
	</form>
	{#if status}<p class="mt-2 text-sm" role="status">{status}</p>{/if}
</main>
