import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Page } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * One persistent profile for the whole run. The voice model lives in browser
 * storage (Cache Storage + IndexedDB), so a warm profile is the difference
 * between a 3-second probe and a 57MB download on every run.
 */
const PROFILE_DIR = path.join(ROOT, 'tests', '.profile');

export const BASE_URL =
	process.env.GUARDRAIL_BASE_URL ?? `http://localhost:${process.env.GUARDRAIL_PORT ?? '5173'}`;
export const FAKE_USER = 'guardrail-probe-user';
const DEV_USER_COOKIE = 'kikitai_dev_user';

/**
 * Kept on `globalThis`, not in module scope: a spec file whose module registry
 * is reset must not strand an open browser holding the profile lock.
 */
const holder = globalThis as { guardrailContext?: BrowserContext };

/** Open (or reuse) the shared context every probe runs in. */
export async function openContext(): Promise<BrowserContext> {
	if (holder.guardrailContext) return holder.guardrailContext;

	const context = await chromium.launchPersistentContext(PROFILE_DIR, {
		baseURL: BASE_URL,
		headless: true
	});
	holder.guardrailContext = context;

	// Sign in as the seeded probe account — the dev-only shim in
	// src/hooks.server.ts reads this cookie. Never accepted in a production build.
	await context.addCookies([{ name: DEV_USER_COOKIE, value: FAKE_USER, url: BASE_URL }]);

	// The "downloads 57MB once" notice would otherwise gate every probe behind a
	// click that has nothing to do with what is being measured.
	await context.addInitScript(() => {
		localStorage.setItem('kikitai-tts-ack:kitten', '1');
		localStorage.setItem('kikitai-tts-ack:kokoro', '1');
	});

	return context;
}

export async function closeContext(): Promise<void> {
	const context = holder.guardrailContext;
	holder.guardrailContext = undefined;
	await context?.close();
}

/** A fresh page in the shared profile — every probe opens exactly one. */
export async function newPage(): Promise<Page> {
	return (await openContext()).newPage();
}

/**
 * Everything the page said — console output, uncaught exceptions and the text
 * of every toast (sonner dismisses after four seconds, so they are recorded
 * the moment they appear). The player reports failures only through a toast.
 */
export function watchConsole(page: Page): string[] {
	const lines: string[] = [];
	page.on('console', (message) => lines.push(`${message.type()}: ${message.text()}`));
	page.on('pageerror', (error) => lines.push(`pageerror: ${error.message}`));
	void page
		.addInitScript(() => {
			const target = globalThis as unknown as { __toasts?: string[] };
			target.__toasts = [];
			const watch = () => {
				new MutationObserver(() => {
					for (const node of document.querySelectorAll('[data-sonner-toast]')) {
						const text = node.textContent ?? '';
						if (text && !target.__toasts?.includes(text)) target.__toasts?.push(text);
					}
				}).observe(document.body, { childList: true, subtree: true });
			};
			if (document.body) watch();
			else document.addEventListener('DOMContentLoaded', watch);
		})
		.catch(() => {
			/* instrumentation is best-effort */
		});
	return lines;
}

/** Every toast the page raised during this run. */
export async function toasts(page: Page): Promise<string[]> {
	return page.evaluate(() => (globalThis as { __toasts?: string[] }).__toasts ?? []);
}

/**
 * Things that must never happen during a probe, collected as strings so a
 * failure prints the offending request instead of a boolean.
 */
export function watchIsolation(page: Page): string[] {
	const failures: string[] = [];
	page.on('requestfailed', (request) => {
		const error = request.failure()?.errorText ?? '';
		// The inline worker is only inline in a prod build; in dev the COEP
		// middleware in vite.config.ts is what keeps Chrome from blocking it.
		if (error.includes('BLOCKED_BY_RESPONSE') || error.includes('ERR_BLOCKED')) {
			failures.push(`${request.url()} — ${error}`);
		}
	});
	return failures;
}
