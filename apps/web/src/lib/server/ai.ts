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

export type AiConfig = {
	baseUrl: string;
	apiKey: string;
	model: string;
	/** DeepSeek-style thinking toggle — omitted when the provider has no such switch. */
	thinking?: 'enabled' | 'disabled';
};

/** One message as the model sees it — body text only, never tokens or headers. */
export type OrganizeInput = { gmailId: string; subject: string; from: string; body: string };

/** Bodies are clipped for the model; overruns are the reader's problem, not the model's. */
const BODY_MAX = 20000;
const DETAILS_MAX = 6000;
const ORGANIZE_MAX = 6000;
const THREAD_MAX = 3000;

/** DeepSeek's completion default is low enough to cut JSON in half — set it explicitly. */
const MAX_COMPLETION_TOKENS = 16384;

const MAX_SPOKEN_WORDS = 1200;
const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Cut on a paragraph or word boundary and say so. A silent mid-word cut is the
 * worst option: the cleanup copies the half word straight to the reader, and the
 * listen script invents an ending — "Thanks for reading" — that was never sent.
 */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const paragraph = cut.lastIndexOf('\n\n');
	const boundary =
		paragraph > max * 0.6 ? paragraph : Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
	const kept = boundary > 0 ? cut.slice(0, boundary) : cut;
	return `${kept.trimEnd()}\n\n… [truncated]`;
}

const TRUNCATION_RULE = `- The body may end with "… [truncated]". That is where the email stops — stop there too. Never write a conclusion, a summary or a sign-off.`;
const SPONSOR_RULE = `- Drop advertising and sponsorships ("Together with …", "Sponsored by …", partner promos, tool roundups paid for by someone) — keep the editorial.`;

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
		// DeepSeek recommends an explicit cap in JSON mode — the default can truncate.
		max_tokens: MAX_COMPLETION_TOKENS,
		messages,
		// most OpenAI-compatible servers honour this; ignored by those that don't
		response_format: { type: 'json_object' },
		// DeepSeek only: `disabled` skips the reasoning pass (faster + much cheaper)
		...(config.thinking ? { thinking: { type: config.thinking } } : {})
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
			body: clip(m.body, ORGANIZE_MAX)
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
					body: clip(input.body, DETAILS_MAX)
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
				content: JSON.stringify(entries.map((e) => ({ ...e, body: clip(e.body, THREAD_MAX) })))
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
- At most ${MAX_SPOKEN_WORDS} words — a hard limit, not a target. On a longer email, take the parts that matter in order and compress the rest to a line each; never drop a date, name or number.
${TRUNCATION_RULE}
${SPONSOR_RULE}`;

const listenSchema = v.object({
	spoken: v.pipe(v.string(), v.minLength(1), v.maxLength(30000))
});

/** A long email rewritten for the ear — replaces the 2000-character truncation. */
export async function listenScriptFor(config: AiConfig, input: OrganizeInput): Promise<string> {
	const messages: { role: string; content: string }[] = [
		{ role: 'system', content: LISTEN_PROMPT },
		{
			role: 'user',
			content: JSON.stringify({
				subject: input.subject,
				from: input.from,
				body: clip(input.body, BODY_MAX)
			})
		}
	];
	const parse = (raw: unknown) => v.parse(listenSchema, raw).spoken;

	const spoken = await askJson(config, messages, parse);
	// Within ~10% the model is simply at its natural length for this email; past
	// that it ignored the cap, so say so — a second pass at temperature 0 comes
	// back the same size (measured: 1479 → 1477 words) and costs another call.
	const words = countWords(spoken);
	if (words > MAX_SPOKEN_WORDS * 1.1)
		console.log(`[ai] listen script is ${words} words — over the ${MAX_SPOKEN_WORDS}-word cap`);
	return spoken;
}

const CLEAN_PROMPT = `You clean up one email so it reads as plain prose and sounds natural read aloud.
Return ONE JSON object: {"clean":"..."}
- Keep every fact, name, number, date, list item and link label. Never summarize, never invent.
- Flowing paragraphs: one blank line between them, no hard-wrapped lines, no double spaces.
- Drop URLs and bracketed links — keep the words around them ("the link in the email", or the link's label as plain text).
- Drop mailing-list furniture: "View this post on the web", "Unsubscribe", "Read in browser", "plain text version of this post", "copy and paste the link", "view the post online", pixel text, image alts, footer boilerplate.
- Spoken-friendly: what a voice should say ("49 dollars", "Friday 5 pm"). No markdown, no emoji, no ALL-CAPS shouting.
- Plain punctuation, ASCII where possible.
${TRUNCATION_RULE}
${SPONSOR_RULE}
Return only the JSON.`;

const cleanSchema = v.object({
	clean: v.pipe(v.string(), v.minLength(1), v.maxLength(60000))
});

/**
 * The body with links, wrapping and mailing-list furniture removed — what the
 * message panel shows and what the offline voice actually reads. Cached per
 * message by `getMessage`, so this runs at most once per message ever.
 */
export async function cleanBodyFor(config: AiConfig, input: OrganizeInput): Promise<string> {
	const { clean } = await askJson(
		config,
		[
			{ role: 'system', content: CLEAN_PROMPT },
			{
				role: 'user',
				content: JSON.stringify({
					subject: input.subject,
					from: input.from,
					body: clip(input.body, BODY_MAX)
				})
			}
		],
		(raw) => v.parse(cleanSchema, raw)
	);
	return clean;
}

/** Split into batches of `size` — long prompt strings degrade small local models. */
export function batch<T>(items: T[], size = 10): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
