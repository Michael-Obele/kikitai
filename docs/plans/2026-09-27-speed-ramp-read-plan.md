# Speed control, auto-ramp & paste-and-read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Speech speed 0.75×–3× in every engine, an auto-ramp (+0.1× / 2 min to a chosen cap), a public `/read` paste-and-reader, and homepage/README advertising.

**Architecture:** `speak()` gains a `speed` argument applied the best way per engine (native `speed` for Kitten/Kokoro, `utterance.rate`, `playbackRate`). The player owns a session `liveSpeed` plus the ramp timer and persists cap/ramp through a new `saveVoiceSpeed` command. Two new settings columns (`ttsSpeed`, `ttsRamp`) feed every player; `/read` is a route outside the auth-guarded `(app)` group.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, shadcn-svelte (dropdown-menu, switch — both already in `src/lib/components/ui/`), Lucide (`Gauge`, `ChevronsUp`, `ClipboardPaste`), Drizzle/Postgres, remote functions (`query`, `command`).

## Global Constraints

- Svelte 5 runes only (`$state`/`$derived`/`$props`/`$effect`), `onclick` never `on:click`, `<script lang="ts">` everywhere.
- shadcn spread order: `{...field}` FIRST, then explicit attributes (repo gotcha).
- `command` for input-less actions (speed menu/toggles), `form` for form mutations (settings page keeps its own form).
- `bun run check` must end every task at **0 errors / 0 warnings**; `bunx prettier --write <touched>` before each commit.
- Dev server already runs on **:5173** — never start another; never trigger model downloads (>20MB) without telling Michael first.
- Commit style: `<type>(<scope>): <imperative>`, subject ≤50 chars, no AI attribution.
- `/read` must **never redirect** to `/login`.
- Speed steps are exactly `[0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]`; ramp = `+0.1` per `120_000 ms` of playing time, capped at the chosen step; floats rounded to 1 decimal.

Plan location note: saved next to its design doc in `docs/plans/` (project convention) instead of the skill default `docs/superpowers/plans/`.

---

### Task 1: Core speed plumbing

**Files:**

- Modify: `src/lib/tts/index.ts`

**Interfaces:**

- Produces: `export const SPEED_STEPS: readonly number[]`, `export const DEFAULT_SPEED = 1`, `speak(engine, voice, text, onError?, speed?)`.

- [ ] **Step 1: Add the step list** after `TTS_MODELS`:

```ts
/** Fixed speed steps offered in the UI (multiplier over natural speech). */
export const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const DEFAULT_SPEED = 1;
```

- [ ] **Step 2: Thread `speed` through playback helpers** (same file, playback section):

```ts
function playBase64(audio: string, mime: string, speed = DEFAULT_SPEED): Promise<void> {
	return new Promise((done, fail) => {
		const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
		const el = new Audio(url);
		if (speed !== 1) {
			el.playbackRate = speed;
			if ('preservesPitch' in el) el.preservesPitch = true;
		}
		audioEl = el;
```

```ts
function speakWithWebSpeech(text: string, voice: string, rate = DEFAULT_SPEED): Promise<void> {
	return new Promise((done) => {
		const utterance = new SpeechSynthesisUtterance(text);
		const voices = speechSynthesis.getVoices();
		const match =
			voices.find((v) => v.name === voice) ?? voices.find((v) => v.lang.startsWith('en'));
		if (match) utterance.voice = match;
		utterance.rate = rate;
		utterance.onend = () => done();
```

- [ ] **Step 3: Change `speak`'s signature and every branch** (bottom of the file):

```ts
export async function speak(
	engine: EngineId,
	voice: string,
	text: string,
	onError?: (message: string) => void,
	speed: number = DEFAULT_SPEED
): Promise<void> {
	stopped = false;
	const clean = text.trim();
	if (!clean) return;

	try {
		if (engine === 'webspeech') {
			if (typeof speechSynthesis === 'undefined')
				throw new Error('Web Speech is not available here.');
			await speakWithWebSpeech(clean, voice, speed);
			return;
		}

		if (engine === 'kitten') {
			const model = await loadKitten();
			const generated = await model.generate(clean, {
				voice: voice || ENGINES.kitten.defaultVoice,
				speed
			});
			if (!stopped) await playBuffer(generated.toAudioBuffer(audioContext()));
			return;
		}

		if (engine === 'kokoro') {
			const model = await loadKokoro();
			const generated = await model.generate(clean, {
				voice: voice || ENGINES.kokoro.defaultVoice,
				speed
			});
			if (!stopped) await playBuffer(generated.toAudioBuffer(audioContext()));
			return;
		}

		const result = await synthesize({ text: clean, engine, voice });
		if (!stopped) await playBase64(result.audio, result.mime, speed);
	} catch (error) {
		onError?.(error instanceof Error ? error.message : String(error));
	}
}
```

