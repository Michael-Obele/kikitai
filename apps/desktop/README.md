# @kikitai/desktop

Kikitai as a desktop app. Tauri v2 wraps the SvelteKit frontend as a static SPA; the
web backend (`apps/web`) still serves auth, mail sync, and the API.

## Run it

```sh
bun run dev    # dev server (or `vp -C apps/desktop dev` from the repo root)
bun run check  # svelte-check
bun run build  # static SPA build; `tauri` commands bundle the installer
```

Playback parity with the web player matters here: voices must use the same ONNX WASM
builds. Details live in `../../.agents/skills/tauri-v2/SKILL.md`.
