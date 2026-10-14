import { PersistedState } from 'runed';

/**
 * How the reader wants words said — acronyms, names, product spellings, the
 * homograph a model keeps getting wrong. Plain substitution, because it is the
 * one technique every engine here understands: Kokoro/Kitten take raw text
 * (no SSML), Web Speech takes raw text, and only Google Cloud TTS parses its
 * input as SSML — that one gets the optional IPA upgrade through
 * `ssmlSpeakable` below.
 *
 * Local-first on purpose: localStorage only, same as speed/ramp on /read —
 * nothing to sync, nothing to lose when signed out.
 */
export type PronunciationRule = {
	from: string;
	to: string;
	/** Optional IPA rendering for SSML engines; local engines never see it. */
	ipa?: string;
};

const store = new PersistedState<PronunciationRule[]>('kikitai.read.pronunciation', []);

/** Shared handle so the settings card and the synthesiser read one list. */
export const pronunciation = {
	get rules(): PronunciationRule[] {
		return store.current;
	},
	set rules(next: PronunciationRule[]) {
		store.current = next;
	}
};

/** Escape a literal for use inside a RegExp. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Keep the original's casing so the sentence still reads right. */
function matchCase(source: string, to: string): string {
	if (source.length > 1 && source === source.toUpperCase()) return to.toUpperCase();
	if (source[0] && source[0] !== source[0].toLowerCase()) {
		return to.charAt(0).toUpperCase() + to.slice(1);
	}
	return to;
}

/**
 * Apply the rules to one chunk: whole words only (so "read" never rewrites
 * "reading"), longest pattern first (so "New York City" beats "New York"),
 * case-insensitive with the original's casing preserved.
 *
 * Runs per chunk at synthesis time, so the text on screen is never touched.
 */
export function speakable(text: string, rules: PronunciationRule[] = store.current): string {
	const usable = rules.filter((rule) => rule.from.trim() && rule.to.trim());
	if (!usable.length || !text) return text;

	let out = text;
	for (const rule of [...usable].sort((a, b) => b.from.trim().length - a.from.trim().length)) {
		const pattern = new RegExp(
			`(?<![\\p{L}\\p{N}])${escapeRegExp(rule.from.trim())}(?![\\p{L}\\p{N}])`,
			'giu'
		);
		out = out.replace(pattern, (match) => matchCase(match, rule.to.trim()));
	}
	return out;
}

/**
 * Characters that would cut the phoneme tag (or the XML document) in half.
 * Real IPA never needs them, so a value carrying one is treated as missing.
 */
const TAG_BREAKERS = /["<>&]/;

/**
 * Google parses the whole input as XML, so text that is not one of our own
 * tags must be entity-escaped — a bare &, < or > fails the request outright.
 */
function escapeSsml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One run of the output: plain text, or a word wearing its phoneme. */
type Piece = { text: string; ipa?: string };

/**
 * Append plain text, merging it into a neighbouring plain run — every plain
 * stretch stays contiguous, so the next rule matches across the seam exactly
 * as it would in the one flat string `speakable()` works on.
 */
function pushPlain(pieces: Piece[], text: string): void {
	const last = pieces[pieces.length - 1];
	if (last && !last.ipa) last.text += text;
	else pieces.push({ text });
}

/**
 * The SSML form of the spoken copy, for the engines that accept it (Google).
 *
 * Identical matching to `speakable()` — whole words, longest first,
 * case-insensitive, casing preserved — with two deliberate differences:
 *
 * 1. A rule whose `ipa` is usable wraps the matched word in
 *    `<phoneme alphabet="ipa" ph="…">` instead of replacing it. A missing or
 *    tag-breaking `ipa` falls back to plain substitution (the phase-1 path) —
 *    deliberately *not* sanitised, because stripping characters would invent
 *    a phoneme the reader never wrote.
 * 2. A word that already carries a phoneme is invisible to later rules:
 *    rewriting it from inside the tag would nest markup Google rejects.
 *
 * Everything (including what substitutions wrote) is entity-escaped on the
 * way out, because the result is parsed as XML. Local engines never call
 * this — they take raw text and would read the tags aloud.
 */
export function ssmlSpeakable(text: string, rules: PronunciationRule[] = store.current): string {
	const usable = rules.filter((rule) => rule.from.trim() && rule.to.trim());
	// No rules still means XML: the bare text itself can contain < or &.
	if (!usable.length || !text) return escapeSsml(text);

	let pieces: Piece[] = [{ text }];
	for (const rule of [...usable].sort((a, b) => b.from.trim().length - a.from.trim().length)) {
		const from = rule.from.trim();
		const to = rule.to.trim();
		const rawIpa = rule.ipa?.trim();
		const ipa = rawIpa && !TAG_BREAKERS.test(rawIpa) ? rawIpa : '';
		const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, 'giu');
		const next: Piece[] = [];
		for (const piece of pieces) {
			if (piece.ipa) {
				next.push(piece);
				continue;
			}
			let cursor = 0;
			for (const found of piece.text.matchAll(pattern)) {
				const start = found.index ?? 0;
				const match = found[0];
				if (start > cursor) pushPlain(next, piece.text.slice(cursor, start));
				if (ipa) next.push({ text: match, ipa });
				else pushPlain(next, matchCase(match, to));
				cursor = start + match.length;
			}
			if (cursor < piece.text.length) pushPlain(next, piece.text.slice(cursor));
		}
		pieces = next;
	}

	return pieces
		.map((piece) =>
			piece.ipa
				? `<phoneme alphabet="ipa" ph="${piece.ipa}">${escapeSsml(piece.text)}</phoneme>`
				: escapeSsml(piece.text)
		)
		.join('');
}