(`toSentences` and everything above `speak` stay untouched. Kitten/Kokoro already accept `{ speed }` — verified in their `.d.ts`.)

- [ ] **Step 4: Gate**

Run: `bun run check`
Expected: `svelte-check found 0 errors and 0 warnings`

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/index.ts
git commit -m "feat(tts): speech speed option across all five engines"
```

---

### Task 2: Settings columns + `saveVoiceSpeed` command

**Files:**

- Modify: `src/lib/server/db/schema.ts` (settings table, line ~90)
- Modify: `src/lib/types/mail.ts` (`settingsSchema`)
- Modify: `src/lib/server/settings.ts`
- Modify: `src/lib/remote/settings.remote.ts`
- Modify: `src/lib/remote/index.ts`

**Interfaces:**

- Produces: `SettingsDto.ttsSpeed: number`, `SettingsDto.ttsRamp: boolean`,
  `saveVoiceSpeed({ speed, ramp })` command (client), `saveVoiceSpeed(userId, speed, ramp)` (server).

- [ ] **Step 1: Columns** — in `schema.ts`, add `real` to the `drizzle-orm/pg-core` import, then after `ttsVoice`:

```ts
	/** Playback speed multiplier (0.5–3). See SPEED_STEPS in $lib/tts. */
	ttsSpeed: real('tts_speed').notNull().default(1),
	/** Auto ramp: +0.1× every 2 min of playback, up to `ttsSpeed`. */
	ttsRamp: boolean('tts_ramp').notNull().default(false),
```

- [ ] **Step 2: DTO** — in `types/mail.ts`, inside `settingsSchema` after `ttsVoice` (and the same two lines inside `settingsFormSchema` only if the settings form is extended later — this plan does not):

```ts
	ttsSpeed: v.pipe(v.number(), v.minValue(0.5), v.maxValue(3)),
	ttsRamp: v.boolean(),
```

- [ ] **Step 3: Server get/save** — in `server/settings.ts`:

```ts
		ttsVoice: row?.ttsVoice || 'expr-voice-2-f',
		ttsSpeed: row?.ttsSpeed ?? 1,
		ttsRamp: row?.ttsRamp ?? false,
		syncWindowDays: row?.syncWindowDays ?? 7
```

Add `ttsSpeed: input.ttsSpeed` and `ttsRamp: input.ttsRamp` to **both** the `.values({})` and `.set({})` objects of `saveSettings`, then append:

```ts
/**
 * Persist only the voice speed/ramp (the player's speed menu). Inserts a row
 * when the user has never saved settings, so a fresh install can still ramp.
 */
export async function saveVoiceSpeed(userId: string, speed: number, ramp: boolean): Promise<void> {
	await db
		.insert(settings)
		.values({ userId, ttsSpeed: speed, ttsRamp: ramp })
		.onConflictDoUpdate({
			target: settings.userId,
			set: { ttsSpeed: speed, ttsRamp: ramp, updatedAt: new Date() }
		});
}
```

- [ ] **Step 4: Remote command** — in `remote/settings.remote.ts` (import `command` from `$app/server`, `* as v from 'valibot'`, `saveVoiceSpeed as persistVoiceSpeed` from `$lib/server/settings`):

```ts
/**
 * Speed menu / auto-ramp toggle: an instant-apply action, not a form input, so
 * it is a `command` (repo rule). Signed-out callers (public /read) are rejected
 * — callers treat that as "session-only".
 */
