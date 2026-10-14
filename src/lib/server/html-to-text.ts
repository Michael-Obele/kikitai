/**
 * A deliberately small HTML → text pass for the URL import.
 *
 * What it does: drop everything that is not prose (scripts, styles, page
 * chrome), turn block-level markup into line breaks, decode the handful of
 * HTML entities that actually show up in prose, then collapse the whitespace
 * mess that leaves behind.
 *
 * What it deliberately does NOT do — on purpose, for Phase 1:
 *   - no readability-style "which box is the article?" guessing: that needs a
 *     real DOM plus tuned heuristics, and the plan only allows a dependency
 *     for exactly that (we are not adding one yet);
 *   - no CSS selectors, no table layout reconstruction, no markdown output —
 *     the player reads sentences, not formatting;
 *   - no full HTML entity table (a regex cannot know `&foobar;` anyway, so
 *     unknown entities are left as the reader wrote them).
 *
 * Regexes over page source are imperfect: an unclosed tag can swallow more
 * than it should. They are honest about what they are, though — a
 * markup-stripping filter, not an HTML parser — and each step below says why
 * it runs in that order.
 */

/** Raw-text elements: their *contents* are markup-free in HTML, so the whole
 *  element (open tag, text, close tag) has to go before any tag matching. */
const RAW_ELEMENTS = ['script', 'style', 'noscript', 'template', 'svg', 'math', 'title'];

/** Page chrome nobody wants read aloud — navigation and page furniture. */
const CHROME_ELEMENTS = ['nav', 'header', 'footer', 'aside', 'form', 'button', 'select', 'iframe'];

/**
 * Block-level tags. Their boundaries become line breaks, and because both the
 * opening and the closing tag produce one, `<p>a</p><p>b</p>` ends up with a
 * blank line between the paragraphs, which is what a reader expects.
 */
const BLOCK_TAGS = [
	'address',
	'article',
	'aside',
	'blockquote',
	'body',
	'br',
	'caption',
	'dd',
	'details',
	'div',
	'dl',
	'dt',
	'fieldset',
	'figcaption',
	'figure',
	'footer',
	'form',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'header',
	'hr',
	'html',
	'label',
	'legend',
	'li',
	'main',
	'menu',
	'nav',
	'ol',
	'p',
	'pre',
	'section',
	'summary',
	'table',
	'tbody',
	'td',
	'tfoot',
	'th',
	'thead',
	'tr',
	'ul'
];

/** The entities that turn up in normal prose. `nbsp` becomes a plain space so
 *  it can be collapsed with the whitespace pass below. */
const ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
	shy: '',
	hellip: '…',
	mdash: '—',
	ndash: '–',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	bull: '•',
	middot: '·',
	sect: '§',
	para: '¶',
	copy: '©',
	reg: '®',
	trade: '™',
	deg: '°',
	laquo: '«',
	raquo: '»',
	times: '×',
	divide: '÷',
	plusmn: '±',
	euro: '€',
	pound: '£',
	yen: '¥',
	cent: '¢',
	auml: 'ä',
	ouml: 'ö',
	uuml: 'ü',
	szlig: 'ß',
	agrave: 'à',
	aacute: 'á',
	egrave: 'è',
	eacute: 'é',
	igrave: 'ì',
	iacute: 'í',
	ccedil: 'ç',
	ntilde: 'ñ',
	ugrave: 'ù',
	uacute: 'ú'
};

/** `&amp;`, `&#39;`, `&#x27;` → the character. Unknown names are left alone. */
function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]{1,31});/gi, (match, body: string) => {
		if (body.startsWith('#')) {
			const hex = body[1] === 'x' || body[1] === 'X';
			const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
			if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
			// Surrogate halves and 0 would produce garbage or a NUL byte.
			if (code >= 0xd800 && code <= 0xdfff) return match;
			return String.fromCodePoint(code);
		}
		const key = body.toLowerCase();
		return key in ENTITIES ? ENTITIES[key] : match;
	});
}

