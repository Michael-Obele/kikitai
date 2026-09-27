import { error } from '@sveltejs/kit';
import { command, requested } from '$app/server';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { requireUser } from '$lib/server/session';
import { db } from '$lib/server/db';
import { mailAccount, message } from '$lib/server/db/schema';
import { detailsFor, listenScriptFor, organizeBatch } from '$lib/server/ai';
import { organizePending } from '$lib/server/organize';
import { getAiConfig } from '$lib/server/settings';
import type { MessageDetails } from '$lib/types/mail';
import { getInbox, getDigest, getMessage } from './mail.remote';

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

/** Organize every message that has not been organized yet. */
export const organizeMail = command(async () => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const accounts = await db.select().from(mailAccount).where(eq(mailAccount.userId, user.id));
	if (accounts.length === 0) error(400, 'Connect a Gmail account first.');

	let organized = 0;
	let failed = 0;
	for (const acct of accounts) {
		const result = await organizePending(aiConfig, acct.id);
		organized += result.organized;
		failed += result.failed;
	}

	await requested(getInbox, 10).refreshAll();
	await requested(getDigest, 10).refreshAll();
	return { organized, failed };
});

/** Re-run the AI for a single message (fixes a bad summary or category). */
export const regenerateSummary = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const target = await ownedMessage(user.id, id);

	const result = await organizeBatch(aiConfig, [
		{
			gmailId: target.gmailId,
			subject: target.subject,
			from: target.fromEmail,
			body: target.bodyText || target.subject
		}
	]);
	const classification = result.get(target.gmailId);
	if (!classification) error(502, 'The model returned nothing usable for this message.');

	await db
		.update(message)
		.set({
			category: classification.category,
			summary: classification.summary,
			priority: classification.priority,
			actionItems: classification.actionItems,
			facts: classification.facts,
			organizedAt: new Date(),
			organizeError: null
		})
		.where(eq(message.id, target.id));

	void getMessage(id).refresh();
	await requested(getInbox, 10).refreshAll();
	await requested(getDigest, 10).refreshAll();
	return { id: target.id };
});

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
