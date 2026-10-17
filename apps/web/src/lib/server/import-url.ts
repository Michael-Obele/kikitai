import { lookup } from 'node:dns/promises';
import { htmlToText, pickTitle } from '$lib/server/html-to-text';

/**
 * URL → text import (Phase 1).
 *
 * Why this is server-side at all: a browser cannot read an arbitrary page
 * (CORS says no), and `/read` promises the reader that nothing they touch is
 * uploaded. So the server does the fetching and only `{ title, text }` comes
 * back — the raw HTML never reaches the browser and nothing is stored.
 *
 * The endpoint is anonymous (`/read` works without an account), which makes
 * this a classic SSRF target: anyone could try to make the server read its own
 * internals or the cloud metadata address. The checks below are that defence,
 * and they run on *every* hop, because a redirect target is attacker-supplied.
 *
 * Residual risk accepted for Phase 1: between the DNS check and the actual
 * fetch, a hostile resolver could re-point the name at a private address
 * (DNS rebinding). Closing that needs a pinned connection to the checked
 * address, which means a custom dispatcher — a dependency, not Phase 1.
 */

/** 2 MB of markup is far more than an article; past that it is a download. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * One budget for the whole request: headers, body and every redirect hop.
 * The brief asked for "~10s" — 15s because this machine has measured 11s+
 * cold connections to ordinary sites, and a 10s cap would reject pages that
 * are merely slow once.
 */
const TIMEOUT_MS = 15_000;

const MAX_REDIRECTS = 5;

/** Browser-shaped on purpose: plenty of sites refuse anything that looks like
 *  a bot, and refusing those would make the importer look broken. */
const USER_AGENT =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Only document-ish payloads. Anything else (a zip, a video, an API JSON
 *  blob) is not something the reader can be handed as prose. */
const READABLE_TYPES = new Set([
	'',
	'text/html',
	'application/xhtml+xml',
	'text/plain',
	'text/markdown',
	'application/xml',
	'text/xml',
	'application/rss+xml',
	'application/atom+xml'
]);

const PRIVATE_TARGET = 'That address is private or internal, so this server will not fetch it.';
const TIMEOUT_MESSAGE = `That page did not answer within ${TIMEOUT_MS / 1000} seconds.`;
const TOO_LARGE_MESSAGE = `That page is bigger than the ${MAX_BYTES / (1024 * 1024)} MB limit.`;

/**
 * A failure meant for the reader. The import handler only ever shows messages
 * from this error class; anything else is a bug and gets logged instead of
 * passed through, so internal details never end up on a public page.
 */
export class ImportFailure extends Error {}

export type ImportedPage = { title: string; text: string };

/** Fetch a page and return just its title and readable text. */
export async function importFromUrl(input: string): Promise<ImportedPage> {
	const start = parseTarget(input);
	const signal = AbortSignal.timeout(TIMEOUT_MS);
	const { body, contentType } = await readPage(start, signal);

	const mime = contentType.split(';')[0].trim().toLowerCase();
	// `pickTitle` needs the original markup — `htmlToText` strips <title> away.
	const title = pickTitle(body, start);
	const text = mime === 'text/plain' ? body.replace(/\r\n?/g, '\n').trim() : htmlToText(body);

	if (!text) throw new ImportFailure('That page had no readable text in it.');
	return { title, text };
}

/** Parse and reject anything that is not a plain http(s) web address. */
function parseTarget(input: string): URL {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new ImportFailure('That does not look like a web address.');
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ImportFailure('Only http:// and https:// links can be imported.');
	}

	return url;
}

/**
 * The SSRF gate: scheme and host name first (cheap), then every address the
 * name resolves to. Fails closed — if we cannot tell where a request is
 * going, we do not send it.
 */
