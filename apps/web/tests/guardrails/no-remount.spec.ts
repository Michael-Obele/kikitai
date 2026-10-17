import { expect, test } from '@playwright/test';
import { PROBE_MESSAGE_ID, resetProbeSettings, setProbeSpeed } from './db';
import { closeContext, newPage } from './harness';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/**
 * The regression the audit proved with a controlled tag test: a speed, voice or
 * engine save refreshes `getSettings()`, and a host that re-runs
 * `{#await settings then cfg}` destroys MessagePanel + Player mid-playback.
 *
 * Two nodes are tagged — one in MessagePanel (the voice picker), one inside
 * Player (the Play button) — so a remount of either scope loses the uuid.
 */
test('speed, voice and engine changes never remount the player panel', async () => {
	const page = await newPage();
	await page.goto(`/inbox/${PROBE_MESSAGE_ID}`);

	const play = page.getByRole('button', { name: 'Play', exact: true });
	const speedTrigger = page.locator('button[aria-label^="Playback speed"]');
	await expect(play).toBeVisible({ timeout: 60_000 });
	await expect(speedTrigger).toBeVisible();

	const uuid = await page.evaluate(() => {
		const id = crypto.randomUUID();
		// MessagePanel's voice-picker wrapper …
		document.getElementById('msg-engine')?.parentElement?.setAttribute('data-guard', id);
		// … and the transport inside Player.
		document.querySelector('button[aria-label="Play"]')?.setAttribute('data-guard', id);
		return id;
	});

	/** Both tags still present, both still the uuid we set. */
	async function expectUntouched(step: string) {
		const tagged = await page.evaluate(() =>
			[...document.querySelectorAll('[data-guard]')].map((node) => node.getAttribute('data-guard'))
		);
		expect(tagged, `tags lost after ${step} — the panel remounted`).toHaveLength(2);
		expect(
			tagged.every((value) => value === uuid),
			`tag replaced after ${step}`
		).toBe(true);
	}

	// Step 1 — voice. The speed below is written straight to the database behind
	// the client's back: the label can only show it if the refresh that follows
	// the voice save really landed, which is what makes the survival meaningful.
	await setProbeSpeed(0.75);
	await page.click('#msg-voice');
	await page.getByRole('option', { name: 'Bella', exact: true }).click();
	await expect(speedTrigger).toHaveAttribute('aria-label', 'Playback speed 0.75×');
	await expectUntouched('the voice change');

	// Step 2 — speed, through the menu the reader actually uses.
	await page.click('button[aria-label^="Playback speed"]');
	await page.getByRole('menuitem', { name: '1.5×' }).click();
	await expect(speedTrigger).toHaveAttribute('aria-label', 'Playback speed 1.5×');
	await expectUntouched('the speed change');

	// Step 3 — engine (Web Speech has no voice list, so the picker re-renders too).
	await page.click('#msg-engine');
	await page.getByRole('option', { name: 'Web Speech', exact: true }).click();
	await expect(page.locator('#msg-engine')).toContainText('Web Speech');
	await expectUntouched('the engine change');

	await page.close();
});
