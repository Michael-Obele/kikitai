import { expect, test } from '@playwright/test';
import { PROBE_MESSAGE_ID, resetProbeSettings } from './db';
import { closeContext, newPage, toasts, watchConsole } from './harness';
import { statsOf, waitForStats } from './reader';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/** The bar lives at the end of `(app)`'s `<main>` — see `src/routes/(app)/+layout.svelte`. */
const BAR = 'div.sticky.bottom-0';

/**
 * Stream 3's whole point: audio is a session, not a component. Play on a source
 * route, follow a link (client-side, so the store survives) to a page with no
 * reader on it, and the compact bar must take over — then coming back must hand
 * control to the full reader and tuck the bar away, with one transport only.
 */
test('playback survives a route change and the global bar takes over', async () => {
	const since = Date.now();
	const page = await newPage();
	const logs = watchConsole(page);

	await page.goto(`/inbox/${PROBE_MESSAGE_ID}`);
	const play = page.getByRole('button', { name: 'Play', exact: true });
	await expect(play).toBeVisible({ timeout: 60_000 });

	// The full reader owns the transport while it is on screen — no bar yet.
	await expect(page.locator(BAR)).toHaveCount(0);

	await play.click();
	try {
		await waitForStats(page, since, 'chunk', 2, 60_000);
	} catch {
		// Say what the transport was doing instead of timing out silently.
		const label = await page
			.locator('button[aria-label="Pause"], button[aria-label="Play"]')
			.first()
			.getAttribute('aria-label')
			.catch(() => 'gone');
		const seen = (await statsOf(page, since, 'chunk')).length;
		throw new Error(
			`no chunks on /inbox — transport says ${label}, chunks=${seen}\n` +
				`tts: ${JSON.stringify(logs.filter((l) => l.includes('[tts]')).slice(-8))}\n` +
				`toasts: ${JSON.stringify(await toasts(page))}`
		);
	}

	// --- leave the source route (client-side navigation keeps the session) ----
	// The sidebar's link *to* `/dashboard` is titled "Inbox" (see app-sidebar).
	await page.getByRole('link', { name: 'Inbox', exact: true }).click();
	await page.waitForURL('**/dashboard');

	// The bar takes over: transport still shows "playing" and reports progress.
	await expect(page.locator(BAR)).toBeVisible({ timeout: 30_000 });
	await expect(page.locator(`${BAR} button[aria-label="Pause"]`)).toBeVisible();
	await expect(page.locator(BAR)).toContainText(/\d+\/\d+/);

	// Audio really continued. Chunk stats are only persisted while a telemetry
	// card is mounted (it is the `onTtsStat` → localStorage writer), and the
	// dashboard has none — so ask the bar itself: its position must advance.
	const readPosition = async () =>
		(await page.locator(BAR).innerText()).match(/\d+\/\d+/)?.[0] ?? '';
	const position = await readPosition();
	expect(position, 'the bar must report a position').not.toBe('');
	await expect.poll(readPosition, { timeout: 90_000, intervals: [2_000] }).not.toBe(position);

	// --- come back: the panel re-attaches and the bar steps aside -------------
	await page.goBack();
	// The message is back (its panel hosts a compact player — no sentence spans)…
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
	// … with exactly one transport on the page: the bar must not duplicate it.
	await expect(page.locator('button[aria-label="Pause"], button[aria-label="Play"]')).toHaveCount(
		1,
		{ timeout: 30_000 }
	);
	await expect(page.locator(BAR)).toHaveCount(0, { timeout: 30_000 });

	await page.close();
});
