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

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${GMAIL}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
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
export async function getProfile(token: string): Promise<string> {
	const data = await request<{ emailAddress?: string }>(token, '/profile');
	return data.emailAddress ?? '';
}

/** Exchange the refresh token for a fresh access token (Google token endpoint). */
export async function refreshAccessToken(
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

/** `in:inbox newer_than:7d` — read-only list call, one page. */
export async function listMessageIds(
	token: string,
	opts: { windowDays: number; maxResults?: number; pageToken?: string }
): Promise<{ ids: string[]; nextPageToken?: string }> {
	const params = new URLSearchParams({
		q: `in:inbox newer_than:${opts.windowDays}d`,
		maxResults: String(opts.maxResults ?? 50)
	});
	if (opts.pageToken) params.set('pageToken', opts.pageToken);
	const data = await request<{ messages?: { id: string }[]; nextPageToken?: string }>(
		token,
		`/messages?${params}`
	);
	return { ids: (data.messages ?? []).map((m) => m.id), nextPageToken: data.nextPageToken };
}

/** Fetch full messages, `concurrency` at a time to stay under quota. */
export async function fetchMessages(
	token: string,
	ids: string[],
	concurrency = 5
): Promise<GmailMessage[]> {
	const out: GmailMessage[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
		while (cursor < ids.length) {
			const id = ids[cursor++]!;
			out.push(await request<GmailMessage>(token, `/messages/${id}?format=full`));
		}
	});
	await Promise.all(workers);
	return out;
}

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
