<script lang="ts">
	import { AudioLines, CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { signInWithGoogle } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { getAuthOptions } from '$lib/remote';

	let googleBusy = $state(false);
	let message = $state('');

	const authOptions = getAuthOptions();

	async function google() {
		googleBusy = true;
		message = '';
		const result = await signInWithGoogle();
		if (result.error) {
			googleBusy = false;
			message = result.error.message ?? 'Google sign-in failed.';
		}
	}
</script>

<svelte:head>
	<title>Sign in · Kikitai</title>
</svelte:head>

<div class="grid flex-1 place-items-center bg-muted/40 px-4 py-10">
	<div class="w-full max-w-sm">
		<div class="mb-6 flex flex-col items-center text-center">
			<span class="grid size-9 place-items-center bg-primary text-primary-foreground">
				<AudioLines class="size-5" />
			</span>
			<h1 class="mt-4 font-heading text-3xl italic">Kikitai</h1>
			<p class="mt-1 text-sm text-muted-foreground">聞きたい — “I want to hear it.”</p>
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-lg">Welcome back</Card.Title>
				<Card.Description>Sign in with Google to hear your inbox.</Card.Description>
			</Card.Header>

			<Card.Content class="space-y-4">
				{#await authOptions}
					<Button variant="outline" class="w-full" disabled>
						<LoaderCircle class="size-4 animate-spin" /> Checking sign-in options…
					</Button>
				{:then options}
					{#if options.google}
						<Button class="w-full" onclick={google} disabled={googleBusy}>
							{#if googleBusy}
								<LoaderCircle class="size-4 animate-spin" /> Redirecting…
							{:else}
								Continue with Google
							{/if}
						</Button>
					{:else}
						<p class="text-sm text-muted-foreground">
							Google sign-in isn’t configured yet — set <code>GOOGLE_CLIENT_ID</code> and
							<code>GOOGLE_CLIENT_SECRET</code> in <code>.env</code> (see
							<code>docs/google-oauth.md</code>).
						</p>
					{/if}
				{/await}

				{#if message}
					<p class="flex items-start gap-1.5 text-xs text-destructive">
						<CircleAlert class="mt-0.5 size-3.5 shrink-0" />
						{message}
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<p class="mt-4 text-center text-xs text-muted-foreground">
			Sign-in is Google-only. Gmail is requested <strong>read-only</strong> — nothing here can send, delete
			or modify mail.
		</p>
	</div>
</div>
