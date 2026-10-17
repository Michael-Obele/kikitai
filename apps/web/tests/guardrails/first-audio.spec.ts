import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage, watchConsole, watchIsolation } from './harness';
import { openReader, paste, playButton, statsOf, statsSince, waitForStats } from './reader';

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
	// The [tts] sequence shows whether the warm bank was actually consumed:
	// a `gen` logged *after* the press means chunk 0 was regenerated at Play time.
	const logs = watchConsole(page);
	/** Press time, hoisted so the finally block can build a timeline from it. */
	let pressedAt = 0;

	try {
		await openReader(page);
		await paste(page);
		// The warm bank generates the first three chunks once the text sits still.
		await waitForStats(page, since, 'gen', 3);

		await playButton(page).click();
		pressedAt = Date.now();
		await waitForStats(page, since, 'first', 1, 60_000);

		const [first] = await statsOf(page, since, 'first');
		expect(first).toBeDefined();
		console.log(`[guardrail] first audio ${Math.round(first!.ms)}ms after Play`);
		expect(first!.ms).toBeLessThan(1000);
		expect(failures).toEqual([]);
	} finally {
		console.log(logs.filter((line) => line.includes('[tts]')).join('\n'));
		// Press-relative timeline: shows exactly where the seconds go.
		const stats = await statsSince(page, since);
		console.log(
			`[guardrail] timeline: ${stats
				.sort((a, b) => a.at - b.at)
				.map((stat) => `${stat.kind}+${stat.at - pressedAt}ms`)
				.join(' ')}`
		);
	}

	await page.close();
});
