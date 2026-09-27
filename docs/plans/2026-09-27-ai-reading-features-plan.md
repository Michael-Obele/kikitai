# AI Reading Features (Details, Thread, Listen, Facts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every message expandable AI details, a conversation-level summary, a speakable rewrite for long mail, and extracted facts — all cached after one call each.

**Architecture:** Extend the existing OpenAI-compatible pipeline in `src/lib/server/ai.ts`: one new generic `askJson()` (prompt → validated JSON with one retry) that the existing organize pass and the three new helpers share. Facts ride along in the existing Organize call (zero extra round-trips); Details / Thread / Listen generate on first use from new `command` remotes and are stored in new Postgres columns.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, remote functions (`query`/`command`), Drizzle ORM + Postgres (Neon), Valibot 1, shadcn-svelte, Tailwind 4, Lucide icons, `bun`.

## Global Constraints

- `bun run check` must end every task at **0 errors and 0 warnings** (repo rule).
- **No new dependencies and no test framework** — the repo has none; validation is type-check + the per-task runtime check (approved design §6).
- Format touched files with `bunx prettier --write <files>`; run the Svelte autofixer on touched `.svelte` files.
- Remote functions: a query with an input schema needs the argument everywhere; refresh instances by their argument (`void getMessage(id).refresh()` matches; `.updates()` + `requested()` when args differ).
- Svelte 5 only: `$state` / `$derived` / `$props`, `onclick` (never `on:click`), keyed `{#each} (... )` blocks.
- Only extracted **message text** ever reaches the AI endpoint; never tokens, keys or headers.
- Commits: `<type>(<scope>): <imperative>`, subject ≤50 chars, no AI attribution — **stage only the files listed in each task** (the working tree carries unrelated in-flight work).
- Read-only Gmail: nothing may send, modify or delete mail.

## File structure

| File | Role |
| --- | --- |
| Create: `src/lib/components/inbox/facts-chips.svelte` | One reusable chip row for dates/amounts/links/people |
| Modify: `src/lib/types/mail.ts` | `factsSchema`, `detailsSchema`, `threadNarrativeSchema` + DTO fields |
| Modify: `src/lib/server/db/schema.ts` | `facts`/`details`/`spokenText` columns, `thread_summary` table |
| Modify: `src/lib/server/gmail.ts` | `getThread()` — `threads.get` read-only fetch |
| Modify: `src/lib/server/ai.ts` | `askJson()`, facts in the batch schema, `detailsFor`, `threadSummaryFor`, `listenScriptFor` |
| Modify: `src/lib/server/organize.ts` | persist `facts` |
| Modify: `src/lib/remote/ai.remote.ts` | `loadDetails`, `loadListenScript` commands |
| Modify: `src/lib/remote/mail.remote.ts` | DTO mapping + `loadThreadSummary` (owns token access) |
| Modify: `src/lib/remote/index.ts` | barrel exports |
| Modify: `src/lib/components/inbox/message-card.svelte`, `message-panel.svelte`, `src/routes/(app)/digest/+page.svelte` | UI |

---

### Task 1: Types, schema and DTO plumbing

**Files:**
- Modify: `src/lib/types/mail.ts`
- Modify: `src/lib/server/db/schema.ts`
- Modify: `src/lib/remote/mail.remote.ts`

**Interfaces:**
- Produces: `Facts` (`{ dates, amounts, links:[{label,url}], people }`), `MessageDetails` (`{ keyPoints, askOfYou, deadlines }`), `ThreadNarrative` (`{ summary, highlights }`); `messageDtoSchema` gains `facts`, `spokenText`, optional `threadCount`; `threadSummary` table (`accountId`, `threadId`, `summary`, `highlights`, `messageCount`).

- [x] **Step 1 — add the three schemas to `src/lib/types/mail.ts`, directly above `classificationSchema`**