/** One blank line at most, single spaces everywhere else, nothing padded. */
function normalise(text: string): string {
	return text
		.replace(/\r\n?/g, '\n')
		.replace(/[^\S\n]+/g, ' ')
		.replace(/[ \t]*\n[ \t]*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Remove every `open … close` span with **one forward pass**.
 *
 * The lazy `*?` regex this replaces (`/<!--[\s\S]*?-->/g`) restarts at every
 * `<!--` it finds, so `"<!--".repeat(200_000)` costs minutes of synchronous CPU —
 * and no AbortSignal can interrupt synchronous code, so one anonymous import POST
 * would pin the server. An unclosed span keeps the tail untouched, which is exactly
 * what a lazy regex does: it only ever matched *closed* spans.
 */
function stripDelimited(text: string, open: string, close: string): string {
	let out = '';
	let cursor = 0;
	for (;;) {
		const start = text.indexOf(open, cursor);
		if (start === -1) break;
		const end = text.indexOf(close, start + open.length);
		if (end === -1) break;
		out += text.slice(cursor, start) + ' ';
		cursor = end + close.length;
	}
	return cursor === 0 ? text : out + text.slice(cursor);
}

/** Bounds of the first well-formed `</name …>` at or after `from`, else null. */
function findCloseTag(
	html: string,
	name: string,
	from: number
): [start: number, end: number] | null {
	const needle = `</${name}`;
	let at = html.indexOf(needle, from);
	while (at !== -1) {
		let j = at + needle.length;
		while (j < html.length) {
			const c = html.charCodeAt(j);
			if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
			j++;
		}
		if (html.charCodeAt(j) === 62) return [at, j + 1];
		at = html.indexOf(needle, at + 1);
	}
	return null;
}

/**
 * Remove `<name …>…</name>` for any of `names`, in one linear pass for the same
 * reason as `stripDelimited` — the old `new RegExp(…[\s\S]*?<\/\1…)` shape is
 * quadratic on a page full of unclosed openers.
 *
 * `swallow = true` (raw elements): a missing close consumes the rest of the
 * document, because that is what a browser does with an unclosed `<script>` —
 * better than reading the page's JavaScript out loud. `false` (chrome, `<head>`):
 * an unclosed element is left alone, and its name is remembered as *dead* — no
 * later opener can find a closer the first one could not, so that name is never
 * searched again. That single rule is what keeps the whole scan linear.
 */
function stripElements(html: string, names: string[], swallow: boolean): string {
	const wanted = new Set(names);
	const dead = new Set<string>();
	let out = '';
	let cursor = 0;
	let at = html.indexOf('<');

	while (at !== -1) {
		let i = at + 1;
		const closing = html[i] === '/';
		if (closing) i++;
		const start = i;
		while (i < html.length) {
			const c = html.charCodeAt(i);
			const named =
				(c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45;
			if (!named) break;
			i++;
		}
		const name = html.slice(start, i).toLowerCase();
		// Only a wanted, live, opening tag can change the output, so only it is
		// worth finding the end of. Searching for `>` for *every* `<` re-scans the
		// tail on every iteration, which is quadratic on a body of stray `<`
		// (measured 2.2 s at 200 k, 9 s at 400 k) — the exact shape this function
		// exists to avoid. Skipping it here makes the common case a plain
		// `indexOf('<', at + 1)`, which is linear overall.
		const open = !closing && wanted.has(name) && !dead.has(name);
		const tagEnd = open ? html.indexOf('>', i) : -1;
		if (open && tagEnd === -1) break; // no complete tag left to judge

		if (open) {
			const hit = findCloseTag(html, name, tagEnd);
			if (!hit) {
				if (swallow) {
					out += html.slice(cursor, at) + ' ';
					return out;
				}
				dead.add(name);
			} else {
				out += html.slice(cursor, at) + ' ';
				cursor = hit[1];
				at = html.indexOf('<', cursor);
				continue;
			}
		}
		at = html.indexOf('<', at + 1);
	}

	return cursor === 0 ? html : out + html.slice(cursor);
}

/**
 * Strip markup and return readable text. Steps run in dependency order: raw
 * elements first (so JS/CSS can never leak into the prose), then chrome, then
 * the head (whose `<title>` the caller already read), then line breaks, then
 * everything else.
 *
 * Every pattern below is written so a failed match cannot scan to end-of-string
 * (`[^<>]` instead of `[^>]`, forward scanners instead of `*?`): the input is
 * attacker-controlled (any URL a reader pastes) and up to 2MB, so a quadratic
 * shape here is an anonymous denial of service.
 */
export function htmlToText(html: string): string {
	let text = html;

	// Comments and CDATA can contain anything, including `<script>`-looking text.
	text = stripDelimited(text, '<!--', '-->');
	text = stripDelimited(text, '<![CDATA[', ']]>');

	// Raw elements disappear with their contents; an unclosed one swallows the
	// rest of the document, which is what a browser does too.
	text = stripElements(text, RAW_ELEMENTS, true);
	// Page chrome (and the head) goes the same way, but an unclosed element is
	// kept — dropping the tail there could eat the article itself.
	text = stripElements(text, CHROME_ELEMENTS, false);
	text = stripElements(text, ['head'], false);

	// Line breaks at block boundaries (before tags are removed, or they would be
	// invisible), then the remaining inline markup goes.
	text = text.replace(new RegExp(`</?(?:${BLOCK_TAGS.join('|')})\\b[^<>]*>`, 'gi'), '\n');
	text = text.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ');
	text = text.replace(/<![^<>]*>/g, ' '); // <!doctype> and anything left over

	return normalise(decodeEntities(text));
}

/** Inner text of the first complete `<name …>…</name>`, or null (never a scan to EOF). */
function firstElementInner(html: string, name: string): string | null {
	const lower = html.toLowerCase();
	let at = lower.indexOf(`<${name}`);
	while (at !== -1) {
		const next = html.charCodeAt(at + name.length + 1);
		// `<titlex>` is not a `<title>` — the boundary the old `[^>]*` bought for free.
		const boundary = !(
			(next >= 48 && next <= 57) ||
			(next >= 65 && next <= 90) ||
			(next >= 97 && next <= 122) ||
			next === 45
		);
		const tagEnd = boundary ? html.indexOf('>', at + name.length + 1) : -1;
		if (tagEnd === -1) {
			at = lower.indexOf(`<${name}`, at + 1);
			continue;
		}
		const hit = findCloseTag(html, name, tagEnd);
		return hit ? html.slice(tagEnd + 1, hit[0]) : null;
	}
	return null;
}

/**
 * A page's title, best source first: `<title>`, then the Open Graph / Twitter
 * tags (they are written for sharing, so often cleaner), then the first `<h1>`,
 * and finally the host name so there is always *something* to show.
 */
export function pickTitle(html: string, url: URL): string {
	for (const candidate of [
		firstElementInner(html, 'title'),
		metaTitle(html),
		firstElementInner(html, 'h1')
	]) {
		if (!candidate) continue;
		const title = normalise(decodeEntities(candidate.replace(/<[^<>]*>/g, ' ')));
		if (title) return title.slice(0, 200);
	}

	return url.hostname;
}

/**
 * `og:title` / `twitter:title` from the first matching `<meta>` tag. The tag is
 * isolated with `indexOf('>')` first, so the attribute patterns only ever run
 * over one tag instead of re-scanning the document from every `<meta`.
 */
function metaTitle(html: string): string | null {
	const lower = html.toLowerCase();
	let at = lower.indexOf('<meta');
	while (at !== -1) {
		const end = html.indexOf('>', at);
		if (end === -1) return null;
		const tag = html.slice(at, end + 1);
		if (/(?:property|name)=["'](?:og:title|twitter:title)["']/i.test(tag)) {
			const content = /content=["']([^"']*)["']/i.exec(tag);
			if (content?.[1]) return content[1];
		}
		at = lower.indexOf('<meta', end);
	}
	return null;
}
