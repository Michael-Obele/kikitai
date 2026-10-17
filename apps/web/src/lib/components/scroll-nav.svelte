<script lang="ts">
	import { ArrowDownToLine, ArrowUpToLine } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils.js';

	let { class: className = '' }: { class?: string } = $props();

	/** Where the page is, how far it goes, and what the bottom edge already gives away. */
	let y = $state(0);
	let limit = $state(0);
	let pinned = $state(0);

	/**
	 * A phone screen's third of travel. Shorter than that and the top is still a
	 * flick away, so the pill would be chrome for nothing.
	 */
	const REVEAL_AT = 320;
	/** Browsers round scroll positions; "at the end" needs a couple of pixels of slack. */
	const GLIDE = 4;

	const revealed = $derived(y > REVEAL_AT);
	const atTop = $derived(y <= GLIDE);
	const atEnd = $derived(limit - y <= GLIDE);

	/**
	 * Everything the pill needs in one pass: where the page is, how far it goes, and
	 * what the bottom edge already gives away. Read straight from the event, never on
	 * a frame — a hidden or backgrounded view suspends `requestAnimationFrame`, and a
	 * pill that quietly stops tracking the page looks broken (the same lesson
	 * `landing/reveal.svelte` learned). A browser already coalesces scroll events to
	 * about one a frame, so this reads once a frame anyway.
	 */
	function read() {
		y = Math.round(window.scrollY);
		limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
		pinned = pinnedChrome();
	}

	/**
	 * Height of whatever is holding the bottom of the viewport, 0 when nothing is.
	 * A bar that sticks to `bottom: 0` marks itself `data-bottom-chrome` — the
	 * reader's transport, the app's player — and the pill rides above it rather than
	 * landing on a control. A bar that has scrolled back into its own row at the end
	 * of the page is not pinned, so it is skipped and the pill drops to its resting
	 * place.
	 */
	function pinnedChrome(): number {
		let taken = 0;
		for (const bar of document.querySelectorAll('[data-bottom-chrome]')) {
			const box = bar.getBoundingClientRect();
			if (box.bottom < window.innerHeight - 1) continue;
			taken = Math.max(taken, window.innerHeight - box.top);
		}
		return Math.max(0, Math.round(taken));
	}

	onMount(() => {
		read();
		window.addEventListener('scroll', read, { passive: true });
		window.addEventListener('resize', read);
		/*
			The page grows without a scroll event — a list refills, a dialog opens, the
			reader paints a pasted article — and both `limit` and `pinned` have to grow
			with it.
		*/
		const page = new ResizeObserver(read);
		page.observe(document.body);
		return () => {
			window.removeEventListener('scroll', read);
			window.removeEventListener('resize', read);
			page.disconnect();
		};
	});

	/** Smooth where motion is welcome, instant where it is not. */
	function jump(to: number) {
		window.scrollTo({ top: to, behavior: prefersReducedMotion.current ? 'auto' : 'smooth' });
	}
</script>

<!--
	Both ends, always: the one you cannot use is disabled rather than dropped, so the
	pill never changes size under the pointer. Native buttons, so Tab reaches them and
	Enter or Space works — no key binding, because `Home` already restarts the reader's
	current item and stealing it here would be a lie.

	It arrives on a CSS animation, not a Svelte transition: a transition's frames come
	from rAF, so a backgrounded view would leave the pill either invisible at opacity 0
	or stuck in the DOM after it should have gone. Gone is instant, and the entrance
	runs on the compositor. `motion-safe:` keeps it still where motion is unwelcome.
-->
{#if revealed}
	<div
		class={cn(
			'fixed right-4 z-40 flex flex-col gap-2 motion-safe:animate-in motion-safe:duration-150 motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 print:hidden',
			className
		)}
		style:bottom="calc({pinned + 16}px + env(safe-area-inset-bottom, 0px))"
	>
		<Button
			variant="ghost"
			size="icon"
			class="size-11 rounded-full bg-popover shadow-lg ring-1 ring-foreground/5"
			aria-label="Scroll to top"
			title="Scroll to top"
			disabled={atTop}
			onclick={() => jump(0)}
		>
			<ArrowUpToLine class="size-5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="size-11 rounded-full bg-popover shadow-lg ring-1 ring-foreground/5"
			aria-label="Scroll to bottom"
			title="Scroll to bottom"
			disabled={atEnd}
			onclick={() => jump(limit)}
		>
			<ArrowDownToLine class="size-5" />
		</Button>
	</div>
{/if}
