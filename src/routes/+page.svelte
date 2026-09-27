<script lang="ts">
	import { AudioLines, ArrowRight, Inbox, ShieldCheck, Sparkles, Volume2 } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';

	const pillars = [
		{
			icon: Sparkles,
			title: 'It sorts the mail',
			body: 'Every new message gets a category, a two-line summary and a priority — from any OpenAI-compatible endpoint, including a local model on your own machine.'
		},
		{
			icon: Volume2,
			title: 'It reads it aloud',
			body: 'A local neural voice speaks the morning digest in your browser. The text never leaves the device, and the running cost stays $0 forever.'
		},
		{
			icon: ShieldCheck,
			title: 'It only reads',
			body: 'One restricted scope, gmail.readonly. No sending, no deleting, no labels written back. Your labels live in this app’s own database.'
		}
	];

	const steps = [
		{
			n: '01',
			title: 'Connect Gmail',
			body: 'Your own OAuth client, Testing mode, one read-only scope.'
		},
		{
			n: '02',
			title: 'Press Sync',
			body: 'Messages are pulled, parsed to plain text, and organized by your AI endpoint.'
		},
		{
			n: '03',
			title: 'Press Play',
			body: 'The digest plays in order, follow-along highlighting each sentence.'
		}
	];

	const sample = [
		{
			from: 'Ada · Ledger',
			subject: 'Invoice #2291 due Friday',
			priority: 5,
			line: 'Ada needs a reply: invoice 2291 is due Friday, payment link attached.'
		},
		{
			from: 'Buildkite',
			subject: 'Pipeline #482 passed',
			priority: 2,
			line: 'Buildkite reports pipeline 482 passed in 3 minutes 12 seconds.'
		},
		{
			from: 'Newsletter',
			subject: 'This week in WebGPU',
			priority: 1,
			line: 'A weekly digest you subscribed to — no action required.'
		}
	];
</script>

<svelte:head>
	<title>Kikitai — your mail, read to you</title>
	<meta
		name="description"
		content="Self-hosted AI email organizer that reads your inbox aloud. Read-only Gmail, configurable AI, local text-to-speech."
	/>
</svelte:head>

<div class="min-h-svh">
	<header class="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
		<a href={resolve('/')} class="flex items-center gap-2">
			<span class="grid size-7 place-items-center bg-primary text-primary-foreground">
				<AudioLines class="size-4" />
			</span>
			<span class="font-heading text-lg italic">Kikitai</span>
		</a>
		<nav class="flex items-center gap-2">
			<Button variant="ghost" size="sm" onclick={() => (location.href = '/login')}>Sign in</Button>
			<Button size="sm" onclick={() => (location.href = '/login')}>
				Get started <ArrowRight class="size-3.5" />
			</Button>
		</nav>
	</header>

	<main class="mx-auto max-w-5xl px-4 sm:px-6">
		<section class="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.1fr_1fr]">
			<div>
				<p
					class="mb-4 inline-flex items-center gap-2 border border-border px-2.5 py-1 text-xs tracking-widest text-muted-foreground uppercase"
				>
					<span class="size-1.5 bg-primary"></span>
					self-hosted · open source · $0 to run
				</p>
				<h1 class="font-heading text-4xl leading-[1.05] italic sm:text-6xl">
					Your inbox,<br />read out loud.
				</h1>
				<p class="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
					Kikitai connects your Gmail, lets an AI sort it into a priority digest, and speaks that
					digest in your browser. No cloud voice, no mail sent on your behalf.
				</p>
				<div class="mt-7 flex flex-wrap items-center gap-3">
					<Button onclick={() => (location.href = '/login')}>
						Connect your inbox <ArrowRight class="size-4" />
					</Button>
					<Button
						variant="outline"
						onclick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
					>
						How it works
					</Button>
				</div>
			</div>

			<Card.Root class="overflow-hidden shadow-xl shadow-black/5">
				<Card.Header class="flex-row items-center justify-between space-y-0">
					<div class="flex items-center gap-2">
						<Inbox class="size-4 text-primary" />
						<Card.Title class="text-sm">Morning digest</Card.Title>
					</div>
					<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span class="size-1.5 animate-pulse rounded-full bg-primary"></span> speaking
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each sample as item, i (item.subject)}
						<div
							class="border border-border p-3 {i === 0
								? 'border-primary/60 bg-primary/5'
								: 'bg-card'}"
						>
							<div class="flex items-baseline justify-between gap-3">
								<p class="truncate text-sm font-medium">{item.subject}</p>
								<span class="shrink-0 text-[10px] tracking-widest text-muted-foreground">
									P{item.priority}
								</span>
							</div>
							<p class="mt-0.5 text-xs text-muted-foreground">{item.from}</p>
							<p class="mt-2 text-sm {i === 0 ? 'text-foreground' : 'text-muted-foreground'}">
								{#if i === 0}
									<span class="bg-primary/15 px-0.5">{item.line.slice(0, 28)}</span
									>{item.line.slice(28)}
								{:else}
									{item.line}
								{/if}
							</p>
						</div>
					{/each}
					<div class="flex items-center gap-3 pt-1">
						<AudioLines class="size-4 shrink-0 text-primary" />
						<div class="h-1 flex-1 bg-muted">
							<div class="h-full w-1/3 bg-primary"></div>
						</div>
						<span class="text-[11px] text-muted-foreground tabular-nums">0:14 / 0:41</span>
					</div>
				</Card.Content>
			</Card.Root>
		</section>

		<Separator />

		<section class="grid gap-8 py-14 sm:grid-cols-3">
			{#each pillars as pillar (pillar.title)}
				<div>
					<pillar.icon class="size-5 text-primary" />
					<h2 class="mt-3 font-heading text-xl italic">{pillar.title}</h2>
					<p class="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
				</div>
			{/each}
		</section>

		<Separator />

		<section id="how" class="py-14">
			<h2 class="font-heading text-2xl italic">Three steps, then it runs itself</h2>
			<div class="mt-8 grid gap-6 sm:grid-cols-3">
				{#each steps as step (step.n)}
					<div class="border-t-2 border-primary pt-4">
						<p class="text-xs tracking-widest text-primary">{step.n}</p>
						<h3 class="mt-2 text-base font-medium">{step.title}</h3>
						<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
					</div>
				{/each}
			</div>
		</section>

		<section class="border border-border bg-muted/40 p-6 sm:p-10">
			<div class="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
				<div>
					<h2 class="font-heading text-2xl italic">Run it yourself tonight</h2>
					<p class="mt-2 max-w-lg text-sm text-muted-foreground">
						<code class="text-foreground">bun install && bun run dev</code>, your own Google OAuth
						client, one AI endpoint. Nothing provider-specific is hardcoded — cloud or local model,
						your call.
					</p>
				</div>
				<Button onclick={() => (location.href = '/login')}>
					Open Kikitai <ArrowRight class="size-4" />
				</Button>
			</div>
		</section>
	</main>

	<footer
		class="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-10 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"
	>
		<p>Kikitai (聞きたい) — “I want to hear it.”</p>
		<p>gmail.readonly · no telemetry · no cloud TTS required</p>
	</footer>
</div>
