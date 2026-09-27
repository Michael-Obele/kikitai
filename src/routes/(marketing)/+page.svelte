<script lang="ts">
	import {
		ArrowRight,
		Ban,
		Check,
		ClipboardPaste,
		Copy,
		Cpu,
		HardDrive,
		Lock,
		Server,
		Volume2
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import Reveal from '$lib/components/landing/reveal.svelte';
	import DigestMock from '$lib/components/landing/digest-mock.svelte';
	import InboxChart from '$lib/components/landing/inbox-chart.svelte';
	import Workflow from '$lib/components/landing/workflow.svelte';
	import Comparison from '$lib/components/landing/comparison.svelte';
	import Faq from '$lib/components/landing/faq.svelte';

	/** The four numbers that matter, placed right under the hero. */
	const figures = [
		{ value: '$0', label: 'the voice, forever' },
		{ value: '57MB', label: 'downloaded once' },
		{ value: '1', label: 'OAuth scope' },
		{ value: '0', label: 'writes back to Gmail' }
	];

	/** Specifics, because developers buy specifics. */
	const inside = [
		{
			icon: Cpu,
			label: 'The AI endpoint',
			value:
				'Any OpenAI-compatible base URL with a key and a model name. OpenAI, Groq, OpenRouter, or Ollama on your own machine. It is a field in Settings, not a rebuild.'
		},
		{
			icon: HardDrive,
			label: 'Your own database',
			value:
				'Postgres with Drizzle. Messages, categories, summaries and priorities sit in your tables, on your disk.'
		},
		{
			icon: Volume2,
			label: 'Four voices to pick from',
			value:
				'Kitten is the default at about 57MB. Kokoro is the smoother one at about 90MB. The system voice is instant and 0MB. Google and MiniMax are there if you want a cloud voice.'
		},
		{
			icon: Lock,
			label: 'Secrets at rest',
			value:
				'OAuth tokens and your AI key are encrypted before they are stored. Neither ever reaches the browser.'
		},
		{
			icon: Server,
			label: 'Two ways to run it',
			value:
				'docker compose up for a server, bun run dev for your laptop. Postgres ships with the compose file.'
		},
		{
			icon: Ban,
			label: 'What it cannot do',
			value:
				'No sending, no replying, no archiving, no deleting, no writing labels back to Gmail. No telemetry either.'
		},
		{
			icon: ClipboardPaste,
			label: 'Paste & read',
			value:
				'Any text you copy — an article, a chapter, a PDF page — pasted into /read and read aloud at 0.75×–3×, with an optional auto-ramp that speeds up as you listen.'
		}
	];

	const install = `cp .env.example .env   # add DATABASE_URL and your Google client
bun install
bun run db:push
bun run dev`;

	let copied = $state(false);

	async function copyInstall() {
		try {
			await navigator.clipboard.writeText(install);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			copied = false;
		}
	}
</script>

<svelte:head>
	<title>Kikitai — your inbox, read to you</title>
	<noscript>
		<style>
			.landing-reveal {
				opacity: 1 !important;
				translate: none !important;
				transform: none !important;
			}
		</style>
	</noscript>
	<meta
		name="description"
		content="Self-hosted AI email organizer that reads your inbox aloud. One read-only Gmail scope, an AI endpoint you choose, and a voice that runs in your browser for free."
	/>
</svelte:head>

<main>
	<!-- Hero: centred, with the real thing underneath -->
	<section class="relative overflow-hidden">
		<div
			class="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-[radial-gradient(60%_60%_at_50%_50%,color-mix(in_oklch,var(--primary)_14%,transparent),transparent)]"
			aria-hidden="true"
		></div>

		<div class="relative mx-auto max-w-6xl px-4 pt-14 pb-16 sm:px-6 sm:pt-20">
			<div class="mx-auto max-w-3xl text-center">
				<Reveal>
					<p
						class="inline-flex items-center gap-2 border border-border bg-background/60 px-2.5 py-1 text-[11px] tracking-[0.2em] text-muted-foreground uppercase"
					>
						<span class="size-1.5 bg-primary"></span>
						Self-hosted · open source · the voice costs nothing
					</p>
				</Reveal>

				<Reveal delay={80}>
					<h1 class="mt-6 font-heading text-display italic">
						Your inbox,<br />read to you.
					</h1>
				</Reveal>

				<Reveal delay={160}>
					<p
						class="mx-auto mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
					>
						Connect your Gmail. An AI you choose sorts it into a priority digest. A voice in your
						browser reads that digest back to you while you make coffee.
					</p>
				</Reveal>

				<Reveal delay={240}>
					<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
						<Button size="lg" href={resolve('/login')}>
							Connect your inbox
							<ArrowRight class="size-4" />
						</Button>
						<Button size="lg" variant="outline" href="#how">See how it works</Button>
						<Button size="lg" variant="secondary" href={resolve('/read')}>
							<ClipboardPaste class="size-4" />
							Try paste &amp; read
						</Button>
					</div>
					<p class="mt-4 text-xs text-muted-foreground">
						One read-only scope. No cloud voice. Nothing sent on your behalf.
					</p>
				</Reveal>
			</div>

			<Reveal delay={320} class="mx-auto mt-14 max-w-3xl">
				<DigestMock />
			</Reveal>
		</div>
	</section>

	<!-- The four numbers -->
	<section class="border-y bg-muted/30">
		<div class="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 px-4 py-10 sm:px-6 lg:grid-cols-4">
			{#each figures as fig, i (fig.label)}
				<Reveal delay={i * 70}>
					<p class="font-heading text-3xl italic tabular-nums sm:text-4xl">{fig.value}</p>
					<p class="mt-1 text-xs text-muted-foreground">{fig.label}</p>
				</Reveal>
			{/each}
		</div>
	</section>

	<!-- The problem, then the proof -->
	<section class="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
		<Reveal>
			<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">The wall of text</p>
			<h2 class="mt-3 max-w-3xl font-heading text-title italic">
				You do not need to read forty seven messages. You need the six that need you.
			</h2>
			<p class="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
				Kikitai reads the whole pile so you can read the small part. Here is what a normal Tuesday
				looks like once it has been through the organizer, and what it does to the time you spend on
				mail.
			</p>
		</Reveal>

		<Reveal delay={120} class="mt-12">
			<InboxChart />
		</Reveal>
	</section>

	<Separator />

	<!-- One job, four steps -->
	<section id="how" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
		<Reveal>
			<Workflow />
		</Reveal>
	</section>

	<Separator />

	<!-- Read-only, and why that matters -->
	<section id="privacy" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
		<Reveal>
			<Comparison />
		</Reveal>
	</section>

	<Separator />

	<!-- What you actually get -->
	<section id="inside" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
		<Reveal>
			<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">What is in the box</p>
			<h2 class="mt-3 font-heading text-title italic">Specifics, not adjectives</h2>
		</Reveal>

		<div class="mt-12 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
			{#each inside as item, i (item.label)}
				<Reveal delay={(i % 3) * 80}>
					<div class="flex items-center gap-2">
						<item.icon class="size-4 text-primary" />
						<h3 class="text-sm font-medium">{item.label}</h3>
					</div>
					<p class="mt-2.5 text-sm leading-relaxed text-muted-foreground">{item.value}</p>
				</Reveal>
			{/each}
		</div>

		<Reveal delay={120} class="mt-14">
			<div class="border bg-card">
				<div class="flex items-center justify-between border-b bg-muted/40 px-4 py-2.5">
					<span class="font-mono text-[11px] text-muted-foreground">bun</span>
					<Button variant="ghost" size="xs" onclick={copyInstall}>
						{#if copied}
							<Check class="size-3" />
							Copied
						{:else}
							<Copy class="size-3" />
							Copy
						{/if}
					</Button>
				</div>
				<pre class="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed"><code
						>{install}</code
					></pre>
			</div>
			<p class="mt-3 text-xs text-muted-foreground">
				The Google client takes about five minutes to make. The steps are written out in
				<code class="text-foreground">docs/google-oauth.md</code>, including which scope to tick and
				why you can leave the app in testing mode.
			</p>
		</Reveal>
	</section>

	<Separator />

	<!-- Objections -->
	<section id="faq" class="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
		<Reveal>
			<Faq />
		</Reveal>
	</section>

	<!-- Last chance -->
	<section class="border-t bg-band text-band-foreground">
		<div class="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
			<Reveal>
				<h2 class="font-heading text-title italic">Run it yourself tonight</h2>
				<p class="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-band-foreground/75">
					One command, your own Google client, one AI endpoint. Nothing provider specific is
					hardcoded, so the same build works with a cloud key or a model on your own machine.
				</p>
				<div class="mt-8 flex flex-wrap items-center justify-center gap-3">
					<Button size="lg" href={resolve('/login')}>
						Connect your inbox
						<ArrowRight class="size-4" />
					</Button>
					<Button
						size="lg"
						variant="outline"
						href="#inside"
						class="border-band-foreground/30 bg-transparent text-band-foreground hover:bg-band-foreground/10 hover:text-band-foreground"
					>
						Read the setup steps
					</Button>
				</div>
			</Reveal>
		</div>
	</section>
</main>

<footer class="border-t">
	<div
		class="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6"
	>
		<p>Kikitai (聞きたい) means “I want to hear it.”</p>
		<p class="flex flex-wrap items-center gap-x-4 gap-y-1">
			<span>gmail.readonly only</span>
			<span class="text-border">·</span>
			<span>no telemetry</span>
			<span class="text-border">·</span>
			<span>no cloud voice required</span>
		</p>
	</div>
</footer>
