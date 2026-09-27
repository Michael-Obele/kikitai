# Speed control, auto-ramp & paste-and-read — design

**Date:** 2026-09-27 · **Status:** approved by Michael (design gate passed in-session)

## Goal

1. Let users read **faster or slower** (0.75×–3×) in every engine.
2. Offer **auto speed increase** ("speed ramping") like paid readers.
3. Add a **public paste-and-read route** so the app doubles as a local reader.
4. **Advertise** the reader on the homepage and README.

## Research basis

- Speechify — *"automatic speed ramping … increase speed slightly every few minutes or
  after a set amount of text … the brain adapts without losing comprehension."*
  (speechify.com/blog/how-to-listen-faster/)
- Rightspeed — concrete rule: **+0.1× every 2 minutes** of playback, "frog in warming
  water" (techcrunch.com/2016/04/26/rightspeed…).
- Audible — fixed narration-speed steps only, no ramp.
- Engine APIs (verified from npm typings):
  - `kitten-tts-js@0.1.2` → `generate(text, { voice?, speed?, clean? })`, `speed` default 1.0
  - `kokoro-js@1.2.1` → `generate(text, { voice?, speed? })`, `speed` default 1
  - Web Speech → `SpeechSynthesisUtterance.rate`
  - Google/MiniMax → decoded `Audio` element → `playbackRate`

## Decisions (user answers)

| Question | Answer |
| --- | --- |
| Where does paste-and-read live? | **Public `/read`**, outside the login-guarded `(app)` group |
| Where does speed live? | **DB setting** (`ttsSpeed`), like `ttsEngine`/`ttsVoice` |
| Auto-speed behaviour? | **Fixed steps + ramp to a chosen cap** — steps `0.75 · 1 · 1.25 · 1.5 · 1.75 · 2 · 2.5 · 3`, separate **Auto ramp** toggle, ramp = +0.1× per 2 min of playing time until the selected step (the cap) |
| Speed application | **Approach A** — native `speed` for Kitten/Kokoro, `utterance.rate` for Web Speech, `playbackRate` (+ `preservesPitch`) for cloud audio |

## Architecture

```
src/lib/tts/index.ts          speed plumbing: speak(..., speed), SPEED_STEPS
src/lib/components/player/
  player.svelte               speed state, ramp timer, control in the control row
  speed-menu.svelte           NEW — shadcn DropdownMenu: 8 steps + Auto-ramp Switch
src/lib/server/db/schema.ts   + ttsSpeed real default 1, + ttsRamp boolean default false
src/lib/server/settings.ts    DTO get/save both fields (fallbacks from env)
src/lib/remote/settings.remote.ts  valibot schema + saveSettings fields
src/routes/(app)/settings/    speed select + Auto-ramp switch
src/routes/read/              NEW public route: +page.server.ts (settings or defaults),
                              +page.svelte (Textarea + Player + engine/voice/speed)
src/routes/+page.svelte       landing: ClipboardPaste entry + CTA to /read + FAQ
README.md                     feature bullet + "Paste & read" section
```

### Data flow

`settings row → load → player props (speed, ramp) → speak(engine, voice, sentence,
onError, speed)`; the ramp timer mutates a *session* speed value that is capped by the
saved `ttsSpeed`. Speed/ramp edits go through the existing `saveSettings` remote and
re-render the player via the page's `data.settings`.

### Ramp semantics (exact)

- Ramp **off**: playback speed = the selected step, immediately.
- Ramp **on**: session speed starts at `1.0`, every **120 000 ms of `status === 'playing'`
  time** it becomes `min(speed + 0.1, cap)`, where `cap` = saved `ttsSpeed`.
- Paused/stopped time never counts. The timer is invalidated by the player's existing
  `run` generation counter and cleared on `stop()`/unmount.
- The badge always shows the live value (`1.4×`), even between steps.
- Switching ramp off jumps straight to the cap.

### `/read` specifics

- `+page.server.ts` reads `locals.user`; with a session it returns the saved settings,
  otherwise env/DB-free defaults (`kitten`, `expr-voice-2-f` → engine default voice,
  `1`, `false`). **Never redirects** — the route is the public demo.
- Pasted text is kept only in component state and a SvelteKit **snapshot**
  (`export const snapshot = { capture, restore }`) so back-navigation does not lose it.
  Deliberately no localStorage/DB: "text never leaves your device" stays literal.
- Engine download notice stays intact (Player already owns it; localStorage ack key is
  origin-scoped, so `/read` shows the ~57MB notice once per origin).

## Error handling

- Any engine + speed combination is valid (all five apply speed their own way).
- `playbackRate`/`preservesPitch` assignments are feature-detected (`'preservesPitch' in el`).
- Ramp interval cleared by `run` counter; `$effect` cleanup on unmount.
- `/read` with no session must not throw (defaults path has no DB call).

## Verification

Repo has **no test runner** (no `test` script) — the quality gate is the established one:

1. `bun run check` → 0 errors / 0 warnings, `bunx prettier --write <touched>`.
2. `mcp_svelte_mcp_svelte-autofixer` on every touched `.svelte` file.
3. Browser pass: play at 1.5× (audio shorter, pitch intact on local engines), toggle ramp
   with a temporarily shortened interval (2 min → 5 s) and watch the badge climb to the
   cap, `/read` works signed-out, snapshot survives navigation.
4. `bun run db:push` for the two new columns (local Docker Postgres).

## Out of scope (YAGNI)

- Streaming/word-level highlighting, per-item speed, cloud re-synthesis at speed,
  speed presets per engine, persisting pasted text server-side, file uploads for `/read`.
