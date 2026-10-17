import { env } from '$env/dynamic/private';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export class GmailError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'GmailError';
	}
}

type Header = { name: string; value: string };

type GmailPart = {
	mimeType?: string;
	headers?: Header[];
	body?: { data?: string; size?: number };
	parts?: GmailPart[];
};

export type GmailMessage = {
	id: string;
	threadId: string;
	labelIds?: string[];
	snippet?: string;
	internalDate?: string;
	payload?: GmailPart;
};

// ---------------------------------------------------------------------------
// Beginner-friendly primer on classes (you can skip this if you already know)
// ---------------------------------------------------------------------------
// A class is a blueprint for objects that share the same data + behavior.
// - `new GmailClient(token)` creates one instance (one object) that remembers
//   that token. The `constructor` is the function that runs at creation time.
// - `this` (and `#token`) refers to "this particular instance's data".
// - `#token` / `private` means "only code inside this class can see it".
//   We use `#token` (a true private field) so the token never leaks via
//   `console.log(client)` or `JSON.stringify(client)`.
// - A normal method like `getProfile()` needs an instance: `client.getProfile()`.
// - A `static` method belongs to the class itself: `GmailClient.refreshAccessToken()`.
//   It does NOT need an instance because it does not use `this.#token`.
// Learn more: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes
// ---------------------------------------------------------------------------

/**
 * Gmail REST client — one instance per access token.
 *
 * Why a class here (and not just functions)?
 * - Every Gmail call needs the same `token`. With plain functions you thread
 *   `token` through every call: `getProfile(token)`, `listMessageIds(token, ...)`.
 *   With a class you store it once: `const client = new GmailClient(token)` and
 *   then `client.getProfile()`, `client.listMessageIds(...)`. Less repetition,
 *   harder to pass the wrong token, easier to mock in tests.
 * - The token is kept in a true private field `#token` so it cannot be read
 *   or logged accidentally from outside the class.
 *
 * Token lifecycle: this client does NOT mutate its token. If Google refreshes
 * the token, create a new instance: `new GmailClient(newToken)`. The static
 * `GmailClient.refreshAccessToken()` helper does the refresh without an instance.
 *
 * Pure helpers that do NOT need a token (`extractBody`, `parseMessage`,
 * `parseFrom`) stay as standalone functions below — they do not belong on the
 * instance because they work without a token.
 */
export class GmailClient {
	// `#token` = private field. Only methods inside this class can read it.
	// Outside code cannot do `client.#token` — it is a syntax error.
	#token: string;

	/**
	 * Create a client for one Gmail access token.
	 * @param token - a fresh OAuth access token (Bearer token for Gmail API)
	 */
	constructor(token: string) {
		this.#token = token;
	}

	/**
	 * Private helper: one authenticated fetch to the Gmail API.
	 * `private` means only this class can call it — callers use the public
	 * methods like `getProfile()` instead.
	 */
	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const res = await fetch(`${GMAIL}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.#token}`,
				...(init.headers ?? {})
			}
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new GmailError(`Gmail ${res.status}: ${body.slice(0, 300)}`, res.status);
		}
		return (await res.json()) as T;
	}

	/** The connected address — used to label the account in the UI. */
	async getProfile(): Promise<string> {
		const data = await this.request<{ emailAddress?: string }>('/profile');
		return data.emailAddress ?? '';
	}

	/** `in:inbox newer_than:7d` — read-only list call, one page. */
	async listMessageIds(opts: {
		windowDays: number;
		maxResults?: number;
		pageToken?: string;
	}): Promise<{ ids: string[]; nextPageToken?: string }> {
		const params = new URLSearchParams({
			q: `in:inbox newer_than:${opts.windowDays}d`,
			maxResults: String(opts.maxResults ?? 50)
		});
		if (opts.pageToken) params.set('pageToken', opts.pageToken);
		const data = await this.request<{ messages?: { id: string }[]; nextPageToken?: string }>(
			`/messages?${params}`
		);
		return { ids: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken };
	}

	/** Fetch full messages, `concurrency` at a time to stay under quota. */
	async fetchMessages(ids: string[], concurrency = 5): Promise<GmailMessage[]> {
		const out: GmailMessage[] = [];
		let cursor = 0;
		const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
			while (cursor < ids.length) {
				const id = ids[cursor++]!;
				// `this.request` is an instance method — it automatically uses this.#token.
				out.push(await this.request<GmailMessage>(`/messages/${id}?format=full`));
			}
		});
		await Promise.all(workers);
		return out;
	}

	/** The whole conversation — read-only `threads.get`, same scope as message calls. */
	async getThread(threadId: string): Promise<GmailMessage[]> {
		const data = await this.request<GmailThread>(`/threads/${threadId}?format=full`);
		return data.messages ?? [];
	}

	/**
	 * Exchange a refresh token for a fresh access token (Google token endpoint).
	 * `static` = call without an instance: `GmailClient.refreshAccessToken(rt)`.
	 * It does not use `this.#token` — it uses the refresh token you pass in.
	 */
	static async refreshAccessToken(
		refreshToken: string
	): Promise<{ accessToken: string; expiresIn: number }> {
		const res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: refreshToken,
				client_id: env.GOOGLE_CLIENT_ID || '',
				client_secret: env.GOOGLE_CLIENT_SECRET || ''
			})
		});
		if (!res.ok) throw new GmailError(`Token refresh failed: ${await res.text()}`, res.status);
		const data = (await res.json()) as { access_token: string; expires_in: number };
		return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
	}
}

