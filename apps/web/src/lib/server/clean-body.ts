import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { message } from '$lib/server/db/schema';
import { cleanBodyFor } from '$lib/server/ai';
import { getAiConfig } from '$lib/server/settings';

/** One cleanup per message at a time — `getMessage` can be called twice at once. */
const cleaning = new Map<string, Promise<string>>();

/**
 * The AI-cleaned body: generated and stored the first time a message is opened,
 * a plain column read after that. A failure never blocks the message — the raw
 * body still renders.
 *
 * Lives here rather than in a `.remote.ts` file on purpose: those may only
 * export remote functions, and both `getMessage` and `loadListenScript` need
 * this.
 */
export async function cleanedBody(
	row: typeof message.$inferSelect,
	userId: string
): Promise<string | null> {
	if (row.cleanBody) return row.cleanBody;
	if (!row.bodyText.trim()) return null;
	const aiConfig = await getAiConfig(userId);
	if (!aiConfig) return null;

	let request = cleaning.get(row.id);
	if (!request) {
		request = (async () => {
			const clean = await cleanBodyFor(aiConfig, {
				gmailId: row.gmailId,
				subject: row.subject,
				from: row.fromEmail,
				body: row.bodyText
			});
			await db
				.update(message)
				.set({ cleanBody: clean, cleanedAt: new Date() })
				.where(eq(message.id, row.id));
			return clean;
		})();
		cleaning.set(row.id, request);
		void request
			.catch(() => {
				/* each caller handles its own rejection */
			})
			.finally(() => cleaning.delete(row.id));
	}
	return request;
}
