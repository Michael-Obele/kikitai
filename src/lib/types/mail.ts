import * as v from 'valibot';

/** App-level categories — never written back to Gmail. */
export const CATEGORIES = ['needs_reply', 'updates', 'promo', 'news', 'spam_suspect'] as const;

export const categorySchema = v.picklist(CATEGORIES);
export type Category = v.InferOutput<typeof categorySchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
	needs_reply: 'Needs reply',
	updates: 'Updates',
	promo: 'Promo',
	news: 'News',
	spam_suspect: 'Spam suspect'
};

/** Structured facts worth remembering from a message (dates, amounts, links, people). */
export const factsSchema = v.object({
	dates: v.optional(v.array(v.string()), []),
	amounts: v.optional(v.array(v.string()), []),
	links: v.optional(v.array(v.object({ label: v.string(), url: v.string() })), []),
	people: v.optional(v.array(v.string()), [])
});
export type Facts = v.InferOutput<typeof factsSchema>;
export const NO_FACTS: Facts = { dates: [], amounts: [], links: [], people: [] };

/** Expandable bullet view of one message — generated on first open, then cached. */
export const detailsSchema = v.object({
	keyPoints: v.array(v.string()),
	askOfYou: v.string(),
	deadlines: v.array(v.string())
});
export type MessageDetails = v.InferOutput<typeof detailsSchema>;

/** What the AI says about a whole conversation (stored once per thread). */
export const threadNarrativeSchema = v.object({
	summary: v.string(),
	highlights: v.array(v.string())
});
export type ThreadNarrative = v.InferOutput<typeof threadNarrativeSchema>;

/** Strict JSON shape the AI endpoint must return. */
export const classificationSchema = v.object({
	category: categorySchema,
	summary: v.pipe(v.string(), v.maxLength(400)),
	priority: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	actionItems: v.array(v.string()),
	/** Defaults to empty so a model that omits facts still classifies. */
	facts: v.optional(factsSchema, NO_FACTS)
});
export type Classification = v.InferOutput<typeof classificationSchema>;

export const messageDtoSchema = v.object({
	id: v.string(),
	gmailId: v.string(),
	subject: v.string(),
	fromName: v.string(),
	fromEmail: v.string(),
	receivedAt: v.date(),
	snippet: v.string(),
	bodyText: v.string(),
	labelIds: v.array(v.string()),
	category: v.nullable(categorySchema),
	summary: v.nullable(v.string()),
	priority: v.nullable(v.number()),
	actionItems: v.array(v.string()),
	facts: v.nullable(factsSchema),
	/** TTS-friendly rewrite of a long body — omitted from the list view. */
	spokenText: v.nullable(v.string()),
	/** AI-cleaned body: no URLs, no hard wrapping — reads and speaks cleanly. */
	cleanBody: v.nullable(v.string()),
	/** Messages in this conversation (local sync); only `getMessage` fills it. */
	threadCount: v.optional(v.number()),
	organizedAt: v.nullable(v.date()),
	organizeError: v.nullable(v.string()),
	isDigested: v.boolean()
});
export type MessageDto = v.InferOutput<typeof messageDtoSchema>;

/** List view — no bodies, so an inbox page stays light. */
export const inboxItemSchema = v.omit(messageDtoSchema, [
	'bodyText',
	'labelIds',
	'spokenText',
	'cleanBody'
]);
export type InboxItem = v.InferOutput<typeof inboxItemSchema>;

export const TTS_ENGINES = ['kitten', 'kokoro', 'webspeech', 'google', 'minimax'] as const;
export const ttsEngineSchema = v.picklist(TTS_ENGINES);
export type TtsEngine = v.InferOutput<typeof ttsEngineSchema>;

/** Settings as stored per user (plaintext for the form; `aiKey` is masked). */
export const settingsSchema = v.object({
	aiBaseUrl: v.string(),
	aiModel: v.string(),
	/** Only set when the user submits a new key; empty = keep existing. */
	aiKey: v.optional(v.string()),
	aiKeySet: v.boolean(),
	ttsEngine: ttsEngineSchema,
	ttsVoice: v.string(),
	/** Speed cap (multiplier) — steps live in SPEED_STEPS. */
	ttsSpeed: v.pipe(v.number(), v.minValue(0.5), v.maxValue(3)),
	/** Auto speed ramp: +0.1× every 2 min of playback up to ttsSpeed. */
	ttsRamp: v.boolean(),
	syncWindowDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30))
});
export type SettingsDto = v.InferOutput<typeof settingsSchema>;

/** UI-shaped strings for the settings `form` (re-validated server-side). */
export const settingsFormSchema = v.object({
	aiBaseUrl: v.pipe(v.string(), v.maxLength(300)),
	aiModel: v.pipe(v.string(), v.maxLength(120)),
	aiKey: v.pipe(v.string(), v.maxLength(500)),
	ttsEngine: ttsEngineSchema,
	ttsVoice: v.pipe(v.string(), v.maxLength(80)),
	syncWindowDays: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30))
});
export type SettingsFormInput = v.InferOutput<typeof settingsFormSchema>;

export const inboxFilterSchema = v.object({
	category: v.optional(v.union([categorySchema, v.literal('all')])),
	priority: v.optional(v.union([v.literal('all'), v.literal('high'), v.literal('unorganized')])),
	search: v.optional(v.string())
});
export type InboxFilter = v.InferOutput<typeof inboxFilterSchema>;

export const digestItemSchema = v.object({
	id: v.string(),
	subject: v.string(),
	fromName: v.string(),
	summary: v.string(),
	priority: v.number(),
	receivedAt: v.date(),
	actionItems: v.array(v.string()),
	facts: v.nullable(factsSchema)
});
export type DigestItem = v.InferOutput<typeof digestItemSchema>;

/** Result of a sync run — surfaced in the UI as a toast/inline status. */
export const syncResultSchema = v.object({
	fetched: v.number(),
	added: v.number(),
	organized: v.number(),
	failed: v.number()
});
export type SyncResult = v.InferOutput<typeof syncResultSchema>;
