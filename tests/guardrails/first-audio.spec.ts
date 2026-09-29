import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage, watchIsolation } from './harness';
import { openReader, paste, playButton, statsOf, waitForStats } from './reader';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/**
 * First audio after pressing Play, with the warm bank already filled.
 *
 * Budget: 1000 ms. The measured number is ~5 ms — this is an alarm for the
 * regression where the first chunk paid for a model load on the Play path
 * (4.1 s with Kitten) or waited on a suspended AudioContext forever.
 */
test('first audio arrives within 1s of Play', async () => {
	const since = Date.now();
	const page = await newPage();
	const failures = watchIsolation(page);

	await openReader(page);
	await paste(page);
	// The warm bank generates the first three chunks once the text sits still.
	await waitForStats(page, since, 'gen', 3);

	await playButton(page).click();
	await waitForStats(page, since, 'first', 1, 60_000);

	const [first] = await statsOf(page, since, 'first');
	expect(first).toBeDefined();
	console.log(`[guardrail] first audio ${Math.round(first!.ms)}ms after Play`);
	expect(first!.ms).toBeLessThan(1000);
	expect(failures).toEqual([]);

	await page.close();
});
