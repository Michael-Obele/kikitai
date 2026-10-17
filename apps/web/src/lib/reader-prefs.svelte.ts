import { PersistedState } from 'runed';

/**
 * Reading typography — the one place text size, face and leading are decided.
 *
 * `size` multiplies the reading text's own base (0.875rem, the `text-sm` the
 * reader has always used) and NOT the root font size. That distinction is the
 * whole feature: the chrome around the text — nav, buttons, the sidebar — keeps
 * the size it was designed at, and only what you read grows. `1` therefore
 * paints exactly what shipped before, so a reader who never opens the control
 * sees no change at all, and the Lighthouse budgets see none either.
 *
 * The values reach the page as custom properties on `:root` (see `layout.css`),
 * written by a single effect in the root layout. They have to live there: `/read`
 * and `(app)` share no nearer ancestor, so anything scoped lower would reach
 * one and miss the other. `DEFAULT_READER_PREFS` below and the `--reader-*`
 * values in `layout.css` are ONE decision written twice — the CSS copy is what
 * the server and the first frame paint — so a new default belongs in both.
 *
 * That split is also the one gap. A stored non-default preference is applied
 * after hydration, so a returning reader sees the default for as long as the
 * bundle takes to load. Seeding the four properties from a pre-paint script (the
 * trick `ModeWatcher` already uses for the theme) would close it; it would also
 * mean writing the font stacks a second time, outside the module system.
 */
export type ReaderFontId = 'oxanium' | 'hyperlegible' | 'serif' | 'system' | 'mono';

export type ReaderFont = {
	id: ReaderFontId;
	/** Shown in the picker, set in the face itself. */
	label: string;
	/** The `font-family` stack the reading surfaces are given. */
	stack: string;
	/**
	 * The stack for headings inside the reader. The brand serif while the body
	 * is Oxanium (what shipped), the reader's own face for every other choice —
	 * so a block never mixes two unrelated typefaces.
	 */
	heading: string;
};

/**
 * Both brand stacks are written out rather than read from `--font-sans` /
 * `--font-heading`: those theme variables are declared `@theme inline`, so
 * Tailwind inlines them into the utilities instead of emitting them as custom
 * properties (they appear zero times in the built CSS), and a `var()` resolving
 * to nothing would silently drop the font. These literals are the same faces
 * `layout.css` imports.
 */
const OXANIUM = "'Oxanium Variable', sans-serif";
const PLAYFAIR = "'Playfair Display Variable', serif";
const HYPERLEGIBLE = "'Atkinson Hyperlegible Next Variable', system-ui, sans-serif";
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const SYSTEM_SANS =
	"system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/**
 * `heading` names the face rather than leaning on inheritance. A custom property
 * whose value is the CSS-wide keyword `inherit` does not substitute the token
 * `inherit`; it makes the property itself inherit, which on the root element
 * resolves to nothing and leaves the declaration invalid at computed-value
 * time. Naming the face keeps the heading rule a real declaration.
 *
 * Atkinson Hyperlegible is the Braille Institute's face, drawn to keep letters
 * that usually look alike apart (I/l/1, O/0) — the one option here chosen for
 * legibility rather than taste. The rest are the two brand faces plus stacks
 * every operating system already has. Nothing is fetched until something
 * renders in a face, which happens when the picker is opened — so a reader who
 * never opens it never pays for the extra font.
 */
export const READER_FONTS: readonly ReaderFont[] = [
	{ id: 'oxanium', label: 'Oxanium', stack: OXANIUM, heading: PLAYFAIR },
	{
		id: 'hyperlegible',
		label: 'Atkinson Hyperlegible',
		stack: HYPERLEGIBLE,
		heading: HYPERLEGIBLE
	},
	{ id: 'serif', label: 'Reading serif', stack: SERIF, heading: SERIF },
	{ id: 'system', label: 'System sans', stack: SYSTEM_SANS, heading: SYSTEM_SANS },
	{ id: 'mono', label: 'Monospace', stack: MONO, heading: MONO }
];

/**
 * Multipliers on that 0.875rem base, so the ladder reads 12.25 → 24.5px on a
 * default 16px root. It stops at 1.75 on purpose: past that the reader's own
 * column starts breaking words rather than helping anyone.
 */
