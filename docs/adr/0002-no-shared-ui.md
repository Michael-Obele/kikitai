# ADR 0002 — No Shared UI Package (Recreate Per Shell)

**Status:** Accepted (2026-10-18).
**Context:** `player.svelte`, `voice-picker`, `reader-settings` exist in `apps/web` (Svelte 5 runes + Tailwind v4 + shadcn-svelte). Sharing them via `packages/ui` was proposed.
**Decision:** UI stays in `apps/web` and each shell recreates its reader natively: touch idioms + Capgo nav (mobile), titlebar/shortcuts/window-restore (desktop), Compose M3 Expressive (Kotlin). Only backend contracts are shared (`packages/contracts` Valibot DTOs + `/api/app/v1/*` REST over HTTP).
**Alternatives considered:** (a) `packages/ui` with shadcn-svelte + Tailwind `@source` + alias trick — rejected per user decision: premature abstraction, cross-shell idioms diverge (safe-area vs titlebar vs M3), extraction cost exceeds copy cost until pattern settles.
**Consequences:** Duplication of reader chrome is intentional. Shared surface is DTOs + HTTP semantics + hybrid TTS ladder (ONNX WASM via jsDelivr CDN + native fallback + cloud opt-in). Revisit only after two shells ship an identical control.