export type GmailThread = { id?: string; messages?: GmailMessage[] };

// ---------------------------------------------------------------------------
// Pure helpers — no token needed, so they stay as plain functions (not methods).
// Keeping them outside the class makes it clear they work without an instance
// and keeps the class focused on "authenticated Gmail calls".
// ---------------------------------------------------------------------------

const decode = (data?: string) => (data ? Buffer.from(data, 'base64url').toString('utf8') : '');

function walkParts(part: GmailPart, sink: GmailPart[]) {
	sink.push(part);
	for (const child of part.parts ?? []) walkParts(child, sink);
}

/** HTML → readable text (the AI and the TTS both consume this). */
function htmlToText(html: string): string {
	return html
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&#\d+;/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Extract plain text: prefer text/plain, fall back to stripping the HTML part. */
export function extractBody(payload?: GmailPart): string {
	if (!payload) return '';
	if (payload.mimeType?.startsWith('text/plain') && payload.body?.data)
		return decode(payload.body.data);
	const parts: GmailPart[] = [];
	walkParts(payload, parts);
	const plain = parts.find((p) => p.mimeType?.startsWith('text/plain') && p.body?.data);
	if (plain?.body?.data) return decode(plain.body.data);
	const html = parts.find((p) => p.mimeType?.startsWith('text/html') && p.body?.data);
	if (html?.body?.data) return htmlToText(decode(html.body.data));
	if (payload.body?.data) return htmlToText(decode(payload.body.data));
	return '';
}

function header(headers: Header[] | undefined, name: string): string {
	return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** `Jane Doe <jane@example.com>` → `{ name: 'Jane Doe', email: 'jane@example.com' }`. */
export function parseFrom(value: string): { name: string; email: string } {
	const match = /^(.*)<([^>]+)>\s*$/.exec(value.trim());
	if (match)
		return {
			name: (match[1] ?? '').replace(/^"|"$/g, '').trim() || match[2]!,
			email: match[2]!.trim()
		};
	return { name: value.trim(), email: value.trim() };
}

export type ParsedMessage = {
	gmailId: string;
	threadId: string;
	subject: string;
	fromName: string;
	fromEmail: string;
	receivedAt: Date;
	snippet: string;
	bodyText: string;
	labelIds: string[];
};

export function parseMessage(message: GmailMessage): ParsedMessage {
	const headers = message.payload?.headers;
	const from = parseFrom(header(headers, 'from'));
	const date = header(headers, 'date');
	const receivedAt = message.internalDate
		? new Date(Number(message.internalDate))
		: new Date(date || Date.now());
	return {
		gmailId: message.id,
		threadId: message.threadId,
		subject: header(headers, 'subject') || '(no subject)',
		fromName: from.name,
		fromEmail: from.email,
		receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
		snippet: message.snippet ?? '',
		bodyText: extractBody(message.payload),
		labelIds: message.labelIds ?? []
	};
}

// ---------------------------------------------------------------------------
// Backward-compatible function wrappers — keep existing call sites working.
// New code should prefer `new GmailClient(token).getProfile()` etc.
// These wrappers simply create a one-off client and delegate.
// ---------------------------------------------------------------------------

/** @deprecated Prefer `new GmailClient(token).getProfile()` */
export async function getProfile(token: string): Promise<string> {
	return new GmailClient(token).getProfile();
}

/** @deprecated Prefer `GmailClient.refreshAccessToken(refreshToken)` (static) */
export async function refreshAccessToken(
	refreshToken: string
): Promise<{ accessToken: string; expiresIn: number }> {
	return GmailClient.refreshAccessToken(refreshToken);
}

/** @deprecated Prefer `new GmailClient(token).listMessageIds(opts)` */
export async function listMessageIds(
	token: string,
	opts: { windowDays: number; maxResults?: number; pageToken?: string }
): Promise<{ ids: string[]; nextPageToken?: string }> {
	return new GmailClient(token).listMessageIds(opts);
}

/** @deprecated Prefer `new GmailClient(token).fetchMessages(ids, concurrency)` */
export async function fetchMessages(
	token: string,
	ids: string[],
	concurrency = 5
): Promise<GmailMessage[]> {
	return new GmailClient(token).fetchMessages(ids, concurrency);
}

/** @deprecated Prefer `new GmailClient(token).getThread(threadId)` */
export async function getThread(token: string, threadId: string): Promise<GmailMessage[]> {
	return new GmailClient(token).getThread(threadId);
}

// Note on other modules: forge review found that converting
// `src/lib/tts/*`, `src/lib/server/tokens.ts`, and `src/lib/tts/model-cache.ts`
// to classes would be YAGNI — they have no shared mutable state that benefits
// from an instance, and a class would add `this` handling and singleton risks
// (e.g., duplicate ONNX heaps → OOM) without improving DX. They stay as functions.
