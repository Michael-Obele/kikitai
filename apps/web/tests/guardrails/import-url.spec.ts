import { expect, test } from '@playwright/test';
import { closeContext, newPage } from './harness';

test.afterAll(closeContext);

/**
 * Stream 3c's acceptance. The import was verified through SSR markup and curl —
 * neither of which can click the control — so this covers what they cannot: the
 * click path, a refusal landing inline instead of on the error page, and Undo
 * putting the reader back exactly as it was.
 */
test('import from URL fills the reader, refuses inline, and can be undone', async () => {
	const page = await newPage();
	await page.goto('/read');

	const box = page.locator('#pasteText');
	const urlField = page.locator('#importUrlInput');
	const submit = page.getByRole('button', { name: /^Import/ });

	// Typed text first, so a refusal can be shown not to touch it.
	await box.fill('Hand typed before the import.');
	// Hydration signal: SSR renders the transport disabled (no items yet), so it
	// only becomes clickable once the client has taken over — clicking the import
	// form before that submits natively and navigates, which is exactly the path
	// this probe is here not to take.
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeEnabled({
		timeout: 60_000
	});
	await expect(box).not.toBeDisabled();

	// --- a refused target fails inline, on this page ---------------------------
	await urlField.fill('http://127.0.0.1/'); // loopback — the SSRF guard says no
	await submit.click();

	await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/\/read$/);
	await expect(box).toHaveValue('Hand typed before the import.');

	// --- the happy path fills the reader --------------------------------------
	await urlField.fill('https://example.com');
	await submit.click();

	await expect(page.getByText(/Imported “.+”/)).toBeVisible({ timeout: 60_000 });
	const imported = await box.inputValue();
	expect(imported.length).toBeGreaterThan(20);
	// example.com's prose (not a phrase: the page's wording has changed before).
	expect(imported.toLowerCase()).toContain('domain');

	// --- Undo restores the reader byte for byte -------------------------------
	await page.getByRole('button', { name: /Undo/ }).click();
	await expect(box).toHaveValue('Hand typed before the import.');

	await page.close();
});
