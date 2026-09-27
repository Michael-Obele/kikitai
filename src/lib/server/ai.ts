import * as v from 'valibot';
import {
	classificationSchema,
	detailsSchema,
	factsSchema,
	NO_FACTS,
	threadNarrativeSchema,
	type Classification,
	type MessageDetails,
	type ThreadNarrative
} from '$lib/types/mail';

export class AiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AiError';
	}
}

export type AiConfig = { baseUrl: string; apiKey: string; model: string };

/** One message as the model sees it — body text only, never tokens or headers. */
export type OrganizeInput = { gmailId: string; subject: string; from: string; body: string };

const SYSTEM_PROMPT = `You organize an inbox. Classify each message into exactly one category:
- needs_reply: a person is waiting on a response from you
- updates: transactional/functional updates (receipts, notifications, account activity)
- promo: marketing, deals, newsletters you did not ask for
- news: genuine newsletters or digests you subscribed to
- spam_suspect: unsolicited, phishing-like, or irrelevant

Rules:
- summary: at most 2 short sentences, plain words, no preamble.
- priority: 1 (ignore) to 5 (deal with it today).
- actionItems: concrete next steps, or [] when nothing is required.
- facts: the dates/deadlines, money amounts, worth-remembering links and named people; use [] per key when there are none.
Answer with a single JSON object: an array with one entry per message:
[{"gmailId":"...","category":"...","summary":"...","priority":3,"actionItems":["..."],"facts":{"dates":["Friday 5pm"],"amounts":["$49"],"links":[{"label":"Invoice","url":"https://..."}],"people":["Jane Doe"]}}]
No markdown, no commentary.`;

const entrySchema = v.object({
	gmailId: v.string(),
	category: classificationSchema.entries.category,
	summary: v.pipe(v.string(), v.maxLength(400)),
	priority: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	actionItems: v.optional(v.array(v.string()), []),
	facts: v.optional(factsSchema, NO_FACTS)
});

const batchSchema = v.pipe(v.array(entrySchema), v.minLength(1));

async function chat(
	config: AiConfig,
	messages: { role: string; content: string }[]
): Promise<string> {
	const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
	const body = JSON.stringify({
		model: config.model,
		temperature: 0,
		messages,
		// most OpenAI-compatible servers honour this; ignored by those that don't
		response_format: { type: 'json_object' }
	});

	console.log(`[ai] → POST ${url} (model: ${config.model})`);
	console.log(`[ai] → request ${body}`);

	const started = Date.now();
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
		},
		body
	});

	const raw = await res.text();
	console.log(`[ai] ← ${res.status} ${res.statusText} in ${Date.now() - started}ms`);
	console.log(`[ai] ← response ${raw}`);

	if (!res.ok) throw new AiError(`${config.model} endpoint returned ${res.status}: ${raw}`);

	let data: { choices?: { message?: { content?: string } }[] };
	try {
		data = JSON.parse(raw) as typeof data;
	} catch {
		throw new AiError(
			`Endpoint returned 200 but not JSON (model ${config.model}): ${raw.slice(0, 500)}`
		);
	}
	const content = data.choices?.[0]?.message?.content;
	if (!content)
		throw new AiError(
			`Empty response from the AI endpoint — choices: ${JSON.stringify(data.choices ?? null)}`
		);
	return content;
}

/** Tolerate models that wrap the array in ```json fences or an object key. */
function extractJson(raw: string): unknown {
	const trimmed = raw
		.replace(/^\s*```(?:json)?/i, '')
		.replace(/```\s*$/, '')
		.trim();
	try {
		return JSON.parse(trimmed);
	} catch {
		const start = trimmed.indexOf('[');
		const end = trimmed.lastIndexOf(']');
		if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
		throw new AiError('The model did not return valid JSON');
	}
}

/**
 * One prompt → validated JSON. On a schema failure the raw output is fed back
 * to the model once — the retry the organize pass has always had, now shared.
 */
async function askJson<T>(
	config: AiConfig,
	messages: { role: string; content: string }[],
	parse: (input: unknown) => T
): Promise<T> {
	const history = [...messages];
	for (let attempt = 0; attempt < 2; attempt++) {
		let raw: string;
		try {
			raw = await chat(config, history);
		} catch (error) {
			throw error instanceof AiError ? error : new AiError(String(error));
		}
		try {
			return parse(extractJson(raw));
		} catch (error) {
			console.log(`[ai] validation failed: ${String(error)}`);
			console.log(`[ai] unparseable output: ${raw.slice(0, 2000)}`);
			if (attempt === 1) throw error;
			history.push({ role: 'assistant', content: raw.slice(0, 2000) });
			history.push({
				role: 'user',
				content: `That was invalid: ${String(error)}. Return ONLY the JSON, no markdown, no commentary.`
			});
		}
	}
	throw new AiError('unreachable');
}

