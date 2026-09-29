import { expect, test, type Page } from '@playwright/test';
import { closeContext, newPage } from '../guardrails/harness';
import { openReader, paste, playButton } from '../guardrails/reader';

test.afterAll(closeContext);

/** Controls a keyboard-only reader must be able to reach by Tab (WCAG 2.1.1). */
const REQUIRED_CONTROLS = [
	'Play',
	'Previous sentence',
	'Next sentence',
	'Back 15 seconds',
	'Forward 30 seconds',
	'Keyboard shortcuts'
];

type Focus = { label: string; isChunk: boolean; hasFocusRing: boolean };

/** What currently has focus, and whether a keyboard user can see it (2.4.7). */
function focused(page: Page) {
	return page.evaluate(() => {
		const el = document.activeElement as HTMLElement | null;
		if (!el || el === document.body) return null;
		const style = getComputedStyle(el);
		const ring =
			(style.boxShadow !== 'none' && style.boxShadow !== '') ||
			(style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth || '0') > 0);
		return {
			label: el.getAttribute('aria-label') ?? '',
			isChunk: el.hasAttribute('data-chunk'),
			hasFocusRing: ring
		} satisfies Focus;
	});
}

test('the player is reachable, operable and visible to the keyboard alone', async () => {
	const page = await newPage();
	await openReader(page);
	await paste(page);
	await expect(playButton(page)).toBeVisible();

	// --- 1. Tab reaches every control, and focus is visible while it does ----
	const labels = new Set<string>();
	let chunkFocus: Focus | null = null;
	let playFocus: Focus | null = null;

	for (let step = 0; step < 80; step++) {
		if (REQUIRED_CONTROLS.every((label) => labels.has(label)) && chunkFocus && playFocus) break;
		await page.keyboard.press('Tab');
		const focus = await focused(page);
		if (!focus) continue;
		if (focus.label) labels.add(focus.label);
		if (focus.isChunk && !chunkFocus) chunkFocus = focus;
		if (focus.label === 'Play') playFocus = focus;
	}

	for (const label of REQUIRED_CONTROLS) {
		expect(labels, `no Tab path to "${label}"`).toContain(label);
	}
	expect(chunkFocus, 'the sentence chunks must be tabbable (tabindex="0")').not.toBeNull();
	expect(chunkFocus!.hasFocusRing, 'focused chunk must show a focus ring').toBe(true);
	expect(playFocus!.hasFocusRing, 'focused Play button must show a focus ring').toBe(true);

	// --- 2. A chunk is operable: Enter speaks, K pauses (WCAG 2.1.1) --------
	// Walk on until a sentence chunk has focus (Tab wraps, so bound the search).
	let onChunk = false;
	for (let step = 0; step < 80 && !onChunk; step++) {
		await page.keyboard.press('Tab');
		onChunk = await page.evaluate(
			() => document.activeElement?.hasAttribute('data-chunk') ?? false
		);
	}
	expect(onChunk, 'no Tab path to a sentence chunk').toBe(true);
	await page.keyboard.press('Enter');
	await expect(playButton(page)).toHaveAttribute('aria-label', 'Pause', { timeout: 30_000 });
	await page.keyboard.press('k');
	await expect(playButton(page)).toHaveAttribute('aria-label', 'Play', { timeout: 10_000 });

	// --- 3. `?` opens the shortcut help, Esc closes it ----------------------
	await page.keyboard.press('?');
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Keyboard shortcuts');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	await page.close();
});
