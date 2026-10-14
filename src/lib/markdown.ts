import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';

/**
 * Markdown → the blocks the reader draws and the voice speaks.
 *
 * Only `marked`'s tokenizer is used, never its HTML output: every character
 * below reaches the page as a Svelte text node, so a pasted document cannot
 * inject markup. Nothing in this repo renders raw HTML, and this keeps that so.
 *
 * One walk produces both halves, which must never drift apart:
 *   - `runs` is what the reading view paints — a heading is a heading, bold
 *     stays bold — with the syntax itself removed;
 *   - `plain` is what the sentence splitter and every engine see, so nothing
 *     is ever asked to say "asterisk" or "hash".
 *
 * Deliberately not reconstructed: a GFM table's grid (each row keeps its words
 * as its own paragraph) and the indent of a nested list (the items keep their
 * words, flattened). Reference definitions and raw HTML are dropped.
 */

/** A stretch of inline text plus the emphasis it carried. */
export type InlineRun = {
	/** Offsets into the block's `plain`, so a sentence can slice its own runs. */
	start: number;
	end: number;
	text: string;
	strong?: boolean;
	em?: boolean;
	code?: boolean;
	del?: boolean;
};

export type BlockKind = 'heading' | 'paragraph' | 'quote' | 'list-item' | 'code' | 'rule';

export type MdBlock = {
	kind: BlockKind;
	/** Heading level, already shifted to sit under the page's own h1. */
	depth?: number;
	/** The bullet or number to draw beside a list item. */
	marker?: string;
	/** True when `marker` is a number — the view groups those into an `<ol>`. */
	ordered?: boolean;
	runs: InlineRun[];
	/** `runs`, flattened: the only text any engine or splitter ever sees. */
	plain: string;
};

/**
 * A configured instance, built once at module scope. `marked.use()` mutates
 * global state and the docs call out Svelte by name for re-registering
 * extensions on every render, so the global singleton is never touched.
 */
const md = new Marked({ gfm: true, breaks: false });

type Flags = { strong?: boolean; em?: boolean; code?: boolean; del?: boolean };

/**
 * Collects inline text with running offsets. Whitespace is collapsed to single
 * spaces — the same thing the browser does when it paints the text — unless
 * `preserve` is set, which a fenced block uses to keep its own line breaks.
 */
class Inline {
	#runs: InlineRun[] = [];
	#length = 0;

	constructor(private readonly preserve = false) {}

	add(text: string, flags: Flags = {}): void {
		const value = this.preserve ? text : text.replace(/\s+/g, ' ');
		if (!value) return;
		this.#runs.push({
			start: this.#length,
			end: this.#length + value.length,
			text: value,
			...flags
		});
		this.#length += value.length;
	}

	finish(): { runs: InlineRun[]; plain: string } {
		return { runs: this.#runs, plain: this.#runs.map((run) => run.text).join('') };
	}
}

/**
 * Flatten a token tree into text plus emphasis. Containers recurse; leaves give
 * up their `text`, never their `raw` — `raw` still holds the markers
 * (`**bold**`), which is exactly what must not be spoken.
 */
function collect(tokens: Token[] | undefined, into: Inline, flags: Flags = {}): void {
	for (const raw of tokens ?? []) {
		// `Token` includes `Tokens.Generic`, whose index signature is `any`, so a
		// `switch` on `type` does not narrow on its own: every case names the shape
		// it means to read instead of trusting an untyped lookup.
		switch (raw.type) {
			case 'strong':
				collect((raw as Tokens.Strong).tokens, into, { ...flags, strong: true });
				break;
			case 'em':
				collect((raw as Tokens.Em).tokens, into, { ...flags, em: true });
				break;
			case 'del':
				collect((raw as Tokens.Del).tokens, into, { ...flags, del: true });
				break;
			case 'codespan':
				into.add((raw as Tokens.Codespan).text, { ...flags, code: true });
				break;
			case 'link':
				// The label is what a listener needs; the href is not content.
				collect((raw as Tokens.Link).tokens, into, flags);
				break;
			case 'image':
				// Alt text is the only part of an image that can be spoken.
				into.add((raw as Tokens.Image).text, flags);
				break;
			case 'br':
				into.add(' ', flags);
				break;
			case 'html':
				// Raw HTML is dropped: nothing here ever becomes markup.
				break;
			default: {
				// Anything else: recurse when it holds children, otherwise take
				// its own `text`. Keeps a sentence from being silently truncated.
				const rest = raw as { tokens?: Token[]; text?: string };
				if (rest.tokens?.length) collect(rest.tokens, into, flags);
				else if (typeof rest.text === 'string') into.add(rest.text, flags);
			}
		}
	}
}

