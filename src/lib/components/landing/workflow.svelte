<script lang="ts">
	import {
		AudioLines,
		Check,
		Cpu,
		MailOpen,
		ShieldCheck,
		Sparkles,
		WandSparkles
	} from '@lucide/svelte';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { linear } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { untrack } from 'svelte';
	import { cn } from '$lib/utils';

	/**
	 * One job walked through four steps, with the panel changing at each step.
	 * A grid of feature cards would say we have features; this says what using it is like.
	 */
	const steps = [
		{
			icon: ShieldCheck,
			title: 'Connect',
			body: 'One scope: gmail.readonly. Your own Google project in testing mode, so there is no verification review to wait on.'
		},
		{
			icon: MailOpen,
			title: 'Sync',
			body: 'Messages come in from the window you pick, get parsed down to plain text, and land in your own Postgres.'
		},
		{
			icon: WandSparkles,
			title: 'Organize',
			body: 'Your AI endpoint returns a category, a summary under 400 characters, a priority from 1 to 5, and any action items.'
		},
		{
			icon: AudioLines,
			title: 'Listen',
			body: 'The digest plays in order. The voice runs in the browser, so the text never leaves the device.'
		}
	];

	const AUTO_MS = 5200;
	const STEP_SHARE = 100 / steps.length;

	/** One tween drives the auto-advance across all four steps. */
	const auto = new Tween(0, { duration: steps.length * AUTO_MS });

	/** Set when the reader picks a step by hand, which stops the auto-advance. */
	let picked = $state<number | null>(null);

	const step = $derived(
		picked ?? Math.min(steps.length - 1, Math.floor((auto.current / 100) * steps.length))
	);
	const stepProgress = $derived(((auto.current % STEP_SHARE) / STEP_SHARE) * 100);
	const progress = $derived(((step + 1) / steps.length) * 100);
	const autoplaying = $derived(picked === null && !prefersReducedMotion.current);

	$effect(() => {
		if (prefersReducedMotion.current || picked !== null) {
			// Freeze any in-flight tween: the loop below only checks `alive` after
			// its await, so autoplay would otherwise keep stepping for up to 20.8s
			// after reduced motion is switched on mid-cycle.
			untrack(() => auto.set(0, { duration: 0 }));
			return;
		}

		return untrack(() => {
			let alive = true;
			void (async () => {
				while (alive) {
					await auto.set(0, { duration: 0 });
					if (!alive) return;
					await auto.set(100, { duration: steps.length * AUTO_MS, easing: linear });
				}
			})();
			return () => {
				alive = false;
			};
		});
	});

	function choose(i: number) {
		picked = i;
		auto.set(0, { duration: 0 });
	}
</script>