/**
 * Batch-classify messages — one call per batch, facts included.
 */
export async function organizeBatch(
	config: AiConfig,
	input: OrganizeInput[]
): Promise<Map<string, Classification>> {
	if (input.length === 0) return new Map();
	const payload = JSON.stringify(
		input.map((m) => ({
			gmailId: m.gmailId,
			subject: m.subject,
			from: m.from,
			body: m.body.slice(0, 6000)
		}))
	);
	const parsed = await askJson(
		config,
		[
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: payload }
		],
		(raw) => v.parse(batchSchema, raw)
	);
	console.log(`[ai] validated ${parsed.length}/${input.length} entries`);

	const out = new Map<string, Classification>();
	for (const entry of parsed) {
		out.set(entry.gmailId, {
			category: entry.category,
			summary: entry.summary,
			priority: entry.priority,
			actionItems: entry.actionItems,
			facts: entry.facts ?? NO_FACTS
		});
	}
	return out;
}

const DETAILS_PROMPT = `You explain one email to a busy reader who will act on it.
Return ONE JSON object:
{"keyPoints":["..."],"askOfYou":"...","deadlines":["..."]}
- keyPoints: 3 to 6 short bullets, plain words, no preamble.
- askOfYou: one sentence saying what the sender wants from the reader, or "Nothing — read and move on."
- deadlines: the exact dates or times mentioned, or [].
- Use only what the message says. Never invent.
No markdown, no commentary.`;

/** The expandable bullet view behind the message panel's Details button. */
export async function detailsFor(config: AiConfig, input: OrganizeInput): Promise<MessageDetails> {
	return askJson(
		config,
		[
			{ role: 'system', content: DETAILS_PROMPT },
			{
				role: 'user',
				content: JSON.stringify({
					subject: input.subject,
					from: input.from,
					body: input.body.slice(0, 6000)
				})
			}
		],
		(raw) => v.parse(detailsSchema, raw)
	);
}

const THREAD_PROMPT = `You summarize one email conversation for someone who will listen to it.
Return ONE JSON object:
{"summary":"...","highlights":["..."]}
- summary: 2 to 4 sentences on where the conversation stands now and what happens next.
- highlights: 3 to 6 short bullets — decisions, dates, asks.
- Use only what the messages say. Never invent.
No markdown, no commentary.`;

/** One conversation-level summary, generated from every message in the thread. */
export async function threadSummaryFor(
	config: AiConfig,
	entries: { from: string; receivedAt: string; body: string }[]
): Promise<ThreadNarrative> {
	return askJson(
		config,
		[
			{ role: 'system', content: THREAD_PROMPT },
			{
				role: 'user',
				content: JSON.stringify(entries.map((e) => ({ ...e, body: e.body.slice(0, 3000) })))
			}
		],
		(raw) => v.parse(threadNarrativeSchema, raw)
	);
}

const LISTEN_PROMPT = `You rewrite one email so a text-to-speech voice reads it naturally.
Return ONE JSON object: {"spoken":"..."}
- Keep every fact, name, number and date from the original.
- Plain prose, short sentences, second person where it helps.
- Spoken-friendly: write out abbreviations ("e.g." becomes "for example"), say "the link in the email" instead of pasting URLs, keep money readable ("49 dollars" rather than "$49.00").
- No markdown, no emoji, no section labels, no preamble.
- At most 1200 words.`;

const listenSchema = v.object({
	spoken: v.pipe(v.string(), v.minLength(1), v.maxLength(30000))
});

/** A long email rewritten for the ear — replaces the 2000-character truncation. */
export async function listenScriptFor(config: AiConfig, input: OrganizeInput): Promise<string> {
	const { spoken } = await askJson(
		config,
		[
			{ role: 'system', content: LISTEN_PROMPT },
			{
				role: 'user',
				content: JSON.stringify({
					subject: input.subject,
					from: input.from,
					body: input.body.slice(0, 12000)
				})
			}
		],
		(raw) => v.parse(listenSchema, raw)
	);
	return spoken;
}

/** Split into batches of `size` — long prompt strings degrade small local models. */
export function batch<T>(items: T[], size = 10): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
