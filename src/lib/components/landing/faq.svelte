<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	/** The objections that decide whether someone self-hosts, answered plainly. */
	const faqs = [
		{
			q: 'Does it work with the model I already use?',
			a: 'Yes. Any endpoint that speaks the OpenAI API. OpenAI, Groq, OpenRouter, or Ollama on your own machine at localhost:11434/v1. It is a field in Settings, not a rebuild.'
		},
		{
			q: 'Is it actually free?',
			a: 'The app is free and you run it yourself. The voice costs nothing because it runs in your browser. You pay only for the AI endpoint you point it at, and that is $0 if you run a local model.'
		},
		{
			q: 'Will Google have to review my app?',
			a: 'No, as long as you are the only user. You create your own OAuth client and leave it in testing mode. Google verification only comes up when you open sign-in to the public, which is why this starts as a self-hosted app.'
		},
		{
			q: 'Can it send, delete or archive my mail?',
			a: 'No. It asks for one scope, gmail.readonly, and there is no code path that writes to Gmail. Categories, summaries and priorities live in this app’s own database, so your mailbox is left exactly as it was.'
		},
		{
			q: 'Where does my mail actually go?',
			a: 'Only the plain text of a message goes to the AI endpoint you configured. OAuth tokens and your API key are encrypted at rest. There is no telemetry and no third party in the loop.'
		},
		{
			q: 'What is the catch on the voice download?',
			a: 'Kitten, the default, is about 57MB the first time and then cached. Kokoro is the smoother one at about 90MB. If you would rather download nothing at all, switch to the system voice and it is instant.'
		},
		{
			q: 'Can it read something that is not an email?',
			a: 'Yes — open /read, paste anything (an article, a chapter, a PDF page) and press play. It runs entirely in your browser at 0.75× to 3× speed, with an optional auto-ramp that gets faster as you listen. Nothing is uploaded.'
		},
		{
			q: 'Outlook, Fastmail, plain IMAP?',
			a: 'Not in v1. The design does not rule it out, it just is not built yet. Gmail is the only provider wired up.'
		}
	];

	let open = $state<number | null>(0);

	function toggle(i: number) {
		open = open === i ? null : i;
	}
</script>

<div class="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-14">
	<div class="min-w-0">
		<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Before you commit</p>
		<h3 class="mt-3 font-heading text-title italic">The questions worth asking</h3>
		<p class="mt-3 text-sm leading-relaxed text-muted-foreground">
			If yours is not here, the source is the next best place to look. It is one repository, and the
			whole Gmail client is a single file.
		</p>
	</div>

	<div class="border-t">
		{#each faqs as faq, i (faq.q)}
			<div class="border-b">
				<h4>
					<button
						type="button"
						onclick={() => toggle(i)}
						aria-expanded={open === i}
						class="group flex w-full items-center justify-between gap-6 py-4 text-left"
					>
						<span
							class={cn(
								'text-sm font-medium motion-safe:transition-colors motion-safe:duration-200',
								open === i ? 'text-primary' : 'group-hover:text-primary'
							)}>{faq.q}</span
						>
						<ChevronDown
							class={cn(
								'size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-300',
								open === i && 'rotate-180'
							)}
						/>
					</button>
				</h4>
				<div
					class="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out"
					style="grid-template-rows: {open === i ? '1fr' : '0fr'}"
				>
					<div
						class={cn(
							'overflow-hidden motion-safe:transition-[visibility] motion-safe:duration-300',
							open === i ? 'visible' : 'invisible'
						)}
					>
						<p class="max-w-xl pb-5 text-sm leading-relaxed text-muted-foreground">{faq.a}</p>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>