<div class="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
	<!-- Steps -->
	<div class="min-w-0">
		<p class="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
			Step {step + 1} of {steps.length}
		</p>
		<h3 class="mt-3 font-heading text-title italic">Four steps, then it runs itself</h3>

		<div class="mt-4 h-px w-full bg-border">
			<div
				class="h-px bg-primary motion-safe:transition-[width] motion-safe:duration-500"
				style="width: {progress}%"
			></div>
		</div>

		<ol class="mt-6 space-y-1">
			{#each steps as s, i (s.title)}
				<li>
					<button
						type="button"
						onclick={() => choose(i)}
						aria-current={i === step ? 'step' : undefined}
						class={cn(
							'group flex w-full items-start gap-3 px-3 py-3 text-left motion-safe:transition-colors motion-safe:duration-300',
							i === step ? 'bg-accent' : 'hover:bg-muted/60'
						)}
					>
						<span
							class={cn(
								'mt-0.5 grid size-7 shrink-0 place-items-center border motion-safe:transition-colors motion-safe:duration-300',
								i < step
									? 'border-primary bg-primary text-primary-foreground'
									: i === step
										? 'border-primary text-primary'
										: 'border-border text-muted-foreground'
							)}
						>
							{#if i < step}
								<Check class="size-3.5" />
							{:else}
								<s.icon class="size-3.5" />
							{/if}
						</span>
						<span class="min-w-0">
							<span class="flex items-center gap-2 text-sm font-medium">
								{s.title}
								{#if i === step && autoplaying}
									<span class="h-0.5 w-8 bg-border">
										<span class="block h-full bg-primary" style="width: {stepProgress}%"></span>
									</span>
								{/if}
							</span>
							<span class="mt-1 block text-sm leading-relaxed text-muted-foreground">
								{s.body}
							</span>
						</span>
					</button>
				</li>
			{/each}
		</ol>
	</div>

	<!-- Panel changes with the step -->
	<div class="min-w-0 border bg-card p-4 sm:p-6">
		{#key step}
			<div in:fly={{ y: prefersReducedMotion.current ? 0 : 12, duration: 350 }}>
				{#if step === 0}
					<div class="border p-5">
						<div class="flex items-center gap-2">
							<ShieldCheck class="size-4 text-primary" />
							<p class="text-sm font-medium">Kikitai wants access to your Google Account</p>
						</div>
						<ul class="mt-4 space-y-2 text-sm">
							<li class="flex items-start gap-2">
								<Check class="mt-0.5 size-3.5 shrink-0 text-primary" />
								Read your email messages
							</li>
							<li class="flex items-start gap-2 text-muted-foreground">
								<span class="mt-0.5 size-3.5 shrink-0 text-center text-xs">–</span>
								Send, delete, or change anything
							</li>
						</ul>
						<p class="mt-4 border-t pt-3 font-mono text-[11px] break-all text-muted-foreground">
							scope: https://www.googleapis.com/auth/gmail.readonly
						</p>
					</div>
				{:else if step === 1}
					<div class="space-y-2">
						{#each ['Invoice #2291 is due Friday', 'Pipeline #482 passed', 'Issue 91 is out'] as subject, i (subject)}
							<div class="flex items-center gap-3 border p-3" style="opacity: {1 - i * 0.22}">
								<span class="size-1.5 shrink-0 bg-primary"></span>
								<p class="min-w-0 flex-1 truncate text-sm">{subject}</p>
								<span class="shrink-0 font-mono text-[10px] text-muted-foreground">
									body → text
								</span>
							</div>
						{/each}
						<p class="pt-1 text-xs text-muted-foreground">
							HTML, quoted replies and tracking pixels are stripped. Only the words are kept.
						</p>
					</div>
				{:else if step === 2}
					<div>
						<div
							class="flex items-center gap-2 text-[11px] tracking-wider text-muted-foreground uppercase"
						>
							<Cpu class="size-3.5" />
							What your AI endpoint returns
						</div>
						<pre
							class="mt-3 overflow-x-auto border bg-muted/50 p-4 font-mono text-[11px] leading-relaxed"><code
								>{`{
  "category": "needs_reply",
  "summary": "Ada needs a reply. Invoice 2291 is
              due Friday and the link is attached.",
  "priority": 5,
  "actionItems": ["Reply to Ada", "Pay invoice 2291"]
}`}</code
							></pre>
						<p class="mt-3 text-xs text-muted-foreground">
							Validated against a schema before it is stored. One retry with the error fed back if
							the model wanders.
						</p>
					</div>
				{:else}
					<div>
						<div class="flex items-center justify-between border-b pb-3">
							<div class="flex items-center gap-2">
								<AudioLines class="size-4 text-primary" />
								<p class="text-sm font-medium">Morning digest</p>
							</div>
							<span class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
								<Sparkles class="size-3 text-primary" />
								on this device
							</span>
						</div>
						<p class="mt-4 text-sm leading-relaxed">
							<span class="bg-signal/20">Ada needs a reply.</span> Invoice 2291 is due Friday and the
							payment link is attached.
						</p>
						<div class="mt-4 flex items-center gap-3">
							<div class="h-1 flex-1 bg-border">
								<div class="h-full w-2/5 bg-primary"></div>
							</div>
							<span class="text-[11px] text-muted-foreground tabular-nums">0:14 / 0:41</span>
						</div>
						<p class="mt-4 border-t pt-3 text-xs text-muted-foreground">
							Kitten, the default voice, is a one time download of about 57MB. Kokoro is the bigger,
							smoother one at about 90MB.
						</p>
					</div>
				{/if}
			</div>
		{/key}
	</div>
</div>
