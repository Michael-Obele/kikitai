import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage } from './harness';
import { openReader, paste, playButton, statsOf, waitForStats } from './reader';

const REQUIRED_CHUNKS = 6;
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
	const since = Date.now();
	const page = await newPage();

	await openReader(page);
	await paste(page);
	await waitForStats(page, since, 'gen', 3);
	await playButton(page).click();
	await waitForStats(page, since, 'chunk', REQUIRED_CHUNKS, 240_000);

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
