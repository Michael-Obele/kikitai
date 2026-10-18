# @kikitai/mobile

Kikitai as an installable mobile app. Capacitor 7 wraps the SvelteKit frontend as a
static SPA; the web backend (`apps/web`) still serves auth, mail sync, and the API.

## Run it

```sh
bun run dev    # dev server (or `vp -C apps/mobile dev` from the repo root)
bun run check  # svelte-check
bun run build  # static SPA build; native packaging (`cap sync` + Xcode/Gradle) runs on release tags
```

Sign-in uses native Google sign-in wired to Better Auth; the WebView never sees raw
tokens. Details live in `../../.agents/skills/capacitor-svelte/SKILL.md`.
