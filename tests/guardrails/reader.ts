import { expect, type Page } from '@playwright/test';

/** One entry of `localStorage['kikitai.read.telemetry']` (see src/lib/tts/telemetry.ts). */
export type TtsStat = {
	engine: string;
	kind: 'load' | 'gen' | 'chunk' | 'first';
	ms: number;
	genMs?: number;
	cached?: boolean;
	session: string;
	at: number;
};

/**
 * Ten short sentences. Short so one chunk plays in ~4s and a probe needs six of
 * them, not a minute of audio; long enough that the lookahead queue has real
 * work to stay ahead of — which is exactly what the no-stall probe measures.
 */
export const PASTE_TEXT = [
	'The morning train was late, so she bought a coffee she did not want.',
	'On the platform, a busker played the same three chords over and over.',
	'Nobody watched him, but he played as if the whole city were listening.',
	'A pigeon landed on the bench and stared at her with obvious judgement.',
	'She checked her phone twice, though she knew no message was coming.',
	'The sky threatened rain for the third day in a row and never delivered.',
	'When the train finally arrived, it was packed and slow and warm inside.',
	'She stood the whole way, holding the strap and reading the same headline.',
	'At her stop, an old man let her pass with a small and careful nod.',
	'The office was quiet, and her coffee had gone cold before she noticed.'
].join(' ');

/**
 * Public reader, cross-origin isolation checked — nothing pasted yet.
 *
 * Also forgets the last run: `kikitai.player.resume` survives in the profile,
 * and a probe that resumed at sentence nine would play one chunk, hit the end
 * of the item and go idle — which looks exactly like a playback stall.
 */
export async function openReader(page: Page): Promise<void> {
	await page.goto('/read');
	// Cross-origin isolation is what lets ONNX Runtime use more than one core;
	// without it the generation budget this suite guards is unreachable.
	expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
	await page.evaluate(() => {
		localStorage.removeItem('kikitai.player.resume');
		localStorage.removeItem('kikitai.read.telemetry');
	});
}

/** Paste the probe text — the first half of the long-task probe's window. */
export async function paste(page: Page): Promise<void> {
	await page.locator('#pasteText').fill(PASTE_TEXT);
}

/** `performance.now()` inside the page — for slicing one run into phases. */
export async function pageNow(page: Page): Promise<number> {
	return page.evaluate(() => performance.now());
}

/** `exact`: the speed control answers to "Playback speed 1×" too. */
export function playButton(page: Page) {
	return page.getByRole('button', { name: 'Play', exact: true });
}

/** Telemetry recorded at or after `since` — filters out earlier runs' rows. */
export async function statsSince(page: Page, since: number): Promise<TtsStat[]> {
	return page.evaluate((cutoff) => {
		try {
			const raw = localStorage.getItem('kikitai.read.telemetry');
			const all: TtsStat[] = raw ? JSON.parse(raw) : [];
			return all.filter((stat) => stat.at >= cutoff);
		} catch {
			return [];
		}
	}, since);
}

/**
 * Block until `count` stats of one kind have been recorded this run. Reads
 * localStorage in the page (interval polling, not rAF — a blocked or hidden
 * frame must not stop the probe from noticing progress).
 */
export async function waitForStats(
	page: Page,
	since: number,
	kind: TtsStat['kind'],
	count: number,
	timeout = 180_000
): Promise<void> {
	await page.waitForFunction(
		({ cutoff, kind, count }) => {
			try {
				const raw = localStorage.getItem('kikitai.read.telemetry');
				const all: { kind: string; at: number }[] = raw ? JSON.parse(raw) : [];
				return all.filter((stat) => stat.kind === kind && stat.at >= cutoff).length >= count;
			} catch {
				return false;
			}
		},
		{ cutoff: since, kind, count },
		{ timeout, polling: 250 }
	);
}

/** Stats of one kind, oldest first, from this run only. */
export async function statsOf(
	page: Page,
	since: number,
	kind: TtsStat['kind']
): Promise<TtsStat[]> {
	const all = await statsSince(page, since);
	return all.filter((stat) => stat.kind === kind).sort((a, b) => a.at - b.at);
}
