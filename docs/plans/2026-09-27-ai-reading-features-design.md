---
title: 'Kikitai — AI reading features (Details, Thread, Listen, Facts)'
status: approved
date: 2026-09-27
---

# Design — AI features that make reading mail easier

Approved by Michael, 2026-09-27. Scope chosen from research (Exa: Shortwave AI assistant,
Superhuman AI-native; Tomoshi: Superhuman Auto Summarize), deliberately excluding Q&A-over-a-message
and reply drafts (the latter stays on the post-v1 list).

## Why

The app already produces a ≤2-sentence summary, category, priority and action items per message,
plus a digest. What's missing for *reading*:

1. **Depth on demand** — Superhuman shows a 1-line summary with an expandable bullet view. We keep
   the 1-line summary and add the bullets behind a button.
2. **Thread context** — we store `threadId` but only ever summarize the newest message.
3. **A listenable version** — the Player truncates bodies at 2000 characters, so long mail is
   silently cut off when listened to.
4. **Facts** — dates, amounts, links and people are the things you scan for; they should be
   extractable, not hunted for.

## Decisions

| # | Question | Decision |
| --- | --- | --- |
| D1 | Which features? | Details bullets, Thread summary, Listen script, Key facts — **not** Q&A or reply drafts |
| D2 | When does the AI run? | **Hybrid**: facts ride along in the existing Organize call; Details / Thread / Listen generate on first use, then cache |
| D3 | Architecture | **Extend the existing pipeline** — reuse `chat()` + Valibot + one-retry; no generic tool-runner |

## 1 · Data model (additive migration — `bun run db:push`)

`message` gains:

- `facts` — jsonb, nullable: `{ dates: string[], amounts: string[], links: { label, url }[], people: string[] }`
- `details` — text, nullable (JSON string of the bullet card) + `details_at` timestamp
- `spoken_text` — text, nullable + `spoken_at` timestamp

New table `thread_summary`: `id`, `account_id`, `thread_id`, `summary`, `highlights` (text[]),
`message_count` (int), `generated_at`, unique on `(account_id, thread_id)` — one row per
conversation, shared by every message in it.

`types/mail.ts` gains `factsSchema` and `detailsSchema`; `facts` is added to `messageDtoSchema`
(so `inboxItemSchema`, derived with `v.omit`, carries it too — the list card can show chips).

## 2 · AI layer (`src/lib/server/ai.ts`)

- **Organize call gains a `facts` field** in the prompt and `entrySchema`, wrapped in
  `v.optional()` — a model that omits it never fails the batch, and there is no extra round-trip.
- `detailsFor(config, message)` → `{ keyPoints: string[], askOfYou: string, deadlines: string[] }`
- `threadSummaryFor(config, messages[])` → `{ summary: string, highlights: string[] }`
- `listenScriptFor(config, body, subject)` → spoken prose, ≤ ~1200 words: no URLs, markdown,
  emoji or HTML; dates, currency and abbreviations written out for TTS.

All four reuse `chat()`, so the `[ai]` request/response logs already in place cover them, and all
use the same Valibot parse + one-retry discipline.

## 3 · Remotes (single-flight refreshes)

- `loadDetails(messageId)` — command; generates on miss, caches, returns the fresh row.
- `loadThreadSummary(messageId)` — command; reads `thread_summary`, on miss fetches the thread
  through a new `gmail.getThread(token, threadId)` (`threads.get`, `gmail.readonly` covers it),
  falling back to locally synced messages of that thread, then caches.
- `loadListenScript(messageId)` — command; generates on miss, returns the script.

Each refreshes what the client rendered with `.updates(getMessage(id), getInbox)` on the client and
`requested(...)` on the server — the pattern fixed earlier today; `getInbox` refresh matters because
fact chips appear in the list.

## 4 · UI

| Surface | Element |
| --- | --- |
| list card · message panel · digest row | fact chips: `CalendarDays` (dates) · `BadgeDollarSign` (amounts) · `Link2` (links) · `Users` (people) |
| message panel | collapsible **Details** card — `ListTree` icon, `WandSparkles` while loading; bullets, "What it's asking of you", deadlines |
| message panel | **Conversation · N messages** card — `MessagesSquare`; summary, or a summarize button when absent; hidden for single-message threads |
| Player | prefers `spokenText`; bodies over ~1200 chars without a script show **Make listenable** (`AudioLines`) → spinner (~11s) → plays. Digest play-all prefers `spokenText` too |

Repo rules apply: Svelte 5 runes, remote `form` over `command` for input-less actions is not needed
here (these are data loads, not mutations), queries with an input schema take the arg everywhere.

## 5 · Errors and cost

- Any on-demand failure toasts through the existing `errorMessage()` and caches nothing, so the
  button simply retries.
- Missing `facts` degrade silently to "no chips" — organize itself can never fail because of them.
- Cost: **+0 calls** at organize time; **1 call** per expand, per thread, per long message —
  generated once and stored.

## 6 · Validation

`bun run check` → 0 errors / 0 warnings, `bun run format`, the Svelte autofixer on touched
components, then a live run in Michael's browser: open a message → Details → Thread → Make
listenable, with the `[ai]` / `[organize]` logs as evidence.

---

Back to [README](../plan/kikitai/README.md) · [architecture](../plan/kikitai/architecture.md)