```ts
/** Structured facts worth remembering from a message (dates, amounts, links, people). */
export const factsSchema = v.object({
	dates: v.optional(v.array(v.string()), []),
	amounts: v.optional(v.array(v.string()), []),
	links: v.optional(
		v.array(v.object({ label: v.string(), url: v.string() })),
		[]
	),
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
```

- [x] **Step 2 — in the same file, give `classificationSchema` a `facts` field**

```ts
export const classificationSchema = v.object({
	category: categorySchema,
	summary: v.pipe(v.string(), v.maxLength(400)),
	priority: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	actionItems: v.array(v.string()),
	/** Defaults to empty so an older model that omits facts still classifies. */
	facts: v.optional(factsSchema, NO_FACTS)
});
```

- [x] **Step 3 — extend `messageDtoSchema`, `inboxItemSchema`, `digestItemSchema` in the same file**

```ts
	actionItems: v.array(v.string()),
	facts: v.nullable(factsSchema),
	/** TTS-friendly rewrite of a long body — omitted from the list view. */
	spokenText: v.nullable(v.string()),
	/** Messages in this conversation (local sync); only `getMessage` fills it. */
	threadCount: v.optional(v.number()),
	organizedAt: v.nullable(v.date()),
```

```ts
/** List view — no bodies, so an inbox page stays light. */
export const inboxItemSchema = v.omit(messageDtoSchema, ['bodyText', 'labelIds', 'spokenText']);
```

```ts
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
```

- [x] **Step 4 — columns and table in `src/lib/server/db/schema.ts`**

Add `jsonb` to the `drizzle-orm/pg-core` import and `import type { Facts } from '$lib/types/mail';`. Inside the `message` table, after `organizeError:`:

```ts
		organizeError: text('organize_error'),
		/** Structured facts from the classification — jsonb, never written to Gmail. */
		facts: jsonb('facts').$type<Facts | null>(),
		/** Bullet "Details" card as JSON text — cached after the first open. */
		details: text('details'),
		detailsAt: timestamp('details_at'),
		/** Spoken rewrite of a long body — cached after the first play. */
		spokenText: text('spoken_text'),
		spokenAt: timestamp('spoken_at'),
```

Add `index('message_account_thread_idx').on(t.accountId, t.threadId)` to the index list, and after the `message` table:

```ts
/**
 * One summary per conversation, shared by every message in the thread.
 * Generated on demand, then cached — the AI is never asked twice.
 */
export const threadSummary = pgTable(
	'thread_summary',
	{
		id: id(),
		accountId: text('account_id')
			.notNull()
			.references(() => mailAccount.id, { onDelete: 'cascade' }),
		threadId: text('thread_id').notNull(),
		summary: text('summary').notNull().default(''),
		highlights: text('highlights').array().notNull().default([]),
		messageCount: integer('message_count').notNull().default(0),
		generatedAt: timestamp('generated_at').defaultNow().notNull()
	},
	(t) => [uniqueIndex('thread_summary_account_thread_unique').on(t.accountId, t.threadId)]
);
```

- [x] **Step 5 — map the new fields in `src/lib/remote/mail.remote.ts`**

In `toInboxItem` / `toMessageDto` (they share one body — add after `actionItems`):

```ts
		actionItems: row.actionItems ?? [],
		facts: row.facts ?? null,
		spokenText: row.spokenText,
		organizedAt: row.organizedAt,
```

Add `count` to the `drizzle-orm` import, then make `getMessage` count its conversation:

```ts
export const getMessage = query(v.string(), async (id): Promise<MessageDto> => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	const [row] = await db
		.select()
		.from(message)
		.where(and(eq(message.id, id), inArray(message.accountId, accountIds)));
	if (!row) error(404, 'Message not found');
	const [{ count: threadCount }] = await db
		.select({ count: count() })
		.from(message)
		.where(and(eq(message.accountId, row.accountId), eq(message.threadId, row.threadId)));
	return { ...toMessageDto(row), threadCount };
});
```

In `getDigest`, pass facts into the parse (it validates with `digestItemSchema`):

