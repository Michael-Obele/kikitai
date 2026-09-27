<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	/**
	 * Fades and lifts its children in the first time they scroll into view.
	 * Reduced motion gets the final state immediately, with no transform.
	 */
	let {
		delay = 0,
		class: className,
		children
	}: { delay?: number; class?: string; children: Snippet } = $props();

	let el: HTMLElement | null = $state(null);
	let shown = $state(false);

	const visible = $derived(shown || prefersReducedMotion.current);

	/** True when the node is already on screen, so we need not wait for an observer. */
	function onScreen(node: HTMLElement) {
		const rect = node.getBoundingClientRect();
		return rect.top < window.innerHeight && rect.bottom > 0;
	}

	$effect(() => {
		const node = el;
		if (!node || prefersReducedMotion.current) return;

		// Above the fold: play the entrance on the next tick. setTimeout, not rAF,
		// because requestAnimationFrame does not run in a hidden tab and content
		// must not stay invisible there either.
		if (onScreen(node)) {
			const timer = setTimeout(() => (shown = true), 0);
			return () => clearTimeout(timer);
		}

		let reported = false;

		const io = new IntersectionObserver(
			(entries) => {
				reported = true;
				if (entries[0]?.isIntersecting) {
					shown = true;
					io.disconnect();
				}
			},
			{ rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
		);
		io.observe(node);

		// An observer always reports once, even for off-screen targets. Silence means
		// it is not running (hidden or throttled page), so reveal anyway rather than
		// leaving the content stranded invisible.
		const failsafe = setTimeout(() => {
			if (!reported) shown = true;
		}, 1200);

		return () => {
			io.disconnect();
			clearTimeout(failsafe);
		};
	});
</script>

<div
	bind:this={el}
	style="transition-delay: {delay}ms"
	class={cn(
		'landing-reveal motion-safe:transition-[opacity,transform] motion-safe:duration-700 motion-safe:ease-out',
		visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
		className
	)}
>
	{@render children()}
</div>
