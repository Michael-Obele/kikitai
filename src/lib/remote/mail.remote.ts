import { error } from '@sveltejs/kit';
import { command, query, requested } from '$app/server';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, or } from 'drizzle-orm';
import * as v from 'valibot';
import { requireUser } from '$lib/server/session';
import { db } from '$lib/server/db';
import { account, mailAccount, message, threadSummary } from '$lib/server/db/schema';
import * as gmailApi from '$lib/server/gmail';
import { decrypt, encrypt } from '$lib/server/tokens';
import { getAiConfig, getSettings } from '$lib/server/settings';
import { threadSummaryFor } from '$lib/server/ai';
import { cleanedBody } from '$lib/server/clean-body';
import { organizePending } from '$lib/server/organize';
import {
	categorySchema,
	digestItemSchema,
	inboxFilterSchema,
	messageDtoSchema,
	type InboxItem,
	type MessageDto,
	type SyncResult,
	type ThreadNarrative
} from '$lib/types/mail';

const safeCategory = (raw: string | null) => {
	if (!raw) return null;
	const parsed = v.safeParse(categorySchema, raw);
	return parsed.success ? parsed.output : null;
};

function toInboxItem(row: typeof message.$inferSelect): InboxItem {
	return {
		id: row.id,
		gmailId: row.gmailId,
		subject: row.subject,
		fromName: row.fromName,
		fromEmail: row.fromEmail,
		receivedAt: row.receivedAt,
		snippet: row.snippet,
		category: safeCategory(row.category),
		summary: row.summary,
		priority: row.priority,
		actionItems: row.actionItems ?? [],
		facts: row.facts ?? null,
		organizedAt: row.organizedAt,
		organizeError: row.organizeError,
		isDigested: row.isDigested
	};
}

function toMessageDto(row: typeof message.$inferSelect): MessageDto {
	return {
		...toInboxItem(row),
		bodyText: row.bodyText,
		labelIds: row.labelIds ?? [],
		spokenText: row.spokenText,
		cleanBody: row.cleanBody
	};
}

async function ownedAccountIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: mailAccount.id })
		.from(mailAccount)
		.where(eq(mailAccount.userId, userId));
	return rows.map((r) => r.id);
}

/** A still-valid access token, refreshed transparently when Google expires it. */
async function accessTokenFor(account: typeof mailAccount.$inferSelect): Promise<string> {
	const stored = decrypt(account.accessToken);
	const expiresAt = account.accessTokenExpiresAt?.getTime() ?? 0;
	if (!account.refreshToken) return stored;
	if (expiresAt - Date.now() > 60_000) return stored;
	try {
		const refreshed = await gmailApi.refreshAccessToken(decrypt(account.refreshToken));
		const encrypted = encrypt(refreshed.accessToken);
		await db
			.update(mailAccount)
			.set({
				accessToken: encrypted,
				accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
				updatedAt: new Date()
			})
			.where(eq(mailAccount.id, account.id));
		return refreshed.accessToken;
	} catch {
		// Refresh can fail transiently — try the stored token before giving up.
		return stored;
	}
}

/** Connection state for the inbox empty/first-run states. */
export const getAccountStatus = query(async () => {
	const { user } = await requireUser();
	const rows = await db.select().from(mailAccount).where(eq(mailAccount.userId, user.id));
	return {
		connected: rows.length > 0,
		addresses: rows.map((row) => row.gmailAddress),
		lastSyncAt: rows[0]?.lastSyncAt ?? null,
		windowDays: rows.length > 0 ? (await getSettings(user.id)).syncWindowDays : null
	};
});

/**
 * Copy the Google tokens Better Auth collected at sign-in into our own
 * encrypted store (the only place Gmail credentials live after that).
 */