async function assertFetchable(url: URL, signal: AbortSignal): Promise<void> {
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new ImportFailure('Only http:// and https:// links can be imported.');
	}

	// Odd ports are how a public host gets turned into a port scanner (its own
	// database, its own admin UI). Web pages live on 80 and 443 — that is the
	// allow-list. It lives *here*, not only in `parseTarget`, because every
	// redirect hop comes through this function and only the first URL was ever
	// parsed: `https://a/ → 302 → https://a:8443/` must be refused too.
	if (url.port && url.port !== '80' && url.port !== '443') {
		throw new ImportFailure('Only standard web addresses (ports 80 and 443) can be imported.');
	}

	// `new URL` keeps IPv6 literals bracketed ("[::1]") and has already
	// normalised tricks like http://0x7f000001/ to 127.0.0.1, so what we
	// inspect here is what fetch will actually dial.
	const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

	if (!hostname || isInternalName(hostname)) throw new ImportFailure(PRIVATE_TARGET);

	for (const address of await resolveAll(hostname, signal)) {
		if (isPrivateAddress(address)) throw new ImportFailure(PRIVATE_TARGET);
	}
}

/** Names that are never public, before spending a DNS query on them. */
function isInternalName(hostname: string): boolean {
	return (
		hostname === 'localhost' ||
		hostname.endsWith('.localhost') ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal') ||
		hostname.endsWith('.home.arpa')
	);
}

/**
 * `dns.lookup` cannot be told to stop, so race it against the request's own
 * signal: a stuck resolver then spends the request's deadline instead of
 * pinning it open forever, and the whole import stays inside one budget.
 */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	// An already-aborted signal never fires the listener below, so a lookup that
	// finishes after the deadline would otherwise hang the caller forever.
	if (signal.aborted) return Promise.reject(new ImportFailure(TIMEOUT_MESSAGE));
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new ImportFailure(TIMEOUT_MESSAGE));
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			}
		);
	});
}

/** Every address the host resolves to (A + AAAA). A name that will not
 *  resolve is a failure the reader can understand, not a stack trace. */
async function resolveAll(hostname: string, signal: AbortSignal): Promise<string[]> {
	try {
		const records = await raceSignal(lookup(hostname, { all: true, verbatim: true }), signal);
		return records.map((record) => record.address);
	} catch (error) {
		if (error instanceof ImportFailure) throw error;
		throw new ImportFailure('That host name could not be resolved.');
	}
}

/** True for loopback, private, link-local, carrier-grade and metadata space —
 *  both families, including IPv4 addresses spelled out inside IPv6. */
function isPrivateAddress(address: string): boolean {
	const addr = address.toLowerCase();

	if (!addr.includes(':')) return isPrivateIpv4(addr);

	// ::1 and :: (unspecified) first, then IPv4 seen through IPv6:
	// "[::ffff:127.0.0.1]" arrives as "[::ffff:7f00:1]" after URL parsing.
	if (addr === '::1' || addr === '::') return true;
	const embedded = ipv4InsideIpv6(addr);
	if (embedded) return isPrivateIpv4(embedded);

	// Global unicast is 2000::/3 — nothing below it is routable to the world.
	if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique local
	if (addr.startsWith('fe')) return true; // link-local, site-local, reserved
	if (addr.startsWith('ff')) return true; // multicast
	return false;
}

function isPrivateIpv4(dotted: string): boolean {
	const octets = dotted.split('.').map((part) => Number(part));
	// Malformed input fails closed.
	if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
		return true;
	}
	const [a, b, c] = octets as [number, number, number, number];
	return (
		a === 0 || // 0.0.0.0/8, "this network"
		a === 10 || // private
		a === 127 || // loopback
		(a === 169 && b === 254) || // link-local: 169.254.169.254 metadata lives here
		(a === 172 && b >= 16 && b <= 31) || // private
		(a === 192 && b === 168) || // private
		(a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
		(a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol use
		(a === 198 && (b === 18 || b === 19)) || // benchmarking
		a >= 224 // multicast, reserved, broadcast
	);
}

/** Pull the dotted IPv4 out of an IPv4-mapped/compatible IPv6 address, or
 *  return null when there is none. Handles both `::ffff:1.2.3.4` and the
 *  hex form `::ffff:102:304` that URL parsing produces. */
function ipv4InsideIpv6(address: string): string | null {
	if (!address.startsWith('::')) return null;
	const tail = address.slice(2).replace(/^ffff:/, '');
	if (tail.includes('.')) return tail;

	const groups = tail.split(':').filter(Boolean);
	if (groups.length !== 2 && groups.length !== 4) return null;

	const octets: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
		const value = Number.parseInt(group, 16);
		if (groups.length === 2) {
			octets.push(value >> 8, value & 255);
		} else {
			octets.push(value);
		}
	}
	return octets.join('.');
}