```ts
			actionItems: row.actionItems,
			facts: row.facts
		})
```

- [x] **Step 6 — migrate** (applied 2026-09-27 via `bunx drizzle-kit push --force` — plain `db:push` needs a TTY for its confirmation prompt)

Run: `bun run db:push`
Expected: Drizzle lists **5 ADD COLUMN** on `message` and **CREATE TABLE `thread_summary`** — nothing dropped. Neon, additive only.

- [x] **Step 7 — type-check**

Run: `bun run check`
Expected: `0 errors and 0 warnings` (facts are `null` everywhere until Task 2).

- [ ] **Step 8 — commit**

```bash
git add src/lib/types/mail.ts src/lib/server/db/schema.ts src/lib/remote/mail.remote.ts
git commit -m "feat(db): facts, details, spoken text and thread summary"
```

---

### Task 2: Facts ride along with the classification

**Files:**
- Modify: `src/lib/server/ai.ts`
- Modify: `src/lib/server/organize.ts`
- Modify: `src/lib/remote/ai.remote.ts`

**Interfaces:**
- Consumes: `factsSchema`, `NO_FACTS`, `Facts` (Task 1).
- Produces: `Classification` now always carries `facts`; every organize path writes `message.facts`.

- [x] **Step 1 — `src/lib/server/ai.ts`: import the schema**

```ts
import {
	classificationSchema,
	factsSchema,
	NO_FACTS,
	type Classification,
	type Facts,
	type MessageDetails,
	type ThreadNarrative
} from '$lib/types/mail';
```

- [x] **Step 2 — teach the system prompt about facts (replace the `Rules:` block and the JSON example)**

```ts
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
```

- [x] **Step 3 — accept `facts` in `entrySchema` and return it**

```ts
const entrySchema = v.object({
	gmailId: v.string(),
	category: classificationSchema.entries.category,
	summary: v.pipe(v.string(), v.maxLength(400)),
	priority: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
	actionItems: v.optional(v.array(v.string()), []),
	facts: v.optional(factsSchema, NO_FACTS)
});
```

In `organizeBatch`'s map loop:

```ts
		out.set(entry.gmailId, {
			category: entry.category,
			summary: entry.summary,
			priority: entry.priority,
			actionItems: entry.actionItems,
			facts: entry.facts ?? NO_FACTS
		});
```

- [x] **Step 4 — persist facts in both write paths**

`src/lib/server/organize.ts` (inside the successful `.set({...})`):

```ts
						actionItems: classification.actionItems,
						facts: classification.facts,
						organizedAt: new Date(),
```

