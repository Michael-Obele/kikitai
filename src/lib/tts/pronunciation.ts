import { PersistedState } from 'runed';

/**
 * How the reader wants words said — acronyms, names, product spellings, the
 * homograph a model keeps getting wrong. Plain substitution, because it is the
 * one technique every engine here understands: Kokoro/Kitten take raw text
 * (no SSML), Web Speech takes raw text, and Google's SSML phonemes can come
 * later as an upgrade for rules that carry an IPA form.
 *
 * Local-first on purpose: localStorage only, same as speed/ramp on /read —
 * nothing to sync, nothing to lose when signed out.
 */
export type PronunciationRule = { from: string; to: string };

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
