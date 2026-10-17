import { describe, it, expect } from 'vitest';
import * as v from 'valibot';
import {
	importUrlInputSchema,
	inboxFilterSchema,
	messageDtoSchema,
	dateOrStringSchema,
	settingsUpdateSchema,
	synthesizeInputSchema,
	organizeInputSchema
} from '../src/index';

describe('@kikitai/contracts schemas', () => {
	describe('importUrlInputSchema', () => {
		it('validates a valid url string', () => {
			const res = v.safeParse(importUrlInputSchema, { url: 'https://example.com/article' });
			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.output.url).toBe('https://example.com/article');
			}
		});

		it('rejects empty url', () => {
			const res = v.safeParse(importUrlInputSchema, { url: '' });
			expect(res.success).toBe(false);
		});
	});

	describe('dateOrStringSchema', () => {
		it('converts ISO string to Date', () => {
			const iso = '2026-10-17T12:00:00.000Z';
			const parsed = v.parse(dateOrStringSchema, iso);
			expect(parsed).toBeInstanceOf(Date);
			expect(parsed.toISOString()).toBe(iso);
		});

		it('preserves Date instances', () => {
			const d = new Date('2026-10-17T12:00:00.000Z');
			const parsed = v.parse(dateOrStringSchema, d);
			expect(parsed).toBe(d);
		});
	});

	describe('inboxFilterSchema', () => {
		it('parses string query params into numbers for limit and offset', () => {
			const parsed = v.parse(inboxFilterSchema, {
				category: 'needs_reply',
				priority: 'high',
				limit: '25',
				offset: '50'
			});
			expect(parsed.category).toBe('needs_reply');
			expect(parsed.priority).toBe('high');
			expect(parsed.limit).toBe(25);
			expect(parsed.offset).toBe(50);
		});
	});

	describe('messageDtoSchema', () => {
		it('parses message with string dates into Date objects', () => {
			const input = {
				id: 'msg-1',
				gmailId: 'gm-1',
				subject: 'Test Subject',
				fromName: 'Alice',
				fromEmail: 'alice@example.com',
				receivedAt: '2026-10-17T10:00:00.000Z',
				snippet: 'Preview snippet',
				bodyText: 'Full email body',
				labelIds: ['INBOX'],
				category: 'updates',
				summary: 'A short summary',
				priority: 3,
				actionItems: ['Check reply'],
				facts: { dates: [], amounts: [], links: [], people: [] },
				spokenText: null,
				cleanBody: null,
				organizedAt: '2026-10-17T10:05:00.000Z',
				organizeError: null,
				isDigested: false
			};
			const parsed = v.parse(messageDtoSchema, input);
			expect(parsed.receivedAt).toBeInstanceOf(Date);
			expect(parsed.organizedAt).toBeInstanceOf(Date);
			expect(parsed.category).toBe('updates');
		});
	});

	describe('settingsUpdateSchema', () => {
		it('accepts partial settings update', () => {
			const input = {
				ttsEngine: 'kokoro',
				ttsSpeed: 1.5,
				syncWindowDays: 14
			};
			const parsed = v.parse(settingsUpdateSchema, input);
			expect(parsed.ttsEngine).toBe('kokoro');
			expect(parsed.ttsSpeed).toBe(1.5);
			expect(parsed.syncWindowDays).toBe(14);
		});
	});

	describe('synthesizeInputSchema', () => {
		it('validates text input for TTS', () => {
			const parsed = v.parse(synthesizeInputSchema, {
				text: 'Hello world',
				engine: 'google',
				voice: 'en-US-Neural2-F'
			});
			expect(parsed.text).toBe('Hello world');
			expect(parsed.engine).toBe('google');
		});
	});

	describe('organizeInputSchema', () => {
		it('accepts empty object or specific messageId', () => {
			expect(v.parse(organizeInputSchema, {})).toEqual({});
			expect(v.parse(organizeInputSchema, { messageId: 'msg-123' })).toEqual({
				messageId: 'msg-123'
			});
		});
	});
});