export const connectGmail = command(async () => {
	const { user } = await requireUser();
	const [linked] = await db
		.select()
		.from(account)
		.where(and(eq(account.userId, user.id), eq(account.providerId, 'google')));

	if (!linked?.accessToken) {
		error(
			400,
			'No Google tokens yet. Sign in with Google (approve read-only Gmail access), then press Connect again.'
		);
	}

	const values = {
		userId: user.id,
		gmailAddress: user.email,
		accessToken: encrypt(linked.accessToken),
		refreshToken: encrypt(linked.refreshToken ?? linked.accessToken),
		scope: linked.scope ?? '',
		accessTokenExpiresAt: linked.accessTokenExpiresAt ?? new Date(Date.now() + 3600_000),
		updatedAt: new Date()
	};

	await db
		.insert(mailAccount)
		.values(values)
		.onConflictDoUpdate({ target: [mailAccount.userId, mailAccount.gmailAddress], set: values });

	// queries are keyed by their arguments, so refresh what the client actually rendered
	await requested(getInbox, 10).refreshAll();
	return { address: user.email };
});

/** Pull the inbox window from Gmail, then organize anything new. */
export const syncMail = command(async (): Promise<SyncResult> => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	if (accountIds.length === 0) error(400, 'Connect a Gmail account first.');

	const settings = await getSettings(user.id);
	const aiConfig = await getAiConfig(user.id);
	const result: SyncResult = { fetched: 0, added: 0, organized: 0, failed: 0 };

	const accounts = await db.select().from(mailAccount).where(eq(mailAccount.userId, user.id));
	for (const acct of accounts) {
		try {
			const token = await accessTokenFor(acct);
			const { ids } = await gmailApi.listMessageIds(token, { windowDays: settings.syncWindowDays });
			result.fetched += ids.length;

			const raws = await gmailApi.fetchMessages(token, ids);
			for (const raw of raws) {
				const parsed = gmailApi.parseMessage(raw);
				const inserted = await db
					.insert(message)
					.values({
						accountId: acct.id,
						gmailId: parsed.gmailId,
						threadId: parsed.threadId,
						subject: parsed.subject,
						fromName: parsed.fromName,
						fromEmail: parsed.fromEmail,
						receivedAt: parsed.receivedAt,
						snippet: parsed.snippet,
						bodyText: parsed.bodyText,
						labelIds: parsed.labelIds
					})
					.onConflictDoNothing()
					.returning({ id: message.id });
				if (inserted.length > 0) result.added += inserted.length;
			}

			const organized = await organizePending(aiConfig, acct.id);
			result.organized += organized.organized;
			result.failed += organized.failed;

			await db
				.update(mailAccount)
				.set({ lastSyncAt: new Date() })
				.where(eq(mailAccount.id, acct.id));
		} catch (err) {
			result.failed++;
			if (err instanceof gmailApi.GmailError && err.status === 401) {
				error(401, 'Gmail rejected the stored token — reconnect your account in Settings.');
			}
		}
	}

	await requested(getInbox, 10).refreshAll();
	await requested(getDigest, 10).refreshAll();
	return result;
});

const INBOX_LIMIT = 200;

export const getInbox = query(inboxFilterSchema, async (filter): Promise<InboxItem[]> => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	if (accountIds.length === 0) return [];

	const conditions = [inArray(message.accountId, accountIds)];
	if (filter.category && filter.category !== 'all')
		conditions.push(eq(message.category, filter.category));
	if (filter.priority === 'high') conditions.push(gte(message.priority, 4));
	if (filter.priority === 'unorganized') conditions.push(isNull(message.organizedAt));
	if (filter.search) {
		const needle = `%${filter.search}%`;
		conditions.push(
			or(
				ilike(message.subject, needle),
				ilike(message.snippet, needle),
				ilike(message.fromName, needle)
			)!
		);
	}

	const rows = await db
		.select()
		.from(message)
		.where(and(...conditions))
		.orderBy(desc(message.receivedAt))
		.limit(INBOX_LIMIT);

	return rows.map(toInboxItem);
});