export const saveVoiceSpeed = command(
	v.object({
		speed: v.pipe(v.number(), v.minValue(0.5), v.maxValue(3)),
		ramp: v.boolean()
	}),
	async ({ speed, ramp }) => {
		const { user } = await requireUser();
		await persistVoiceSpeed(user.id, speed, ramp);
		void getSettings().refresh();
	}
);
```

Export it from `src/lib/remote/index.ts` next to the existing settings exports.

- [ ] **Step 5: Push the schema** (local Docker Postgres — if the container is down, `bun run db:start` first; the image should already exist locally, so no significant download)

Run: `bun run db:push`
Expected: applies `tts_speed` / `tts_ramp` columns, exits 0.

- [ ] **Step 6: Gate + commit**

```bash
bun run check   # 0 errors / 0 warnings
git add src/lib/server/db/schema.ts src/lib/types/mail.ts src/lib/server/settings.ts src/lib/remote/settings.remote.ts src/lib/remote/index.ts drizzle.config.ts 2>/dev/null
git commit -m "feat(settings): ttsSpeed + ttsRamp persisted with saveVoiceSpeed"
```

---

### Task 3: Speed menu component + player ramp engine

**Files:**

- Create: `src/lib/components/player/speed-menu.svelte`
- Modify: `src/lib/components/player/player.svelte`

**Interfaces:**

- Consumes: `SPEED_STEPS` (`$lib/tts`), `saveVoiceSpeed` (`$lib/remote`), shadcn `dropdown-menu` + `switch`.
- Produces: `<SpeedMenu {cap} {ramp} live onselect ontoggle />`; Player props gain `speed = 1`, `ramp = false`.

- [ ] **Step 1: Create `speed-menu.svelte`**

```svelte
<script lang="ts">
	import { Check, ChevronsUp, Gauge } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Switch } from '$lib/components/ui/switch';
	import { SPEED_STEPS } from '$lib/tts';

	/**
	 * Presentational speed control. `cap` is the step the user picked (what
	 * gets persisted), `live` is the speed playing right now — between steps
	 * while auto-ramp climbs.
	 */
	let {
		cap,
		ramp,
		live,
		onselect,
		ontoggle
	}: {
		cap: number;
		ramp: boolean;
		live: number;
		onselect: (speed: number) => void;
		ontoggle: (ramp: boolean) => void;
	} = $props();

	const label = $derived(`${trim(live)}×`);
	function trim(n: number) {
		return String(Math.round(n * 100) / 100);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon-sm" aria-label="Playback speed {label}">
				<Gauge class="size-4" />
				<span class="ml-0.5 text-xs tabular-nums">{label}</span>
				{#if ramp}<ChevronsUp class="size-3 text-primary" />{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="start" class="w-48">
		<DropdownMenu.Label>Speed</DropdownMenu.Label>
		{#each SPEED_STEPS as step (step)}
			<DropdownMenu.Item onclick={() => onselect(step)}>
				<span class="tabular-nums">{step}×</span>
				{#if cap === step}<Check class="ml-auto size-3.5 text-primary" />{/if}
			</DropdownMenu.Item>
		{/each}
		<DropdownMenu.Separator />
		<DropdownMenu.Label class="flex items-center justify-between gap-3">
			<span>Auto ramp</span>
			<Switch checked={ramp} onCheckedChange={(next) => ontoggle(next)} />
		</DropdownMenu.Label>
		<p class="px-2 pb-2 text-xs text-muted-foreground">
			+0.1× every 2 minutes up to the speed above.
		</p>
	</DropdownMenu.Content>
</DropdownMenu.Root>
```

- [ ] **Step 2: Player state** — in `player.svelte` script: import `SpeedMenu`, `saveVoiceSpeed`, `DEFAULT_SPEED`; extend `$props`:

```ts
	let {
		items,
		engine,
		voice,
		compact = false,
		onPlayed,
		speed = 1,
		ramp = false
	}: {
		items: Item[];
		engine: EngineId;
		voice: string;
		compact?: boolean;
		onPlayed?: (id: string) => void;
		/** Saved cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
	} = $props();

	/** Mirrors the props so menu edits win until settings refresh lands. */
	let cap = $state(speed);
	let rampOn = $state(ramp);
	/** What is actually playing: the cap, or the climbing value while ramping. */
	let liveSpeed = $state(DEFAULT_SPEED);

	const RAMP_MS = 120_000;
```

- [ ] **Step 3: Reactivity** — after the existing derived state:

```ts
	// Follow external prop changes (settings refresh from another control).
	$effect(() => {
		cap = speed;
	});
	$effect(() => {
		rampOn = ramp;
	});
	// No ramp ⇒ play at the cap; ramp on ⇒ climb is handled by the timer.
	$effect(() => {
		if (!rampOn) liveSpeed = cap;
	});
	// +0.1× every 2 minutes of *playing* time; pauses never count.
	$effect(() => {
		if (!rampOn || status !== 'playing') return;
		let last = performance.now();
		const id = setInterval(() => {
			const now = performance.now();
			if (now - last >= RAMP_MS) {
				last = now;
				liveSpeed = Math.min(Math.round((liveSpeed + 0.1) * 10) / 10, cap);
			}
		}, 1000);
		return () => clearInterval(id);
	});
```

- [ ] **Step 4: Handlers** (near `toggle`/`stop`) — persistence is best-effort so signed-out `/read` stays session-only:

```ts
	function persist(next: { speed: number; ramp: boolean }) {
		void saveVoiceSpeed(next).catch(() => {
			/* signed out — keep it session-local */
		});
	}

	function selectSpeed(next: number) {
		cap = next;
		liveSpeed = rampOn ? Math.min(liveSpeed, next) : next;
		persist({ speed: next, ramp: rampOn });
	}

	function setRamp(next: boolean) {
		rampOn = next;
		// Ramp always climbs towards the cap: start at 1.0 (never below the cap).
		liveSpeed = next ? Math.min(1, cap) : cap;
		persist({ speed: cap, ramp: next });
	}
```

- [ ] **Step 5: Feed the live speed to `speak()`** inside `start()`:

```ts
				await speak(engine, voice, parts[s]!, (message) => toast.error(message), liveSpeed);
```

- [ ] **Step 6: Render the menu** — inside the control row, after the Previous/Next block and before the Stop button:

```svelte
<SpeedMenu {cap} ramp={rampOn} live={liveSpeed} onselect={selectSpeed} ontoggle={setRamp} />
```

(works in compact mode too — it renders as an `icon-sm` button.)

- [ ] **Step 7: Gate + autofix**

Run: `bun run check && bunx prettier --write src/lib/components/player/`
Run `mcp_svelte_mcp_svelte-autofixer` on `speed-menu.svelte` and `player.svelte`.
Expected: `0 errors and 0 warnings`, autofixer reports no issues.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/player/
git commit -m "feat(player): speed menu with auto-ramp timer"
```

---

### Task 4: Wire speed/ramp through every player caller

**Files:**

- Modify: `src/lib/components/inbox/message-view.svelte`
- Modify: `src/lib/components/inbox/message-panel.svelte`
- Modify: `src/routes/(app)/dashboard/+page.svelte`
- Modify: `src/routes/(app)/digest/+page.svelte`
- Modify: `src/routes/(app)/inbox/[id]/+page.svelte`
- Modify: `src/routes/(app)/settings/+page.svelte`

**Interfaces:**

- Consumes: Player props `speed`/`ramp`; `SPEED_STEPS`, `saveVoiceSpeed`.

- [ ] **Step 1: `message-panel.svelte`** — the `$props` destructure gains two entries after `voice`:

```ts
	let {
		item,
		engine,
		voice,
		speed = 1,
		ramp = false,
		onsaved
	}: {
		item: InboxItem;
		engine: EngineId;
		voice: string;
		/** Saved speed cap (settings.ttsSpeed). */
		speed?: number;
		/** Saved auto-ramp flag (settings.ttsRamp). */
		ramp?: boolean;
		/** Fresh row after a successful Re-organize — the host swaps it into its own snapshot. */
		onsaved?: (fresh: MessageDto) => void;
	} = $props();
```

and its `<Player>` usage becomes:

````svelte
<Player
	compact
	{engine}
	{voice}
	{speed}
	{ramp}
	items={[
		{
			id: item.id,
			title: item.subject,
			text: [item.summary ?? '', full.bodyText].filter(Boolean).join('\n\n').slice(0, 2000)
		}
	]}
/>

```svelte
<MessagePanel {item} {engine} {voice} {speed} {ramp} {onsaved} />
````

- [ ] **Step 3: pages** — inside the existing `{#await settings then cfg}` blocks:

```svelte
	<!-- dashboard (+page.svelte, the MessageView call) -->
	<MessageView {open} item={selectedItem} engine={cfg.ttsEngine as EngineId} voice={cfg.ttsVoice}
		speed={cfg.ttsSpeed} ramp={cfg.ttsRamp} …rest unchanged />

	<!-- digest (+page.svelte, the Player call) -->
	<Player engine={cfg.ttsEngine} voice={cfg.ttsVoice} speed={cfg.ttsSpeed} ramp={cfg.ttsRamp} …rest unchanged />

	<!-- inbox/[id] (+page.svelte, the MessagePanel call) -->
	<MessagePanel {item} engine={cfg.ttsEngine as EngineId} voice={cfg.ttsVoice}
		speed={cfg.ttsSpeed} ramp={cfg.ttsRamp} {onsaved} />
```

- [ ] **Step 4: settings page** — add state + handlers next to `voice`:

```ts
	// svelte-ignore state_referenced_locally
	let speed = $state(data.settings.ttsSpeed ?? 1);
	// svelte-ignore state_referenced_locally
	let rampOn = $state(data.settings.ttsRamp ?? false);

	function speedChanged(event: Event) {
		speed = Number((event.currentTarget as HTMLSelectElement).value);
		void saveVoiceSpeed({ speed, ramp: rampOn }).catch(() => {});
	}

	function rampChanged(checked: boolean) {
		rampOn = checked;
		void saveVoiceSpeed({ speed, ramp: checked }).catch(() => {});
	}
```

imports: `Switch` from `$lib/components/ui/switch`, `saveVoiceSpeed` from `$lib/remote`, `SPEED_STEPS` from `$lib/tts`.
In the Voice card after the voice select block add:

```svelte
<div class="space-y-1.5">
	<Label for="ttsSpeed">Speed</Label>
	<select
		id="ttsSpeed"
		class="flex h-8 w-full border border-input bg-background px-2 text-sm"
		value={String(speed)}
		onchange={speedChanged}
	>
		{#each SPEED_STEPS as step (step)}
			<option value={String(step)}>{step}×</option>
		{/each}
	</select>
</div>

<div class="flex items-center justify-between gap-3 border border-border p-3">
	<div>
		<Label for="ttsRamp">Auto ramp</Label>
		<p class="text-xs text-muted-foreground">+0.1× every 2 minutes up to the speed above.</p>
	</div>
	<Switch id="ttsRamp" checked={rampOn} onCheckedChange={rampChanged} />
</div>
```

and extend the test player: `<Player compact {engine} {voice} speed={speed} ramp={rampOn} items={[…unchanged]} />`.

- [ ] **Step 5: Gate + commit**

```bash
bun run check && bunx prettier --write "src/lib/components/inbox/*.svelte" "src/routes/(app)/**/+page.svelte"
git add -A src/lib/components/inbox src/routes
git commit -m "feat(ui): pass speed and ramp to every player"
```

---

### Task 5: Public `/read` route

**Files:**

- Create: `src/routes/read/+page.server.ts`
- Create: `src/routes/read/+page.svelte`

**Interfaces:**

- Consumes: `getSettings` (`$lib/server/settings`), Player, `ENGINES`.
- Produces: public `/read`; `data.settings = { ttsEngine, ttsVoice, ttsSpeed, ttsRamp } | null`.

- [ ] **Step 1: `+page.server.ts`** (never redirects — no session ⇒ defaults):

```ts
import { getSettings } from '$lib/server/settings';

export async function load({ locals }) {
	if (!locals.user) return { settings: null };
	const s = await getSettings(locals.user.id);
	return {
		settings: {
			ttsEngine: s.ttsEngine,
			ttsVoice: s.ttsVoice,
			ttsSpeed: s.ttsSpeed,
			ttsRamp: s.ttsRamp
		}
	};
}
```

- [ ] **Step 2: `+page.svelte`**

```svelte
<script lang="ts">
	import type { Snapshot } from '@sveltejs/kit';
	import { ClipboardPaste } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import Player from '$lib/components/player/player.svelte';
	import { ENGINES, type EngineId } from '$lib/tts';

	let { data } = $props();

	let text = $state('');
	let engine = $state<EngineId>((data.settings?.ttsEngine as EngineId) ?? 'kitten');
	let voice = $state(data.settings?.ttsVoice ?? ENGINES.kitten.defaultVoice);

	const meta = $derived(ENGINES[engine]);
	const words = $derived(text.trim() ? text.trim().split(/\s+/).length : 0);
	const items = $derived(text.trim() ? [{ id: 'paste', text }] : []);

	/** Survive back-navigation; the text is never sent anywhere. */
	export const snapshot: Snapshot<string> = {
		capture: () => text,
		restore: (value) => (text = value)
	};

	function engineChanged(event: Event) {
		engine = (event.currentTarget as HTMLSelectElement).value as EngineId;
		voice = ENGINES[engine].defaultVoice;
	}
</script>

<svelte:head>
	<title>Paste & read · Kikitai</title>
	<meta
		name="description"
		content="Paste any text and hear it read aloud in your browser — free, offline, nothing uploaded."
	/>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6 sm:px-6">
	<header class="flex items-center justify-between">
		<a href="/" class="font-heading text-lg italic">Kikitai</a>
		<Button href="/" variant="ghost" size="sm">Home</Button>
	</header>

	<h1 class="mt-6 flex items-center gap-2 font-heading text-2xl italic">
		<ClipboardPaste class="size-5 text-primary" /> Paste &amp; read
	</h1>
	<p class="mt-1 text-sm text-muted-foreground">
		Anything you paste is read aloud right here. It stays on this device — no upload, no account
		needed.
	</p>

	<div class="mt-6 space-y-1.5">
		<Label for="pasteText">Text</Label>
		<textarea
			id="pasteText"
			rows={10}
			bind:value={text}
			placeholder="Paste an article, a chapter, a PDF page…"
			class="flex w-full border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:opacity-50"
		></textarea>
		<p class="text-xs text-muted-foreground">{words} words · nothing leaves your device</p>
	</div>

	<div class="mt-4 flex flex-wrap items-end gap-3">
		<div class="space-y-1.5">
			<Label for="readEngine">Engine</Label>
			<select
				id="readEngine"
				class="flex h-8 border border-input bg-background px-2 text-sm"
				value={engine}
				onchange={engineChanged}
			>
				{#each Object.values(ENGINES) as option (option.id)}
					<option value={option.id}>{option.label}</option>
				{/each}
			</select>
		</div>
		{#if meta.voices.length > 0}
			<div class="space-y-1.5">
				<Label for="readVoice">Voice</Label>
				<select
					id="readVoice"
					class="flex h-8 border border-input bg-background px-2 text-sm"
					bind:value={voice}
				>
					{#each meta.voices as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
			</div>
		{/if}
	</div>

	<div class="mt-4 border border-border p-3">
		<Player
			{items}
			{engine}
			{voice}
			speed={data.settings?.ttsSpeed ?? 1}
			ramp={data.settings?.ttsRamp ?? false}
		/>
	</div>
</div>
```

(`snapshot` lives in the instance script — SvelteKit reads `export const snapshot` from the component. The speed/ramp the player menu changes are persisted by the player itself when signed in, session-only otherwise.)

- [ ] **Step 3: Gate + autofix**

Run: `bun run check && bunx prettier --write src/routes/read/`
Run `mcp_svelte_mcp_svelte-autofixer` on `src/routes/read/+page.svelte`.
Expected: `0 errors and 0 warnings`.

- [ ] **Step 4: Browser check** (dev server already on :5173, no new server)

Open `http://localhost:5173/read` in the integrated browser (signed out):

- page renders, no redirect to `/login`
- paste 2 sentences → word count updates
- navigate to `/` and back → text still there (snapshot)
- Web Speech engine (0MB) plays immediately — no model download, no data cost

- [ ] **Step 5: Commit**

```bash
git add src/routes/read
git commit -m "feat(read): public paste-and-read route"
```

---

### Task 6: Advertise on homepage + README

**Files:**

- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/components/landing/faq.svelte`
- Modify: `README.md`

- [ ] **Step 1: Homepage `inside` entry** — in `src/routes/+page.svelte`, add `ClipboardPaste` to the `@lucide/svelte` import and append after the `Ban` ("What it cannot do") entry:

```ts
		{
			icon: ClipboardPaste,
			label: 'Paste & read',
			value:
				'Any text you copy — an article, a chapter, a PDF page — pasted into /read and read aloud at 0.75×–3×, with an optional auto-ramp that speeds up as you listen.'
		}
```

- [ ] **Step 2: Hero CTA** — inside the existing `Reveal delay={240}` button row, after the "See how it works" button:

```svelte
<Button size="lg" variant="secondary" href={resolve('/read')}>
	<ClipboardPaste class="size-4" />
	Try paste &amp; read
</Button>
```

- [ ] **Step 3: FAQ entry** — in `faq.svelte`, after the "What is the catch on the voice download?" entry:

```ts
		{
			q: 'Can it read something that is not an email?',
			a: 'Yes — open /read, paste anything (an article, a chapter, a PDF page) and press play. It runs entirely in your browser at 0.75× to 3× speed, with an optional auto-ramp that gets faster as you listen. Nothing is uploaded.'
		},
```

- [ ] **Step 4: README** — feature list (next to the "Local voices by default" bullet):

```markdown
- **A free local reader** — `/read` takes any pasted text and reads it aloud: speeds
  0.75×–3×, an auto-ramp that adds 0.1× every two minutes up to your chosen cap, no account
  needed. Text never leaves the device.
```

…and a new section after `## Voices`:

```markdown
## Paste & read

`/read` is a standalone reader: paste an article, a chapter or a PDF page and press play. It
runs entirely in the browser — **nothing is uploaded, no sign-in required** (sign in and it
picks up your saved engine, voice and speed).

| Control   | Values                                                     |
| --------- | ---------------------------------------------------------- |
| Speed     | 0.75× · 1× · 1.25× · 1.5× · 1.75× · 2× · 2.5× · 3×         |
| Auto ramp | +0.1× every 2 minutes of playback, up to your chosen speed |
```

- [ ] **Step 5: Gate + commit**

```bash
bun run check && bunx prettier --write src/routes/+page.svelte src/lib/components/landing/faq.svelte README.md
git add src/routes/+page.svelte src/lib/components/landing/faq.svelte README.md
git commit -m "docs: advertise paste-and-read and speed controls"
```

---

### Task 7: Full verification pass

**Files:** none (verification only) + memory updates.

- [ ] **Step 1: Static gates**

```bash
bun run check          # 0 errors / 0 warnings
bunx prettier --check . # all clean
```

- [ ] **Step 2: Autofix every touched `.svelte` file** with `mcp_svelte_mcp_svelte-autofixer`: `speed-menu.svelte`, `player.svelte`, `message-view.svelte`, `message-panel.svelte`, `settings/+page.svelte`, `read/+page.svelte`, `+page.svelte` (landing), `faq.svelte`.

- [ ] **Step 3: Browser functional pass** (existing :5173, no new servers)

1. Settings → Voice: pick `1.5×`, flip Auto ramp on → reload → both persist (`select` shows 1.5×, switch on).
2. Digest/dashboard player: play with Web Speech (0 MB — no model download) at 2× → audio clearly faster; badge shows the live value.
3. Ramp check: temporarily set `RAMP_MS = 5_000` in `player.svelte`, play, watch the badge climb 1 → 1.1 → 1.2 → stop at the cap; **revert the constant** and re-run `bun run check`.
4. `/read` signed out: paste → play → back/forth → text survives; engine switch updates voices.
5. Console: no unhandled rejections (signed-out `saveVoiceSpeed` must be swallowed).

- [ ] **Step 4: Memory**

Update `/memories/repo/kikitai.md` (features + `SPEED_STEPS`/`RAMP_MS` facts) and create a Sepia fact tied to the Kikitai entity (what shipped, ramp rule, `/read` semantics).

- [ ] **Step 5: Final commit if anything changed during verification**

```bash
git add -A && git commit -m "fix: verification cleanups for speed and /read"
```