/**
 * `kind` is the block a paragraph becomes — inside a quote it is `quote`.
 * Headings and list items keep their own kind wherever they appear.
 */
function collectBlocks(tokens: Token[], out: MdBlock[], kind: BlockKind = 'paragraph'): void {
	for (const raw of tokens) {
		switch (raw.type) {
			case 'heading': {
				const heading = raw as Tokens.Heading;
				const inline = new Inline();
				collect(heading.tokens, inline);
				const { runs, plain } = inline.finish();
				if (plain) out.push({ kind: 'heading', depth: heading.depth, runs, plain });
				break;
			}
			case 'paragraph': {
				const inline = new Inline();
				collect((raw as Tokens.Paragraph).tokens, inline);
				const { runs, plain } = inline.finish();
				if (plain) out.push({ kind, runs, plain });
				break;
			}
			case 'blockquote': {
				collectBlocks((raw as Tokens.Blockquote).tokens ?? [], out, 'quote');
				break;
			}
			case 'list': {
				const list = raw as Tokens.List;
				const start = Number(list.start) || 1;
				list.items.forEach((item, i) => {
					const inline = new Inline();
					const nested: Token[] = [];
					for (const child of item.tokens ?? []) {
						// Nested lists are kept as blocks of their own; the indent
						// is dropped, never the words.
						if (child.type === 'list') nested.push(child);
						else collect([child], inline);
					}
					const { runs, plain } = inline.finish();
					if (plain) {
						out.push({
							kind: 'list-item',
							ordered: list.ordered,
							marker: list.ordered ? `${start + i}.` : '•',
							runs,
							plain
						});
					}
					if (nested.length) collectBlocks(nested, out, kind);
				});
				break;
			}
			case 'code': {
				// Fenced and indented blocks alike: the text is kept verbatim (the
				// reader shows it in a <pre>) with nothing of the fence around it.
				const inline = new Inline(true);
				inline.add((raw as Tokens.Code).text.replace(/\n+$/, ''), { code: true });
				const { runs, plain } = inline.finish();
				if (plain.trim()) out.push({ kind: 'code', runs, plain });
				break;
			}
			case 'table': {
				// A table keeps its words, one paragraph per row. The grid is not
				// rebuilt: this is a reading view, and speech has no columns.
				const table = raw as Tokens.Table;
				for (const row of [table.header, ...table.rows]) {
					const inline = new Inline();
					row.forEach((cell, i) => {
						if (i > 0) inline.add(', ');
						collect(cell.tokens, inline);
					});
					const { runs, plain } = inline.finish();
					if (plain) out.push({ kind: 'paragraph', runs, plain });
				}
				break;
			}
			case 'hr':
				out.push({ kind: 'rule', runs: [], plain: '' });
				break;
			// `space`, `def` and anything unhandled carry no words of their own.
			default:
				break;
		}
	}
}

/**
 * Markdown's `#` is the *document's* top level, not the page's — `/read` already
 * opens with an `<h1>`. Shift every level so the shallowest heading in the paste
 * lands on `baseDepth`, which also stops a document that begins at `###` from
 * skipping ranks (W3C headings guidance, WCAG 1.3.1).
 */
function shiftHeadings(blocks: MdBlock[], baseDepth: number): void {
	const depths = blocks.flatMap((block) =>
		block.kind === 'heading' && block.depth ? [block.depth] : []
	);
	if (!depths.length) return;
	const shift = baseDepth - Math.min(...depths);
	for (const block of blocks) {
		if (block.kind !== 'heading' || !block.depth) continue;
		block.depth = Math.min(6, Math.max(baseDepth, block.depth + shift));
	}
}

/** Pasted text → the blocks the reader draws. Never HTML, never a raw marker. */
export function parseMarkdown(source: string, baseDepth = 2): MdBlock[] {
	const out: MdBlock[] = [];
	collectBlocks(md.lexer(source), out);
	shiftHeadings(out, baseDepth);
	return out;
}
