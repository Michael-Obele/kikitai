import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage, toasts, watchConsole } from './harness';
import { openReader, paste, playButton, statsOf, waitForStats } from './reader';

/** Four chunks give three hand-overs to judge — and keep the collection window
 *  well inside the test budget when the machine is busy (six chunks timed out
 *  once in a full-suite run; alone the same test takes ~45s). */
const REQUIRED_CHUNKS = 4;

/**
 * Collection waits on the *model*, not on playback: when the browser's cache is
 * cold the voice model is fetched first, and that is the network's speed, not
 * the app's. The budget that actually guards the product is the hand-over gap
 * below — these only decide how long we are willing to wait for audio to exist.
 */
const COLLECTION_MS = 300_000;
/** The listener hears a gap here; the lookahead queue is supposed to erase it. */
const GAP_BUDGET_MS = 300;

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/**
 * Consecutive chunks must hand over without a hole. Each `chunk` stat is
 * recorded when its audio *ends* (`at`) together with how long it spoke (`ms`),
 * so chunk i started at `at_i - ms_i` and the silence before chunk i+1 is
 * `(at_{i+1} - ms_{i+1}) - at_i`.
 */
test('playback hands over between chunks with no gap over 300ms', async () => {
	// The waits below can legitimately take minutes on a cold model cache.
	test.setTimeout(COLLECTION_MS + 180_000);
	const since = Date.now();
	const page = await newPage();
	const logs = watchConsole(page);

	/** What the page was actually doing — used by both failure paths. */
	const dump = async (stage: string): Promise<never> => {
		const state = await page
			.evaluate(() => {
				const field = document.getElementById('pasteText');
				const play = document.querySelector(
					'button[aria-label="Play"], button[aria-label="Pause"]'
				);
				return {
					text: field instanceof HTMLTextAreaElement ? field.value.length : -1,
					chunks: document.querySelectorAll('[data-chunk]').length,
					transport: play?.getAttribute('aria-label') ?? 'none',
					engine: document.querySelector('#read-engine')?.textContent?.trim() ?? 'n/a'
				};
			})
			.catch(() => ({ text: -1, chunks: -1, transport: 'page gone', engine: 'n/a' }));
		const seen = (await statsOf(page, since, 'chunk').catch(() => []))?.length ?? 0;
		const gens = (await statsOf(page, since, 'gen').catch(() => []))?.length ?? 0;
		throw new Error(
			`[${stage}] text=${state.text} chunks=${state.chunks} transport=${state.transport} ` +
				`engine=${state.engine} gens=${gens} chunks=${seen}\n` +
				`tts: ${JSON.stringify(logs.filter((l) => l.includes('[tts]')).slice(-10))}\n` +
				`console: ${JSON.stringify(logs.slice(-10))}\n` +
				`toasts: ${JSON.stringify(await toasts(page).catch(() => []))}`
		);
	};

	await openReader(page);
	await paste(page);
	try {
		await waitForStats(page, since, 'gen', 3, COLLECTION_MS);
	} catch {
		await dump('warm bank produced no generations');
	}
	const pressedAt = Date.now();
	await playButton(page).click();
	try {
		await waitForStats(page, since, 'chunk', REQUIRED_CHUNKS, COLLECTION_MS);
	} catch {
		await dump(`only chunks in ${Date.now() - pressedAt}ms`);
	}

	const chunks = (await statsOf(page, since, 'chunk')).slice(0, REQUIRED_CHUNKS);
	expect(chunks.length).toBe(REQUIRED_CHUNKS);

	const gaps: number[] = [];
	for (let i = 1; i < chunks.length; i++) {
		const previous = chunks[i - 1]!;
		const current = chunks[i]!;
		gaps.push(current.at - current.ms - previous.at);
	}
	console.log(`[guardrail] chunk gaps: ${gaps.map((gap) => `${gap}ms`).join(' ')}`);

	expect(Math.max(...gaps), 'worst hand-over gap while playing').toBeLessThanOrEqual(GAP_BUDGET_MS);

	// Stop before closing, so teardown never races an in-flight generation.
	await page
		.getByRole('button', { name: 'Stop' })
		.click({ timeout: 5_000 })
		.catch(() => {});
	await page.close();
});
