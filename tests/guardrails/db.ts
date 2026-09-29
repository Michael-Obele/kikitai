import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { mailAccount, message, settings, user } from '../../src/lib/server/db/schema';

/**
 * The probes need one signed-in account with one message behind it — the same
 * rows a real reader would have, kept strictly separate from real data: every
 * id starts with `guardrail-`, and `global-teardown.ts` deletes them again.
 *
 * The rows are seeded with SQL from the test process (not from the app) so the
 * harness never needs a dev-only route or a flag on the running server.
 */
export const PROBE_USER_ID = 'guardrail-probe-user';
export const PROBE_EMAIL = 'guardrail-probe@example.test';
export const PROBE_ACCOUNT_ID = 'guardrail-probe-account';
export const PROBE_MESSAGE_ID = 'guardrail-probe-message';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `.env` the way the dev server reads it — same DATABASE_URL, same database. */
function loadEnv(): void {
	const file = path.join(ROOT, '.env');
	if (!process.env.DATABASE_URL && existsSync(file)) process.loadEnvFile(file);
}

function makeDb() {
	loadEnv();
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set — the guardrails need the app database.');
	const client = postgres(url, { max: 1, connect_timeout: 15 });
	return { client, db: drizzle(client) };
}

export type Db = ReturnType<typeof makeDb>['db'];

/** Run something with a short-lived connection; always closes it. */
export async function withDb<T>(run: (db: Db) => Promise<T>): Promise<T> {
	const { client, db } = makeDb();
	try {
		return await run(db);
	} finally {
		await client.end({ timeout: 10 });
	}
}

/** Short sentences: a chunk plays in ~4s, so six chunks fit in a probe. */
const PROBE_SENTENCES = [
	'The morning train was late, so she bought a coffee she did not want.',
	'On the platform, a busker played the same three chords over and over.',
	'Nobody watched him, but he played as if the whole city were listening.',
	'A pigeon landed on the bench and stared at her with obvious judgement.',
	'She checked her phone twice, though she knew no message was coming.',
	'The sky threatened rain for the third day in a row and never delivered.',
	'When the train finally arrived, it was packed and slow and warm inside.',
	'She stood the whole way, holding the strap and reading the same headline.',
	'At her stop, an old man let her pass with a small and careful nod.',
	'The office was quiet, and her coffee had gone cold before she noticed.'
];

/** The message the no-remount probe opens — enough text to be worth reading. */
export const PROBE_SUMMARY = 'Guardrail probe: a seeded message that is never real mail.';
export const PROBE_BODY = `${PROBE_SENTENCES.join(' ')}\n\n${PROBE_SENTENCES.slice(0, 6).join(' ')}`;

/** Settings every playback probe starts from: the local engine, one voice. */
function defaultSettings() {
	return {
		ttsEngine: 'kitten',
		ttsVoice: 'Luna',
		ttsSpeed: 1,
		ttsRamp: false,
		updatedAt: new Date()
	};
}

/** Create (or re-normalise) the probe account — safe to run on every start. */
export async function seedProbe(db: Db): Promise<void> {
	const now = new Date();

	await db
		.insert(user)
		.values({
			id: PROBE_USER_ID,
			name: 'Guardrail probe',
			email: PROBE_EMAIL,
			emailVerified: true,
			image: null,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: user.id,
			set: { name: 'Guardrail probe', email: PROBE_EMAIL, updatedAt: now }
		});

	await db
		.insert(settings)
		.values({ userId: PROBE_USER_ID, aiBaseUrl: '', aiModel: '', ...defaultSettings() })
		.onConflictDoUpdate({ target: settings.userId, set: defaultSettings() });

	await db
		.insert(mailAccount)
		.values({
			id: PROBE_ACCOUNT_ID,
			userId: PROBE_USER_ID,
			gmailAddress: PROBE_EMAIL,
			// Never used: nothing in a probe syncs mail, so no token is ever decrypted.
			accessToken: 'guardrail-no-token',
			refreshToken: 'guardrail-no-token',
			scope: 'https://www.googleapis.com/auth/gmail.readonly',
			accessTokenExpiresAt: null,
			lastSyncAt: null,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({ target: mailAccount.id, set: { updatedAt: now } });

	await db
		.insert(message)
		.values({
			id: PROBE_MESSAGE_ID,
			accountId: PROBE_ACCOUNT_ID,
			gmailId: 'guardrail-probe-gmail-id',
			threadId: 'guardrail-probe-thread',
			subject: 'Guardrail probe message',
			fromName: 'Kikitai guardrails',
			fromEmail: 'guardrails@example.test',
			receivedAt: new Date(now.getTime() - 86_400_000),
			snippet: PROBE_SENTENCES[0],
			bodyText: PROBE_BODY,
			labelIds: ['INBOX'],
			category: null,
			summary: PROBE_SUMMARY,
			priority: 5,
			actionItems: [],
			organizedAt: now,
			isDigested: false,
			createdAt: now
		})
		.onConflictDoUpdate({
			target: message.id,
			set: { bodyText: PROBE_BODY, summary: PROBE_SUMMARY, priority: 5, organizedAt: now }
		});
}

/** Remove everything the probes created — the app database ends up untouched. */
export async function cleanProbe(db: Db): Promise<void> {
	await db.delete(message).where(eq(message.id, PROBE_MESSAGE_ID));
	await db.delete(mailAccount).where(eq(mailAccount.id, PROBE_ACCOUNT_ID));
	await db.delete(settings).where(eq(settings.userId, PROBE_USER_ID));
	await db.delete(user).where(eq(user.id, PROBE_USER_ID));
}

/** Back to the baseline a fresh reader would have (an earlier probe may have moved it). */
export async function resetProbeSettings(): Promise<void> {
	await withDb((db) =>
		db.update(settings).set(defaultSettings()).where(eq(settings.userId, PROBE_USER_ID))
	);
}

/**
 * Write a speed the client has not asked for. When a probe then triggers a
 * settings refresh, seeing this value in the UI proves the refresh really
 * landed — otherwise "the player survived" could just mean "nothing happened".
 */
export async function setProbeSpeed(speed: number): Promise<void> {
	await withDb((db) =>
		db
			.update(settings)
			.set({ ttsSpeed: speed, updatedAt: new Date() })
			.where(eq(settings.userId, PROBE_USER_ID))
	);
}
