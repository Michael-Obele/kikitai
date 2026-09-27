import * as v from 'valibot';
import { classificationSchema, type Classification } from '$lib/types/mail';

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
- Answer with a single JSON object: an array with one entry per message:
[{"gmailId":"...","category":"...","summary":"...","priority":3,"actionItems":["..."]}]
No markdown, no commentary.`;

const entrySchema = v.object({
	gmailId: v.string(),
	category: classificationSchema.entries.category,
	summary: v.pipe(v.string(), v.maxLength(400)),
	priority: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	actionItems: v.optional(v.array(v.string()), [])
});

const batchSchema = v.pipe(v.array(entrySchema), v.minLength(1));

async function chat(
	config: AiConfig,
	messages: { role: string; content: string }[]
): Promise<string> {
	const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {})
		},
		body: JSON.stringify({
			model: config.model,
			temperature: 0,
			messages,
			// most OpenAI-compatible servers honour this; ignored by those that don't
			response_format: { type: 'json_object' }
		})
	});
	if (!res.ok)
		throw new AiError(`${config.model} endpoint returned ${res.status}: ${await res.text()}`);
	const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
	const content = data.choices?.[0]?.message?.content;
	if (!content) throw new AiError('Empty response from the AI endpoint');
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
 * Batch-classify messages. One retry: the parse error is fed back to the model,
 * which fixes the shape without a second round-trip in the happy path.
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
	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: payload }
	];

	let raw: string;
	try {
		raw = await chat(config, messages);
	} catch (error) {
		if (error instanceof AiError) throw error;
		throw new AiError(String(error));
	}

	let parsed: v.InferOutput<typeof batchSchema>;
	try {
		parsed = v.parse(batchSchema, extractJson(raw));
	} catch (error) {
		messages.push({ role: 'assistant', content: raw.slice(0, 2000) });
		messages.push({
			role: 'user',
			content: `That was invalid: ${String(error)}. Return ONLY the JSON array, one entry per gmailId.`
		});
		raw = await chat(config, messages);
		parsed = v.parse(batchSchema, extractJson(raw));
	}

	const out = new Map<string, Classification>();
	for (const entry of parsed) {
		out.set(entry.gmailId, {
			category: entry.category,
			summary: entry.summary,
			priority: entry.priority,
			actionItems: entry.actionItems
		});
	}
	return out;
}

/** Split into batches of `size` — long prompt strings degrade small local models. */
export function batch<T>(items: T[], size = 10): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
