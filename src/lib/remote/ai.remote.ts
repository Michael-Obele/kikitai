import { error } from '@sveltejs/kit';
import { command } from '$app/server';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { requireUser } from '$lib/server/session';
import { db } from '$lib/server/db';
import { mailAccount, message } from '$lib/server/db/schema';
import { organizeBatch } from '$lib/server/ai';
import { organizePending } from '$lib/server/organize';
import { getAiConfig } from '$lib/server/settings';
import { getInbox, getDigest } from './mail.remote';

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

	void getInbox({}).refresh();
	void getDigest().refresh();
	return { organized, failed };
});

/** Re-run the AI for a single message (fixes a bad summary or category). */
export const regenerateSummary = command(v.string(), async (id: string) => {
	const { user } = await requireUser();
	const aiConfig = await getAiConfig(user.id);
	if (!aiConfig) error(400, 'Set an AI endpoint (base URL + model) in Settings first.');

	const accountIds = await db
		.select({ id: mailAccount.id })
		.from(mailAccount)
		.where(eq(mailAccount.userId, user.id))
		.then((rows) => rows.map((r) => r.id));

	const [target] = await db.select().from(message).where(eq(message.id, id));
	if (!target || !accountIds.includes(target.accountId)) error(404, 'Message not found');

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
			organizedAt: new Date(),
			organizeError: null
		})
		.where(eq(message.id, target.id));

	void getInbox({}).refresh();
	void getDigest().refresh();
	return { id: target.id };
});
