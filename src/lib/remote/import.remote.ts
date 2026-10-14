import { form } from '$app/server';
import * as v from 'valibot';
import { ImportFailure, importFromUrl } from '$lib/server/import-url';

/**
 * Cheap client-side gate so an obvious slip never travels to the server. The
 * real security checks (private addresses, redirects, size) live in
 * `importFromUrl` — this one is convenience, not defence.
 */
function isWebUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

const importUrlSchema = v.object({
	url: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty('Paste a web address first'),
		v.maxLength(2048, 'That address is too long'),
		v.check(isWebUrl, 'Only http:// and https:// links can be imported')
	)
});

/** What the reader gets back: the imported page, or a message they can act on. */
export type ImportOutcome =
	{ ok: true; title: string; text: string } | { ok: false; error: string };

/**
 * Read a public web page on the server and return its text.
 *
 * Anonymous on purpose: `/read` works without an account and this only fetches
 * a public page, so there is no `requireUser` to hit — a signed-out reader
 * imports exactly like a signed-in one, and nothing about them is stored.
 *
 * It is a `form` rather than a `command` because the input is a form field:
 * validation issues then render inline on the field, the button gets
 * `pending` for free, and the page still degrades to a real POST without JS.
 * The handler never throws for expected failures — a thrown error would
 * navigate the page to an error screen, and the brief wants failures shown
 * next to the control that caused them.
 */
export const importUrl = form(importUrlSchema, async ({ url }): Promise<ImportOutcome> => {
	try {
		return { ok: true, ...(await importFromUrl(url)) };
	} catch (error) {
		if (error instanceof ImportFailure) return { ok: false, error: error.message };
		console.error('[import] unexpected failure:', error);
		return { ok: false, error: 'Something went wrong while reading that page. Try again.' };
	}
});