/**
 * Follow redirects by hand — `redirect: 'follow'` would fetch each hop before
 * anyone could look at it. Returns the decoded body once a real response lands.
 */
async function readPage(
	start: URL,
	signal: AbortSignal
): Promise<{ body: string; contentType: string }> {
	let url = start;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		await assertFetchable(url, signal);

		let response: Response;
		try {
			response = await fetch(url, {
				redirect: 'manual',
				signal,
				headers: {
					'user-agent': USER_AGENT,
					accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
					'accept-language': 'en'
				}
			});
		} catch {
			if (signal.aborted) throw new ImportFailure(TIMEOUT_MESSAGE);
			throw new ImportFailure('That address could not be reached.');
		}

		if (REDIRECT_STATUSES.has(response.status)) {
			const location = response.headers.get('location');
			void response.body?.cancel();
			if (!location) throw new ImportFailure('That page sent a redirect with nowhere to go.');
			try {
				url = new URL(location, url);
			} catch {
				throw new ImportFailure('That page sent a redirect to a broken address.');
			}
			continue;
		}

		if (!response.ok) {
			throw new ImportFailure(`That page answered with an error (HTTP ${response.status}).`);
		}

		return readBody(response, signal);
	}

	throw new ImportFailure(`That page redirected more than ${MAX_REDIRECTS} times.`);
}

/** Read at most MAX_BYTES, then stop the download — not just our own loop. */
async function readBody(
	response: Response,
	signal: AbortSignal
): Promise<{ body: string; contentType: string }> {
	const contentType = response.headers.get('content-type') ?? '';
	const mime = contentType.split(';')[0].trim().toLowerCase();
	if (!READABLE_TYPES.has(mime)) {
		void response.body?.cancel();
		throw new ImportFailure(`Only text pages can be imported, and that link is ${mime}.`);
	}

	if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) {
		void response.body?.cancel();
		throw new ImportFailure(TOO_LARGE_MESSAGE);
	}

	const reader = response.body?.getReader();
	if (!reader) return { body: '', contentType };

	const chunks: Uint8Array[] = [];
	let total = 0;

	for (;;) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try {
			chunk = await reader.read();
		} catch {
			if (signal.aborted) throw new ImportFailure(TIMEOUT_MESSAGE);
			throw new ImportFailure('The connection dropped while that page was being read.');
		}
		if (chunk.done) break;

		total += chunk.value.byteLength;
		if (total > MAX_BYTES) {
			void reader.cancel().catch(() => {});
			throw new ImportFailure(TOO_LARGE_MESSAGE);
		}
		chunks.push(chunk.value);
	}

	// One flat buffer: TextDecoder wants bytes, and this keeps the decode step
	// free of Blob/async plumbing.
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return { body: decodeBody(bytes, contentType), contentType };
}

/** Pages are rarely UTF-8 on the wire — honour the charset from the header and
 *  fall back to UTF-8 when it is missing or nonsense. */
function decodeBody(bytes: Uint8Array, contentType: string): string {
	const label = /charset\s*=\s*"?([\w.-]+)"?/i.exec(contentType)?.[1];
	if (label) {
		try {
			return new TextDecoder(label).decode(bytes);
		} catch {
			// Unknown label: UTF-8 below.
		}
	}
	return new TextDecoder('utf-8').decode(bytes);
}
