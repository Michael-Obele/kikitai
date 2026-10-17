import { expect, test } from '@playwright/test';
import { resetProbeSettings } from './db';
import { closeContext, newPage } from './harness';
import { PASTE_TEXT, openReader, paste, playButton, waitForStats } from './reader';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/** The lit word: `WordLine` marks the current word with `bg-primary/30`. */
const LIT_WORD = 'span.bg-primary\\/30';

/** Index of the lit word inside its line, or null when nothing is lit. */
function litWordIndex(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const lit = document.querySelector('span[class*="bg-primary/30"]');
		const parent = lit?.parentElement;
		if (!lit || !parent) return null;
		return [...parent.children].indexOf(lit);
	});
}

/**
 * Word-level resume (plan stream 4): stop in the middle of a sentence, come
 * back, and playback must continue at *that word* — not at the start of the
 * chunk. The storage contract is asserted too: `{ chunk, word, charOffset }`
 * with the old plain-number shape still readable (the store upgrades it).
 */
test('stopping mid-sentence resumes at that word after a reload', async () => {
	const since = Date.now();
	const page = await newPage();
	await openReader(page);
	await paste(page);
	await waitForStats(page, since, 'gen', 3);

	// --- listen until the highlight is clearly inside the first chunk --------
	await playButton(page).click();
	await page.waitForFunction(
		() => {
			const lit = document.querySelector('span[class*="bg-primary/30"]');
			const parent = lit?.parentElement;
			if (!lit || !parent) return false;
			return [...parent.children].indexOf(lit) >= 5;
		},
		undefined,
		{ timeout: 90_000, polling: 250 }
	);
	await page.locator('button[aria-label="Stop"]').click();

	// --- the stored point carries the word, not just the chunk ---------------
	const saved = await page.evaluate(() => {
		const raw = localStorage.getItem('kikitai.player.resume');
		return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
	});
	expect(saved, 'Stop must persist a resume point').not.toBeNull();
	const point = saved?.['paste'] as { chunk: number; word: number; charOffset: number } | undefined;
	expect(point, 'the pasted item must have a point').toBeTruthy();
	expect(typeof point!.chunk).toBe('number');
	expect(point!.word, 'we were mid-sentence').toBeGreaterThanOrEqual(5);
	expect(point!.charOffset, 'the point names a character, not only a word').toBeGreaterThan(0);

	// --- reload: the same point must survive and be applied -----------------
	// The harness clears resume on every navigation *unless* this tab opted in.
	await page.evaluate(() => sessionStorage.setItem('kikitai.keep-resume', '1'));
	await page.reload();
	// Pasted text may or may not come back with the snapshot — put it back; the
	// fresh store restores the point as soon as the item exists again.
	await page.locator('#pasteText').fill(PASTE_TEXT);
	await expect(playButton(page)).toBeEnabled({ timeout: 60_000 });
	await playButton(page).click();

	// --- and playback starts at (or a hair past) the saved word -------------
	const resumed = await page.waitForFunction(
		() => {
			const lit = document.querySelector('span[class*="bg-primary/30"]');
			const parent = lit?.parentElement;
			if (!lit || !parent) return null;
			return [...parent.children].indexOf(lit);
		},
		undefined,
		{ timeout: 60_000, polling: 'raf' }
	);
	const word = (await resumed.jsonValue()) as number;
	expect(word, 'resume must not restart the chunk').toBeGreaterThanOrEqual(point!.word - 1);
	expect(word, 'resume must not skip ahead').toBeLessThanOrEqual(point!.word + 3);

	await page.close();
});
