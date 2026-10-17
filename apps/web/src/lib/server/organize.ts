import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { message } from '$lib/server/db/schema';
import { batch, organizeBatch, type AiConfig } from './ai';

/**
 * Classify every message that has not been organized yet, then store the
 * result. Failures are non-fatal: the inbox still renders raw and
 * `organizeError` explains what went wrong per message.
 */
export async function organizePending(
	aiConfig: AiConfig | null,
	accountId: string
): Promise<{ organized: number; failed: number }> {
	if (!aiConfig) return { organized: 0, failed: 0 };

	const pending = await db
		.select({
			id: message.id,
			gmailId: message.gmailId,
			subject: message.subject,
			fromName: message.fromName,
			fromEmail: message.fromEmail,
			bodyText: message.bodyText
		})
		.from(message)
		.where(and(eq(message.accountId, accountId), isNull(message.organizedAt)));

	let organized = 0;
	let failed = 0;

	console.log(`[organize] account=${accountId} pending=${pending.length}`);

	for (const chunk of batch(pending, 10)) {
		console.log(`[organize] batch of ${chunk.length}: ${chunk.map((m) => m.gmailId).join(', ')}`);
		try {
			const result = await organizeBatch(
				aiConfig,
				chunk.map((m) => ({
					gmailId: m.gmailId,
					subject: m.subject,
					from: m.fromEmail,
					body: m.bodyText || m.subject
				}))
			);
			for (const row of chunk) {
				const classification = result.get(row.gmailId);
				if (!classification) {
					console.log(`[organize] no entry for ${row.gmailId} (${row.subject})`);
					failed++;
					await db
						.update(message)
						.set({ organizeError: 'The model returned no entry for this message' })
						.where(eq(message.id, row.id));
					continue;
				}
				organized++;
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
					.where(eq(message.id, row.id));
			}
		} catch (error) {
			failed += chunk.length;
			const reason = error instanceof Error ? error.message : String(error);
			console.log(`[organize] batch failed: ${reason}`);
			for (const row of chunk) {
				await db
					.update(message)
					.set({ organizeError: reason.slice(0, 300) })
					.where(eq(message.id, row.id));
			}
		}
	}

	return { organized, failed };
}
