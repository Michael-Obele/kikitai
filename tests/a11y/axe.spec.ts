import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PROBE_MESSAGE_ID, resetProbeSettings } from '../guardrails/db';
import { closeContext, newPage } from '../guardrails/harness';
import { openReader, paste, playButton } from '../guardrails/reader';

test.beforeAll(async () => {
	await resetProbeSettings();
});
test.afterAll(closeContext);

/** WCAG 2.x A + AA — the standard the audit grades against. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Serious and critical axe findings fail the gate; minor ones stay visible in
 * the report but do not block. Automated checks catch the mechanical half of
 * WCAG (names, roles, contrast) — the keyboard probe next door covers the rest.
 */
async function expectNoBlockingViolations(page: Page, label: string) {
	const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
	const blocking = violations.filter(
		(violation) => violation.impact === 'serious' || violation.impact === 'critical'
	);
	expect(
		blocking.map(
			(violation) =>
				`${violation.id} (${violation.impact}): ${violation.help} — ` +
				violation.nodes.map((node) => node.target.join(' ')).join(' | ')
		),
		`${label}: serious/critical WCAG violations`
	).toEqual([]);
}

test('/read with the player on screen has no serious violations', async () => {
	const page = await newPage();
	await openReader(page);
	await paste(page);
	await expect(playButton(page)).toBeVisible();

	await expectNoBlockingViolations(page, '/read');
	await page.close();
});

test('a signed-in message with the player on screen has no serious violations', async () => {
	const page = await newPage();
	await page.goto(`/inbox/${PROBE_MESSAGE_ID}`);
	await expect(playButton(page)).toBeVisible({ timeout: 60_000 });

	await expectNoBlockingViolations(page, '/inbox/[id]');
	await page.close();
});
