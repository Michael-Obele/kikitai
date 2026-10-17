import { PressedKeys, useEventListener, watch } from 'runed';

/**
 * Window-wide key state for the app — runed's PressedKeys (which also clears
 * itself on blur / tab-hide, so keys can't get stuck): see
 * https://runed.dev/docs/utilities/pressed-keys
 *
 * One instance everywhere: the player and the shortcut help read the same
 * pressed set, and nothing hand-rolls keydown plumbing.
 */
export const pressedKeys = new PressedKeys();

const MODIFIERS = ['shift', 'control', 'meta', 'alt'];
/** Keys whose browser default is scrolling the page — we bind them, so we owe the page nothing. */
const SCROLLS_PAGE = new Set([' ', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home']);

/**
 * True when the keystroke belongs to whatever has focus rather than the
 * player: a text field, an open menu — or a dialog (everything except `?`,
 * which is how you close the help again). Focused buttons and
 * `role="button"` elements consume Space/Enter themselves, natively.
 */
export function inControl(key: string): boolean {
	if (typeof document === 'undefined') return true;
	const el = document.activeElement as HTMLElement | null;
	if (!el || el === document.body) return false;
	if (el.isContentEditable) return true;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.closest('[role="menu"], [role="listbox"]')) return true;
	if (el.closest('[role="dialog"]')) return key !== '?';
	return (
		(key === ' ' || key === 'Enter') && (tag === 'BUTTON' || el.getAttribute('role') === 'button')
	);
}

/**
 * Run `action` once per press of `combo` — `"k"` or `["shift", "arrowup"]`.
 *
 * PressedKeys reports state, not events, so a press is exactly one edge: no
 * auto-repeat spam, and holding a key never re-fires it because some other key
 * changed. State also means `preventDefault` can't happen in the callback (it
 * runs after dispatch) — that is what the listener below is for.
 */
export function onPress(combo: string | string[], action: () => void): void {
	const keys = (Array.isArray(combo) ? combo : [combo]).map((key) => key.toLowerCase());
	const base = keys.find((key) => !MODIFIERS.includes(key)) ?? keys[0]!;

	watch(
		() => keys.every((key) => pressedKeys.has(key)),
		(down) => {
			if (down && !inControl(base)) action();
		}
	);

	if (!SCROLLS_PAGE.has(base)) return;
	useEventListener(
		() => (typeof window === 'undefined' ? undefined : window),
		'keydown',
		(event) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key.toLowerCase() !== base) return;
			// A shift combo must not steal the unshifted key (plain ↑/↓ still scroll).
			if (keys.includes('shift') && !event.shiftKey) return;
			if (inControl(base)) return;
			event.preventDefault();
		}
	);
}