export const getMessage = query(v.string(), async (arg): Promise<MessageDto> => {
	// Callers may append `#<nonce>` to bust the client-side query cache — the
	// message panel does after a Simplify, so it never reads a stale cached row.
	const id = arg.split('#')[0];
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	const [row] = await db
		.select()
		.from(message)
		.where(and(eq(message.id, id), inArray(message.accountId, accountIds)));
	if (!row) error(404, 'Message not found');
	// No AI on open: the raw body renders instantly and the reader asks for a
	// simplification. Loading a message must never cost an inference — that wait
	// used to happen on every first open.
	const [{ count: threadCount }] = await db
		.select({ count: count() })
		.from(message)
		.where(and(eq(message.accountId, row.accountId), eq(message.threadId, row.threadId)));
	return { ...toMessageDto(row), threadCount };
});

/**
 * Simplify one body when the reader asks for it — the only path that spends an
 * AI call on a body, and `cleanedBody` stores the result, so each message is
 * simplified at most once ever (a failure retries next time, nothing wasted).
 */
export const simplifyMessage = command(v.string(), async (id): Promise<MessageDto> => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	const [row] = await db
		.select()
		.from(message)
		.where(and(eq(message.id, id), inArray(message.accountId, accountIds)));
	if (!row) error(404, 'Message not found');

	const clean = await cleanedBody(row, user.id);
	if (!clean) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');
	void getMessage(id).refresh();
	// Answer with the stored row itself: the client's query cache can lag behind
	// the single-flight refresh (it sometimes stays stale until a full reload), so
	// the panel renders the rewrite straight from this return value.
	const [fresh] = await db.select().from(message).where(eq(message.id, id));
	return toMessageDto(fresh ?? { ...row, cleanBody: clean, cleanedAt: new Date() });
});

/**
 * Today's listening list: important mail ordered for the ear —
 * highest priority first, then oldest first so the story reads in order.
 */
export const getDigest = query(async () => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	if (accountIds.length === 0) return [];

	const rows = await db
		.select()
		.from(message)
		.where(
			and(
				inArray(message.accountId, accountIds),
				or(gte(message.priority, 4), eq(message.category, 'needs_reply'))!
			)
		)
		.orderBy(asc(message.receivedAt))
		.limit(25);

	return rows
		.map(toInboxItem)
		.filter((row): row is InboxItem & { summary: string } => Boolean(row.summary))
		.map((row) =>
			v.parse(digestItemSchema, {
				id: row.id,
				subject: row.subject,
				fromName: row.fromName,
				summary: row.summary,
				priority: row.priority ?? 3,
				receivedAt: row.receivedAt,
				actionItems: row.actionItems,
				facts: row.facts
			})
		)
		.sort((a, b) => b.priority - a.priority || a.receivedAt.getTime() - b.receivedAt.getTime());
});

/** Mark a message as played so the digest can track progress. */
export const markDigested = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const accountIds = await ownedAccountIds(user.id);
	await db
		.update(message)
		.set({ isDigested: true })
		.where(and(eq(message.id, id), inArray(message.accountId, accountIds)));
	void getDigest().refresh();
});

type ThreadEntry = { from: string; receivedAt: Date; body: string };

/** Live thread first (older mail predates the sync window), else what we synced. */
async function threadEntries(
	account: typeof mailAccount.$inferSelect,
	target: typeof message.$inferSelect
): Promise<ThreadEntry[]> {
	try {
		const messages = await gmailApi.getThread(await accessTokenFor(account), target.threadId);
		return messages.map(gmailApi.parseMessage).map((parsed) => ({
			from: parsed.fromEmail,
			receivedAt: parsed.receivedAt,
			body: parsed.bodyText
		}));
	} catch (error) {
		console.log(`[organize] thread fetch failed, using synced rows: ${String(error)}`);
		const rows = await db
			.select()
			.from(message)
			.where(and(eq(message.accountId, target.accountId), eq(message.threadId, target.threadId)))
			.orderBy(asc(message.receivedAt));
		return rows.map((row) => ({
			from: row.fromEmail,
			receivedAt: row.receivedAt,
			body: row.bodyText || row.subject
		}));
	}
}

/** One summary for the whole conversation — generated once, then cached per thread. */
export const loadThreadSummary = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const target = await db
		.select()
		.from(message)
		.where(eq(message.id, id))
		.then((r) => r[0]);
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
