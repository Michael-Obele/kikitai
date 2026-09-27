import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	pgTable,
	real,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';
import { user } from './auth.schema';

export * from './auth.schema';

const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

/**
 * A Gmail account connected by a user. Tokens are encrypted at rest
 * (`$lib/server/tokens`) and are only ever used to call the read-only
 * Gmail API — nothing in this app can send, modify or delete mail.
 */
export const mailAccount = pgTable(
	'mail_account',
	{
		id: id(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		gmailAddress: text('gmail_address').notNull(),
		/** AES-256-GCM ciphertext (see `$lib/server/tokens`) */
		accessToken: text('access_token').notNull(),
		refreshToken: text('refresh_token').notNull(),
		scope: text('scope'),
		accessTokenExpiresAt: timestamp('access_token_expires_at'),
		lastSyncAt: timestamp('last_sync_at'),
		createdAt: timestamp('created_at').defaultNow().notNull(),
		updatedAt: timestamp('updated_at').defaultNow().notNull()
	},
	(t) => [uniqueIndex('mail_account_user_gmail_unique').on(t.userId, t.gmailAddress)]
);

/**
 * One Gmail message plus its app-level organization. Categories/summaries are
 * **never** written back to Gmail (decision 2: `gmail.readonly` only).
 */
export const message = pgTable(
	'message',
	{
		id: id(),
		accountId: text('account_id')
			.notNull()
			.references(() => mailAccount.id, { onDelete: 'cascade' }),
		gmailId: text('gmail_id').notNull(),
		threadId: text('thread_id').notNull(),
		subject: text('subject').notNull().default(''),
		fromName: text('from_name').notNull().default(''),
		fromEmail: text('from_email').notNull().default(''),
		receivedAt: timestamp('received_at').notNull(),
		snippet: text('snippet').notNull().default(''),
		/** Extracted plain text body (the only part ever sent to the AI). */
		bodyText: text('body_text').notNull().default(''),
		/** Gmail's own labels — a read-only snapshot. */
		labelIds: text('label_ids').array().notNull().default([]),
		// app-level organization
		category: text('category'),
		summary: text('summary'),
		priority: integer('priority'),
		actionItems: text('action_items').array().notNull().default([]),
		organizedAt: timestamp('organized_at'),
		organizeError: text('organize_error'),
		isDigested: boolean('is_digested').notNull().default(false),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(t) => [
		uniqueIndex('message_account_gmail_unique').on(t.accountId, t.gmailId),
		index('message_account_received_idx').on(t.accountId, t.receivedAt),
		index('message_account_organized_idx').on(t.accountId, t.organizedAt)
	]
);

/**
 * Per-user settings. Values fall back to env defaults when the row is missing,
 * so a fresh install works with zero configuration.
 */
export const settings = pgTable('settings', {
	userId: text('user_id')
		.primaryKey()
		.references(() => user.id, { onDelete: 'cascade' }),
	aiBaseUrl: text('ai_base_url').notNull().default(''),
	/** AES-256-GCM ciphertext; empty for local models that need no key. */
	aiKey: text('ai_key'),
	aiModel: text('ai_model').notNull().default(''),
	ttsEngine: text('tts_engine').notNull().default('kitten'),
	ttsVoice: text('tts_voice').notNull().default('expr-voice-2-f'),
	/** Playback speed multiplier (0.5–3). See SPEED_STEPS in $lib/tts. */
	ttsSpeed: real('tts_speed').notNull().default(1),
	/** Auto ramp: +0.1× every 2 min of playback, up to `ttsSpeed`. */
	ttsRamp: boolean('tts_ramp').notNull().default(false),
	syncWindowDays: integer('sync_window_days').notNull().default(7),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const mailAccountRelations = relations(mailAccount, ({ one, many }) => ({
	user: one(user, { fields: [mailAccount.userId], references: [user.id] }),
	messages: many(message)
}));

export const messageRelations = relations(message, ({ one }) => ({
	account: one(mailAccount, { fields: [message.accountId], references: [mailAccount.id] })
}));

export const settingsRelations = relations(settings, ({ one }) => ({
	user: one(user, { fields: [settings.userId], references: [user.id] })
}));
