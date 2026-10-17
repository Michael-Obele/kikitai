import { onCLS, onINP, onLCP } from 'web-vitals';

/**
 * The page's own field numbers, measured on the device that is reading.
 *
 * CLS / LCP / INP are page-lifetime metrics, so they live in memory only: a
 * reload starts a fresh measurement instead of showing yesterday's. INP is a
 * p75 by definition — the number web.dev budgets at 200ms, and the only one
 * that moves when an interaction feels sticky.
 */
export type VitalsSnapshot = {
	/** Interaction Next Paint, p75 — good ≤ 200ms, poor > 500ms. */
	inp: number | null;
	cls: number | null;
	lcp: number | null;
	/**
	 * Longest main-thread stall this page load. The worker guardrail in one
	 * number: generation used to block for seconds, now it must not block at all.
	 */
	maxLongTask: number;
};

/** The INP budget — 200ms is web.dev's line between "good" and "needs work". */
export const INP_BUDGET_MS = 200;

/** Shared across every mount, so two cards on one page observe once. */
export const vitals = $state<VitalsSnapshot>({ inp: null, cls: null, lcp: null, maxLongTask: 0 });

let started = false;

/** Install the observers once, on the client. Safe to call from any component. */
export function startVitals(): void {
	if (started || typeof window === 'undefined') return;
	started = true;

	onINP(
		(metric) => {
			vitals.inp = metric.value;
		},
		// Report as it moves, so the card shows a number before the reader leaves.
		{ reportAllChanges: true }
	);
	onCLS(
		(metric) => {
			vitals.cls = metric.value;
		},
		{ reportAllChanges: true }
	);
	onLCP(
		(metric) => {
			vitals.lcp = metric.value;
		},
		{ reportAllChanges: true }
	);

	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				vitals.maxLongTask = Math.max(vitals.maxLongTask, entry.duration);
			}
		}).observe({ entryTypes: ['longtask'] });
	} catch {
		/* `longtask` is a Chromium entry type — other engines simply report 0 */
	}
}
