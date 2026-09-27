<script lang="ts">
	import { AudioLines, CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { authClient, signInWithGoogle } from '$lib/auth-client';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { getAuthOptions } from '$lib/remote';

	let mode = $state<'in' | 'up'>('in');
	let name = $state('');
	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let googleBusy = $state(false);
	let message = $state('');

	const authOptions = getAuthOptions();

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = '';
		const result =
			mode === 'in'
				? await authClient.signIn.email({ email, password })
				: await authClient.signUp.email({ name, email, password });
		busy = false;
		if (result.error) {
			message = result.error.message ?? 'That did not work.';
			return;
		}
		location.href = '/dashboard';
	}

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

<svelte:head><title>Sign in · Kikitai</title></svelte:head>

<div class="grid min-h-svh place-items-center bg-muted/40 px-4 py-10">
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
				<Card.Title class="text-lg"
					>{mode === 'in' ? 'Welcome back' : 'Create your account'}</Card.Title
				>
				<Card.Description>
					{mode === 'in' ? 'Sign in to hear your inbox.' : 'Self-hosted, read-only, $0 to run.'}
				</Card.Description>
			</Card.Header>

			<Card.Content class="space-y-4">
				{#await authOptions}
					<Button variant="outline" class="w-full" disabled>
						<LoaderCircle class="size-4 animate-spin" /> Checking sign-in options…
					</Button>
				{:then options}
					{#if options.google}
						<Button variant="outline" class="w-full" onclick={google} disabled={googleBusy}>
							{#if googleBusy}
								<LoaderCircle class="size-4 animate-spin" /> Redirecting…
							{:else}
								Continue with Google
							{/if}
						</Button>
						<div class="flex items-center gap-3">
							<Separator class="flex-1" />
							<span class="text-xs tracking-wide text-muted-foreground uppercase">or</span>
							<Separator class="flex-1" />
						</div>
					{/if}
				{/await}

				<form class="space-y-3" onsubmit={submit}>
					{#if mode === 'up'}
						<div class="space-y-1.5">
							<Label for="name">Name</Label>
							<Input id="name" name="name" bind:value={name} autocomplete="name" required />
						</div>
					{/if}

					<div class="space-y-1.5">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							bind:value={email}
							autocomplete="email"
							required
						/>
					</div>

					<div class="space-y-1.5">
						<Label for="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							bind:value={password}
							autocomplete={mode === 'in' ? 'current-password' : 'new-password'}
							required
							minlength={8}
						/>
					</div>

					{#if message}
						<p class="flex items-start gap-1.5 text-xs text-destructive">
							<CircleAlert class="mt-0.5 size-3.5 shrink-0" />
							{message}
						</p>
					{/if}

					<Button type="submit" class="w-full" disabled={busy}>
						{#if busy}
							<LoaderCircle class="size-4 animate-spin" /> Working…
						{:else}
							{mode === 'in' ? 'Sign in' : 'Create account'}
						{/if}
					</Button>
				</form>
			</Card.Content>

			<Card.Footer class="justify-center text-xs text-muted-foreground">
				<button
					class="underline underline-offset-2 hover:text-foreground"
					onclick={() => (mode = mode === 'in' ? 'up' : 'in')}
				>
					{mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
				</button>
			</Card.Footer>
		</Card.Root>

		<p class="mt-4 text-center text-xs text-muted-foreground">
			Gmail is requested <strong>read-only</strong>. Nothing here can send, delete or modify mail.
		</p>
	</div>
</div>
