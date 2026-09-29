import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage, toasts, watchConsole, watchIsolation } from './harness';
import { openReader, pageNow, paste, playButton, statsSince, waitForStats } from './reader';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

type LongTask = { startTime: number; duration: number };

/**
 * Budgets for the three phases of a listen, measured with
 * `PerformanceObserver('longtask')` — the main thread is the only place a
 * stutter can be born, and every one of these is a pause the reader hears:
 *
 * - **warm**: paste → opener generated. The model is fetched and parsed in a
 *   worker, so anything big here means ONNX crept back onto the main thread
 *   (the audit measured 9 678 ms before the worker fix). The model itself is
 *   loaded *before* this window opens — a one-off load belongs to "load", not
 *   to generation.
 * - **play**: while audio runs. Steady state must stay effectively idle.
 * - **load**: page hydration plus the model load — reported for context, not
 *   budgeted: the dev server's module graph and a 57MB model fetch have nothing
 *   to do with playback.
 */
const WARM_BUDGET_MS = 150;
const PLAY_BUDGET_MS = 150;

test('main thread never blocks through paste, warm-up and playback', async () => {
	const since = Date.now();
	const page = await newPage();
	const failures = watchIsolation(page);
	const logs = watchConsole(page);

	await page.addInitScript(() => {
		const target = globalThis as unknown as { __longTasks?: LongTask[] };
		target.__longTasks = [];
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					target.__longTasks?.push({ startTime: entry.startTime, duration: entry.duration });
				}
			}).observe({ entryTypes: ['longtask'] });
		} catch {
			/* longtask is a Chromium entry type; these probes run in Chromium */
		}
	});

	await openReader(page);
	// Let the model finish loading first: its one-off work is a property of the
	// model, not of generation, and mixing it in would make this budget lie.
	await waitForStats(page, since, 'load', 1, 90_000).catch(() => {
		/* no load stat (cache miss on the CDN) — the budget below still applies */
	});
	const pastedAt = await pageNow(page);
	await paste(page);
	await waitForStats(page, since, 'gen', 3);
	const warmedAt = await pageNow(page);

	await playButton(page).click();
	try {
		await waitForStats(page, since, 'chunk', 4, 120_000);
	} catch {
		// Say what the page was doing instead of timing out silently.
		const state = await page.evaluate(() => {
			const field = document.getElementById('pasteText');
			const stop = document.querySelector('button[aria-label="Stop"]');
			const progress = document.querySelector('p.tracking-widest')?.textContent ?? null;
			return {
				url: location.href,
				toasts: (globalThis as { __toasts?: string[] }).__toasts ?? [],
				pasted: field instanceof HTMLTextAreaElement ? field.value.length : -1,
				chunks: document.querySelectorAll('[data-chunk]').length,
				stopButton: Boolean(stop),
				progress,
				uptimeMs: Math.round(performance.now()),
				navigations: performance.getEntriesByType('navigation').length
			};
		});
		const label = await playButton(page)
			.getAttribute('aria-label')
			.catch(() => 'gone');
		const disabled = await playButton(page)
			.isDisabled()
			.catch(() => null);
		const seen = (await statsSince(page, since)).map((stat) => `${stat.kind}@${stat.at}`);
		throw new Error(
			`playback stopped early — aria-label=${label} disabled=${disabled} stats=[${seen.join(', ')}]\n` +
				`page=${JSON.stringify(state)}\nconsole=${JSON.stringify(logs.slice(-15))}`
		);
	}

	const tasks = await page.evaluate(
		() => (globalThis as { __longTasks?: LongTask[] }).__longTasks ?? []
	);
	const phases = {
		load: tasks.filter((task) => task.startTime < pastedAt),
		warm: tasks.filter((task) => task.startTime >= pastedAt && task.startTime < warmedAt),
		play: tasks.filter((task) => task.startTime >= warmedAt)
	};
	const max = (entries: LongTask[]) => Math.max(0, ...entries.map((entry) => entry.duration));

	console.log(
		`[guardrail] long tasks · load ${phases.load.length}× (max ${max(phases.load)}ms) · ` +
			`warm ${phases.warm.length}× (max ${max(phases.warm)}ms) · ` +
			`play ${phases.play.length}× (max ${max(phases.play)}ms)`
	);

	expect(failures).toEqual([]);
	expect(max(phases.warm), 'long task between paste and the warm bank').toBeLessThanOrEqual(
		WARM_BUDGET_MS
	);
	expect(max(phases.play), 'long task while playing').toBeLessThanOrEqual(PLAY_BUDGET_MS);

	await page.close();
});