`src/lib/remote/ai.remote.ts` (`regenerateSummary`'s `.set({...})`):

```ts
		actionItems: classification.actionItems,
		facts: classification.facts,
		organizedAt: new Date(),
```

- [ ] **Step 5 — verify the code, then verify live**

Run: `bun run check`
Expected: `0 errors and 0 warnings`.

Runtime: open one message → **Re-organize**, then grep the dev terminal:

```bash
grep -c '"facts"' <dev-server-log>
```

Expected: the `[ai] → request` line contains `"facts":[…]`, and the message card shows fact chips (until Task 6 renders them, confirm in the DB):

```bash
bun -e 'import postgres from "postgres"; const sql = postgres(process.env.DATABASE_URL,{ssl:"require",max:1}); console.log(await sql`select facts from message where facts is not null limit 3`); await sql.end();'
```

- [ ] **Step 6 — commit**

```bash
git add src/lib/server/ai.ts src/lib/server/organize.ts src/lib/remote/ai.remote.ts
git commit -m "feat(ai): extract facts with the classification"
```

---

### Task 3: On-demand message details

**Files:**
- Modify: `src/lib/server/ai.ts`
- Modify: `src/lib/remote/ai.remote.ts`

**Interfaces:**
- Produces: `askJson<T>(config, messages, parse): Promise<T>`; `detailsFor(config, input: OrganizeInput): Promise<MessageDetails>`; `loadDetails(id): Promise<{ id, details: MessageDetails, cached: boolean }>` (command).

- [x] **Step 1 — `src/lib/server/ai.ts`: add `askJson` after `extractJson`**

```ts
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
```

- [x] **Step 2 — rebuild `organizeBatch` on top of it (replaces the whole function body)**

```ts
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
```

- [x] **Step 3 — add the details prompt and helper (below `organizeBatch`)**

```ts
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
```

(`detailsSchema` comes from `$lib/types/mail` — add it to the Task 1 import.)

- [x] **Step 4 — `src/lib/remote/ai.remote.ts`: shared ownership check + the command**

After the existing imports, add a helper and use it in `regenerateSummary` (replacing its inline account-lookup block):

```ts
/** The caller's own message — 404 otherwise (IDOR guard, same rule everywhere). */
async function ownedMessage(userId: string, id: string) {
	const accountIds = await db
		.select({ id: mailAccount.id })
		.from(mailAccount)
		.where(eq(mailAccount.userId, userId))
		.then((rows) => rows.map((r) => r.id));
	const [row] = await db.select().from(message).where(eq(message.id, id));
	if (!row || !accountIds.includes(row.accountId)) error(404, 'Message not found');
	return row;
}
```

New command (imports: `detailsFor` from `$lib/server/ai`, `type MessageDetails` from `$lib/types/mail`):

```ts
/** Bullet details for one message — generated on first open, then served from the row. */
export const loadDetails = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const target = await ownedMessage(user.id, id);
	if (target.details) {
		return { id, details: JSON.parse(target.details) as MessageDetails, cached: true };
	}

	const details = await detailsFor(aiConfig, {
		gmailId: target.gmailId,
		subject: target.subject,
		from: target.fromEmail,
		body: target.bodyText || target.subject
	});
	await db
		.update(message)
		.set({ details: JSON.stringify(details), detailsAt: new Date() })
		.where(eq(message.id, target.id));

	void getMessage(id).refresh();
	return { id, details, cached: false };
});
```

- [x] **Step 5 — export it from `src/lib/remote/index.ts`**

```ts
export { organizeMail, regenerateSummary, loadDetails, loadListenScript } from './ai.remote';
```

- [x] **Step 6 — verify** (live: `detailsFor` → 6 keyPoints, askOfYou, deadlines in 9.8s)

Run: `bun run check` → `0 errors and 0 warnings`. Live: pressing the (Task 6) Details button should print one `[ai] → POST` and one `[ai] validated…`-free success; until then confirm from the server by calling it once through the UI-less path — `grep '\[ai\]' <log>` after `Re-organize` still shows the old behaviour, so defer the live click to Task 6.

- [ ] **Step 7 — commit**

```bash
git add src/lib/server/ai.ts src/lib/remote/ai.remote.ts src/lib/remote/index.ts
git commit -m "feat(ai): on-demand message details"
```

---

### Task 4: Conversation summary

**Files:**
- Modify: `src/lib/server/gmail.ts`
- Modify: `src/lib/server/ai.ts`
- Modify: `src/lib/remote/mail.remote.ts`
- Modify: `src/lib/remote/index.ts`

**Interfaces:**
- Produces: `getThread(token, threadId): Promise<GmailMessage[]>`; `threadSummaryFor(config, entries): Promise<ThreadNarrative>`; `loadThreadSummary(id): Promise<{ threadId, summary, highlights, messageCount, cached }>` (command, lives in `mail.remote.ts` because it owns token access).

- [x] **Step 1 — `src/lib/server/gmail.ts`: add `getThread` next to `fetchMessages`**

```ts
export type GmailThread = { id?: string; messages?: GmailMessage[] };

/** The whole conversation — read-only `threads.get`, same scope as message calls. */
export async function getThread(token: string, threadId: string): Promise<GmailMessage[]> {
	const data = await request<GmailThread>(token, `/threads/${threadId}?format=full`);
	return data.messages ?? [];
}
```

- [x] **Step 2 — `src/lib/server/ai.ts`: the thread prompt and helper**

```ts
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
				content: JSON.stringify(
					entries.map((e) => ({ ...e, body: e.body.slice(0, 3000) }))
				)
			}
		],
		(raw) => v.parse(threadNarrativeSchema, raw)
	);
}
```

(`threadNarrativeSchema` joins the Task 1 import.)

- [x] **Step 3 — `src/lib/remote/mail.remote.ts`: the command**

Add `threadSummary` to the schema import, `threadSummaryFor` from `$lib/server/ai`, `type ThreadNarrative` from `$lib/types/mail`, then:

```ts
type ThreadEntry = { from: string; receivedAt: Date; body: string };

/** Live thread first (older mail predates the sync window), else what we synced. */
async function threadEntries(
	account: typeof mailAccount.$inferSelect,
	target: typeof message.$inferSelect
): Promise<ThreadEntry[]> {
	try {
		const messages = await gmailApi.getThread(await accessTokenFor(account), target.threadId);
		return messages.map(gmailApi.parseMessage).map((m) => ({
			from: m.fromEmail,
			receivedAt: m.receivedAt,
			body: m.bodyText
		}));
	} catch (error) {
		console.log(`[organize] thread fetch failed, using synced rows: ${String(error)}`);
		const rows = await db
			.select()
			.from(message)
			.where(and(eq(message.accountId, target.accountId), eq(message.threadId, target.threadId)))
			.orderBy(asc(message.receivedAt));
		return rows.map((r) => ({
			from: r.fromEmail,
			receivedAt: r.receivedAt,
			body: r.bodyText || r.subject
		}));
	}
}

/** One summary for the whole conversation — generated once, then cached per thread. */
export const loadThreadSummary = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const target = await db.select().from(message).where(eq(message.id, id)).then((r) => r[0]);
	if (!target) error(404, 'Message not found');
	const account = await db
		.select()
		.from(mailAccount)
		.where(eq(mailAccount.id, target.accountId))
		.then((r) => r[0]);
	if (!account || account.userId !== user.id) error(404, 'Message not found');

	const [cached] = await db
		.select()
		.from(threadSummary)
		.where(
			and(
				eq(threadSummary.accountId, target.accountId),
				eq(threadSummary.threadId, target.threadId)
			)
		);
	if (cached) {
		return {
			threadId: cached.threadId,
			summary: cached.summary,
			highlights: cached.highlights,
			messageCount: cached.messageCount,
			cached: true
		};
	}

	const entries = await threadEntries(account, target);
	if (entries.length === 0) error(400, 'No messages found in this conversation.');
	const narrative: ThreadNarrative = await threadSummaryFor(
		aiConfig,
		entries.map((e) => ({ from: e.from, receivedAt: e.receivedAt.toISOString(), body: e.body }))
	);

	const values = {
		accountId: target.accountId,
		threadId: target.threadId,
		summary: narrative.summary,
		highlights: narrative.highlights,
		messageCount: entries.length,
		generatedAt: new Date()
	};
	await db
		.insert(threadSummary)
		.values(values)
		.onConflictDoUpdate({
			target: [threadSummary.accountId, threadSummary.threadId],
			set: values
		});

	void getMessage(id).refresh();
	return { threadId: target.threadId, ...narrative, messageCount: entries.length, cached: false };
});
```

Also add `getAiConfig` to the imports from `$lib/server/settings` (it is already imported — verify before adding a duplicate).

- [x] **Step 4 — export it: `src/lib/remote/index.ts`**

```ts
export {
	connectGmail,
	syncMail,
	getInbox,
	getMessage,
	getDigest,
	getAccountStatus,
	markDigested,
	loadThreadSummary
} from './mail.remote';
```

- [x] **Step 5 — verify** (live: real 2-message GitHub thread → 5 highlights + summary in 2.0s)

Run: `bun run check` → `0 errors and 0 warnings`.

- [ ] **Step 6 — commit**

```bash
git add src/lib/server/gmail.ts src/lib/server/ai.ts src/lib/remote/mail.remote.ts src/lib/remote/index.ts
git commit -m "feat(ai): on-demand conversation summary"
```

---

### Task 5: Listen script

**Files:**
- Modify: `src/lib/server/ai.ts`
- Modify: `src/lib/remote/ai.remote.ts`

**Interfaces:**
- Produces: `listenScriptFor(config, input: OrganizeInput): Promise<string>`; `loadListenScript(id): Promise<{ id, spokenText, cached }>` (command).

- [x] **Step 1 — `src/lib/server/ai.ts`: prompt, schema and helper**

```ts
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
```

- [x] **Step 2 — `src/lib/remote/ai.remote.ts`: the command (imports `listenScriptFor`)**

```ts
/** Spoken rewrite of a long body — generated on first play, then served from the row. */
export const loadListenScript = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const target = await ownedMessage(user.id, id);
	if (target.spokenText) return { id, spokenText: target.spokenText, cached: true };

	const spokenText = await listenScriptFor(aiConfig, {
		gmailId: target.gmailId,
		subject: target.subject,
		from: target.fromEmail,
		body: target.bodyText || target.subject
	});
	await db
		.update(message)
		.set({ spokenText, spokenAt: new Date() })
		.where(eq(message.id, target.id));

	void getMessage(id).refresh();
	return { id, spokenText, cached: false };
});
```

- [x] **Step 3 — verify** (live: 29k-char body → 1442 words, no URLs, 96.7s — slow, see note)

Run: `bun run check` → `0 errors and 0 warnings`.

- [ ] **Step 4 — commit**

```bash
git add src/lib/server/ai.ts src/lib/remote/ai.remote.ts
git commit -m "feat(ai): on-demand listen script for long mail"
```

---

### Task 6: UI — chips, Details card, Conversation card, Make listenable

**Files:**
- Create: `src/lib/components/inbox/facts-chips.svelte`
- Modify: `src/lib/components/inbox/message-card.svelte`
- Modify: `src/lib/components/inbox/message-panel.svelte`
- Modify: `src/routes/(app)/digest/+page.svelte`

**Interfaces:**
- Consumes: `loadDetails`, `loadThreadSummary`, `loadListenScript` (Tasks 3–5), `Facts` / `MessageDetails` types (Task 1), `full.threadCount` / `full.spokenText` (Task 1).
- Produces: `<FactsChips facts={...} />` usable anywhere an item renders.

- [x] **Step 1 — create `src/lib/components/inbox/facts-chips.svelte`**

```svelte
<script lang="ts">
	import { BadgeDollarSign, CalendarDays, Link2, Users } from '@lucide/svelte';
	import type { Facts } from '$lib/types/mail';

	let { facts }: { facts: Facts | null } = $props();

	const dates = $derived(facts?.dates ?? []);
	const amounts = $derived(facts?.amounts ?? []);
	const links = $derived(facts?.links ?? []);
	const people = $derived(facts?.people ?? []);
</script>

{#if dates.length > 0 || amounts.length > 0 || links.length > 0 || people.length > 0}
	<div class="mt-2 flex flex-wrap gap-1.5">
		{#each dates as date (date)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<CalendarDays class="size-3" /> {date}
			</span>
		{/each}
		{#each amounts as amount (amount)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<BadgeDollarSign class="size-3" /> {amount}
			</span>
		{/each}
		{#each links as link (link.url)}
			<a
				href={link.url}
				target="_blank"
				rel="noopener noreferrer"
				class="inline-flex max-w-48 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-primary hover:underline"
			>
				<Link2 class="size-3 shrink-0" />
				<span class="truncate">{link.label || link.url}</span>
			</a>
		{/each}
		{#each people as person (person)}
			<span
				class="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
			>
				<Users class="size-3" /> {person}
			</span>
		{/each}
	</div>
{/if}
```

- [x] **Step 2 — chips in the list card: `message-card.svelte`**

Add `import FactsChips from './facts-chips.svelte';` after the existing imports, and after the `{#if item.summary} … {:else} … {/if}` block inside the text column:

```svelte
			<FactsChips facts={item.facts} />
```

- [x] **Step 3 — chips in the digest: `src/routes/(app)/digest/+page.svelte`**

Add `import FactsChips from '$lib/components/inbox/facts-chips.svelte';`, and after the summary paragraph (`<p class="mt-2 text-sm text-muted-foreground">{item.summary}</p>`):

```svelte
								<FactsChips facts={item.facts} />
```

- [x] **Step 4 — `message-panel.svelte`: imports and state**

```svelte
	import { toast } from 'svelte-sonner';
	import { AudioLines, ListTree, LoaderCircle, MessagesSquare, RefreshCw, Volume2, WandSparkles } from '@lucide/svelte';
	import FactsChips from './facts-chips.svelte';
	import { getMessage, getInbox, loadDetails, loadListenScript, loadThreadSummary, regenerateSummary } from '$lib/remote';
	import type { MessageDetails } from '$lib/types/mail';
```

Inside `<script>`, after `let reorganizing = $state(false);`:

```ts
	let details = $state<MessageDetails | null>(null);
	let thread = $state<{ summary: string; highlights: string[]; messageCount: number } | null>(null);
	let spokenText = $state<string | null>(null);
	let loadingDetails = $state(false);
	let loadingThread = $state(false);
	let loadingSpoken = $state(false);

	/** The dialog swaps `item` without remounting — drop the previous message's AI state. */
	$effect(() => {
		const id = item.id;
		details = null;
		thread = null;
		spokenText = null;
		loadingDetails = false;
		loadingThread = false;
		loadingSpoken = false;
		void id;
	});

	async function showDetails() {
		loadingDetails = true;
		try {
			details = (await loadDetails(item.id)).details;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingDetails = false;
		}
	}

	async function summarizeThread() {
		loadingThread = true;
		try {
			thread = await loadThreadSummary(item.id);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingThread = false;
		}
	}

	async function makeListenable() {
		loadingSpoken = true;
		try {
			spokenText = (await loadListenScript(item.id)).spokenText;
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			loadingSpoken = false;
		}
	}
```

Change `reorganize()`'s `console.error(errorMessage(error))` to `toast.error(errorMessage(error))`.

- [x] **Step 5 — chips + Details card in the panel**

After the summary block (`{#if item.summary} … {/if}`), still inside `<div class="space-y-4">`:

```svelte
	<FactsChips facts={item.facts} />

	<section class="border-t border-border pt-3">
		<div class="flex items-center justify-between gap-2">
			<h4 class="text-xs tracking-widest text-muted-foreground uppercase">Details</h4>
			<Button variant="ghost" size="sm" onclick={showDetails} disabled={loadingDetails}>
				{#if loadingDetails}
					<LoaderCircle class="size-4 animate-spin" /> Thinking…
				{:else}
					<ListTree class="size-4" /> {details ? 'Refresh' : 'Details'}
				{/if}
			</Button>
		</div>
		{#if details}
			<ul class="mt-2 space-y-1">
				{#each details.keyPoints as point, i (i)}
					<li class="flex gap-2 text-sm text-muted-foreground">
						<span class="text-primary">→</span>{point}
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-sm"><span class="text-xs tracking-widest text-muted-foreground uppercase">Asks of you</span> {details.askOfYou}</p>
			{#if details.deadlines.length > 0}
				<p class="mt-1 text-xs text-muted-foreground">Deadlines: {details.deadlines.join(' · ')}</p>
			{/if}
		{:else}
			<p class="mt-1 text-xs text-muted-foreground/70">
				One AI call the first time — bullets, what it's asking of you, and every deadline.
			</p>
		{/if}
	</section>
```

- [x] **Step 6 — Conversation card + Make listenable inside `{:then full}`**

After the body block and before the Player row, and after the Player row respectively:

```svelte
		{#if (full.threadCount ?? 0) > 1}
			<section class="border-t border-border pt-3">
				<h4 class="text-xs tracking-widest text-muted-foreground uppercase">
					Conversation · {thread?.messageCount ?? full.threadCount} messages
				</h4>
				{#if thread}
					<p class="mt-2 text-sm">{thread.summary}</p>
					{#if thread.highlights.length > 0}
						<ul class="mt-2 space-y-1">
							{#each thread.highlights as highlight, i (i)}
								<li class="flex gap-2 text-xs text-muted-foreground">
									<span class="text-primary">·</span>{highlight}
								</li>
							{/each}
						</ul>
					{/if}
				{:else}
					<p class="mt-1 text-xs text-muted-foreground/70">
						One summary for the whole conversation, not just this message.
					</p>
					<Button class="mt-2" variant="outline" size="sm" onclick={summarizeThread} disabled={loadingThread}>
						{#if loadingThread}
							<LoaderCircle class="size-4 animate-spin" /> Summarizing…
						{:else}
							<WandSparkles class="size-4" /> Summarize conversation
						{/if}
					</Button>
				{/if}
			</section>
		{/if}
```

```svelte
		{@const spoken = spokenText ?? full.spokenText}
		<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
			<Volume2 class="size-4 shrink-0 text-primary" />
			<div class="min-w-0 flex-1">
				<Player
					compact
					{engine}
					{voice}
					items={[
						{
							id: item.id,
							title: item.subject,
							text:
								spoken ??
								[item.summary ?? '', full.bodyText].filter(Boolean).join('\n\n').slice(0, 2000)
						}
					]}
				/>
			</div>
			{#if !spoken && (full.bodyText?.length ?? 0) > 1200}
				<Button variant="outline" size="sm" onclick={makeListenable} disabled={loadingSpoken}>
					{#if loadingSpoken}
						<LoaderCircle class="size-4 animate-spin" /> Making listenable…
					{:else}
						<AudioLines class="size-4" /> Make listenable
					{/if}
				</Button>
			{/if}
		</div>
```

- [ ] **Step 7 — verify**

Run: `bun run check` → `0 errors and 0 warnings`, then `bunx prettier --write src/lib/components/inbox/facts-chips.svelte src/lib/components/inbox/message-card.svelte src/lib/components/inbox/message-panel.svelte "src/routes/(app)/digest/+page.svelte"`.

- [ ] **Step 8 — commit**

```bash
git add src/lib/components/inbox/facts-chips.svelte src/lib/components/inbox/message-card.svelte src/lib/components/inbox/message-panel.svelte "src/routes/(app)/digest/+page.svelte"
git commit -m "feat(ui): facts chips, details, conversation and listen button"
```

---

### Task 7: Validation pass

**Files:**
- Modify: `docs/plans/2026-09-27-ai-reading-features-design.md` (`status: approved` → `status: shipped`)

- [ ] **Step 1 — static gates**

Run: `bun run check`
Expected: `0 errors and 0 warnings`. Then run the Svelte autofixer on `facts-chips.svelte`, `message-card.svelte`, `message-panel.svelte`, `digest/+page.svelte` and apply anything it flags.

- [ ] **Step 2 — live pass (Michael's browser, one message each)**

1. Open a message → **Details** → one `[ai] → POST` in the dev log, bullets render; click again → instant (cached, no new POST).
2. Open a multi-message thread → **Summarize conversation** → summary + highlights; refresh → still there (no second POST).
3. Open a long mail → **Make listenable** → player reads the rewrite; refresh → button gone.
4. Check the list card and digest for fact chips after **Re-organize**.
5. Confirm `grep -c '\[ai\] →' <log>` matches expectations (one call per feature per message, ever).

- [ ] **Step 3 — commit**

```bash
git add docs/plans/2026-09-27-ai-reading-features-design.md
git commit -m "docs(plans): mark AI reading features shipped"
```