export const READER_SIZES = [0.85, 1, 1.15, 1.3, 1.5, 1.75] as const;

/** 1.625 is what `leading-relaxed` already gave the reader before this control. */
export const READER_LEADINGS = [1.4, 1.625, 1.8, 2] as const;

export type ReaderPrefs = {
	size: number;
	font: ReaderFontId;
	leading: number;
};

/** The shipped look: keep `size` at 1 and `leading` at `leading-relaxed`. */
export const DEFAULT_READER_PREFS: ReaderPrefs = {
	size: 1,
	font: 'oxanium',
	leading: 1.625
};

/**
 * Deliberately local to the browser. `/read` is public — no account, nothing
 * stored — and a preference that only worked while signed in would be the worse
 * half of the feature. Same mechanism, and the same reasoning, as the voice and
 * playback preferences in `player-prefs.svelte.ts`.
 */
const readerPrefs = new PersistedState<ReaderPrefs>('kikitai.reader.prefs', DEFAULT_READER_PREFS);

export function isReaderFont(value: unknown): value is ReaderFontId {
	return typeof value === 'string' && READER_FONTS.some((font) => font.id === value);
}

/**
 * Membership, not "is it a number", is what makes a stored value usable: the
 * ladders ARE the contract. A rung dropped in a later release, a hand-edited
 * entry or a corrupt write then lands on the default instead of painting
 * `--reader-scale: 100000` over the page — and instead of leaving the picker
 * with nothing checked, which is what an unlisted value would do.
 */
export function isReaderSize(value: unknown): value is number {
	return READER_SIZES.some((size) => size === value);
}

export function isReaderLeading(value: unknown): value is number {
	return READER_LEADINGS.some((leading) => leading === value);
}

/** The chosen face, or the default when storage held something unrecognised. */
function readerFont(id: ReaderFontId): ReaderFont {
	return READER_FONTS.find((font) => font.id === id) ?? READER_FONTS[0]!;
}

/**
 * The stored value, made safe to paint. `localStorage` is editable by hand and
 * outlives every release, so anything off the ladders falls back to the default
 * rather than reaching the page.
 */
export function currentReaderPrefs(): ReaderPrefs {
	const stored: Partial<ReaderPrefs> | null = readerPrefs.current;
	const size = stored?.size;
	const font = stored?.font;
	const leading = stored?.leading;
	return {
		size: isReaderSize(size) ? size : DEFAULT_READER_PREFS.size,
		font: isReaderFont(font) ? font : DEFAULT_READER_PREFS.font,
		leading: isReaderLeading(leading) ? leading : DEFAULT_READER_PREFS.leading
	};
}

/** Every write goes through here, so a partial update can never drop a field. */
function patch(next: Partial<ReaderPrefs>): void {
	readerPrefs.current = { ...currentReaderPrefs(), ...next };
}

/** The setters reject anything off the ladder, so the store can never hold a
 *  value the picker cannot show. */
export function setReaderSize(size: number): void {
	if (isReaderSize(size)) patch({ size });
}

export function setReaderFont(font: ReaderFontId): void {
	if (isReaderFont(font)) patch({ font });
}

export function setReaderLeading(leading: number): void {
	if (isReaderLeading(leading)) patch({ leading });
}

export function resetReaderPrefs(): void {
	readerPrefs.current = { ...DEFAULT_READER_PREFS };
}

/** True while anything differs from the shipped look — drives Reset's visibility. */
export function readerPrefsChanged(): boolean {
	const prefs = currentReaderPrefs();
	return (
		prefs.size !== DEFAULT_READER_PREFS.size ||
		prefs.font !== DEFAULT_READER_PREFS.font ||
		prefs.leading !== DEFAULT_READER_PREFS.leading
	);
}

/**
 * Write the four properties onto the root element. Every reading surface reads
 * them back out of CSS, so nothing else in the app has to know this preference
 * exists — that is what keeps the feature to one store and one control.
 */
export function applyReaderPrefs(prefs: ReaderPrefs, root: HTMLElement): void {
	const font = readerFont(prefs.font);
	root.style.setProperty('--reader-scale', String(prefs.size));
	root.style.setProperty('--reader-font', font.stack);
	root.style.setProperty('--reader-heading-font', font.heading);
	root.style.setProperty('--reader-leading', String(prefs.leading));
}
