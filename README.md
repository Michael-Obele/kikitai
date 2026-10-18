![Kikitai: your inbox, read aloud](.github/assets/banner.svg)

# Kikitai

[![Built with Vite+](https://img.shields.io/badge/built%20with-Vite%2B-6254FE?style=flat&logo=vite&logoColor=white)](https://viteplus.dev)
[![Release](https://img.shields.io/github/v/release/Michael-Obele/kikitai)](https://github.com/Michael-Obele/kikitai/releases)

> **聞きたい** (ききたい, _kikitai_) — Japanese for "I want to hear it."

I built Kikitai because my inbox kept growing and my time did not. Connect Gmail and it
sorts, sums up, and reads your mail aloud in a voice that runs on your device and costs
nothing.

- **Read-only.** One Gmail scope, `gmail.readonly`. Nothing here can send, delete, or
  relabel mail. Sorting lives in this app's own database, never written back to Gmail.
- **Your AI, your choice.** Any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, or a
  local Ollama / LM Studio. It is one Settings value, not a code change.
- **Voices that run on your device.** Kitten (~57MB) and Kokoro (~90MB) load once in the
  browser, then work offline. Web Speech is the zero-download fallback.
- **A free reader.** `/read` reads any pasted text aloud at 0.75x to 3x, with an auto-ramp
  that climbs 0.1x every two minutes. Nothing is uploaded, no account needed.
- **Self-hosted.** Docker Compose or Netlify, Postgres included.

## Contents

- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Connect Gmail](#connect-gmail)
- [AI endpoint](#ai-endpoint)
- [Voices](#voices)
- [Self-host](#self-host)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

## Repository layout

A Bun workspaces monorepo. Vite+ by VoidZero (`vp` CLI) owns the toolchain: dev server,
lint, format, and cached task runs from one root config.

| Path                  | What it is                                                 |
| --------------------- | ---------------------------------------------------------- |
| `apps/web`            | The app. SvelteKit + Postgres + Better Auth + Gmail + TTS. |
| `apps/mobile`         | Same app as an installable mobile app (Capacitor 7).       |
| `apps/desktop`        | Same app as a desktop app (Tauri v2).                      |
| `apps/android-native` | Thin native Android client (Kotlin + Compose).             |
| `packages/contracts`  | Valibot DTOs shared by the web app and every client.       |

Each package has its own README with setup notes. Start with `apps/web`.

## Quick start

You need [Bun](https://bun.sh) 1.4.3 and Node 24 (Vite+ runs on Node). Postgres can be
the Docker container below, or a hosted project.

```sh
bun install
cp apps/web/.env.example apps/web/.env  # then fill in DATABASE_URL and the values below
bun --filter @kikitai/web db:push        # creates the tables (Drizzle schema)
bun run dev                              # serves apps/web at http://localhost:5173
```

`ORIGIN` in `apps/web/.env` must match the URL you open. Better Auth builds the Google
callback URL from it.

Commands run from the repo root unless a package README says otherwise:

| Command           | What it does                                     |
| ----------------- | ------------------------------------------------ |
| `bun run dev`     | dev server for `apps/web`                        |
| `bun run lint`    | lint the repo (`vp check`)                       |
| `bun run format`  | format everything (`vp fmt --write`)             |
| `vp run -r build` | build every package in dependency order (cached) |
| `vp cache clean`  | clear the Vite Task cache                        |

## Connect Gmail

`gmail.readonly` is a restricted scope. A client in Testing mode that only you authorize
needs no Google verification at all, which is why self-hosting ships first.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **OAuth consent screen:** user type External, add
   `https://www.googleapis.com/auth/gmail.readonly`, stay in Testing, add your Gmail
   address under Test users.
3. **Credentials:** create an OAuth client ID (Web application) with redirect URI
   `http://localhost:5173/api/auth/callback/google`. Copy the ID and secret.
4. Enable the Gmail API under **APIs & Services → Library**.
5. Put both values in `apps/web/.env` and sign in with Google, then press
   **Connect Gmail** on the Inbox page.

The full walkthrough lives in [`docs/google-oauth.md`](docs/google-oauth.md). Tokens are
encrypted at rest with `AUTH_TOKEN_SECRET`. Sign-in is Google-only on purpose: with no
password signup, a deployment you leave reachable still only admits your test users.

## AI endpoint

Settings → **AI endpoint**. Any OpenAI-compatible base URL + model (+ key, unless local):

| Provider   | Base URL                         | Model example             |
| ---------- | -------------------------------- | ------------------------- |
| OpenAI     | `https://api.openai.com/v1`      | `gpt-4o-mini`             |
| Groq       | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1`   | `openai/gpt-4o-mini`      |
| Ollama     | `http://localhost:11434/v1`      | `llama3.2`                |

Defaults can be baked into `apps/web/.env` (`AI_BASE_URL`, `AI_KEY`, `AI_MODEL`).
Per-user Settings override them. The key is stored encrypted and only ever sent to the
base URL you configured. Failures are non-fatal: the inbox still renders raw, and each
message gets a **Re-organize** button.

## Voices

| Engine      | Download | Runs where   | Notes                           |
| ----------- | -------- | ------------ | ------------------------------- |
| `kitten`    | ~57MB    | your browser | default, Apache-2.0, 8 voices   |
| `kokoro`    | ~90MB    | your browser | hi-fi option, WebGPU if present |
| `webspeech` | 0MB      | OS voices    | instant fallback                |
| `google`    | 0MB      | Google       | opt-in, needs `GOOGLE_TTS_KEY`  |
| `minimax`   | 0MB      | MiniMax      | opt-in, needs `MINIMAX_*`       |

Local engines lazy-load from `PUBLIC_TTS_CDN` the first time you press Play, with an
explicit "downloads ~57MB once" notice. Text for local engines never leaves the device.
The tradeoffs are spelled out in [`docs/hybrid-tts-matrix.md`](docs/hybrid-tts-matrix.md).

## Self-host

All deploy files live in `apps/web` (`compose.yaml`, `Dockerfile`, `netlify.toml`).

```sh
cd apps/web
cp .env.example .env       # set BETTER_AUTH_SECRET, AUTH_TOKEN_SECRET, Google + AI values
docker compose up --build  # app on :3000, Postgres on :5432
docker compose exec app bun run db:push
```

Put Caddy or nginx with TLS in front in production, and set `ORIGIN` to the public URL.

On Netlify, the adapter is picked automatically (`adapter-netlify` on Netlify,
`adapter-node` elsewhere). Set env vars in **Site configuration → Environment
variables** before the first deploy, since `PUBLIC_*` values bake in at build time.
Two limits to know: functions time out after 10s (26s on a paid plan), so slow AI calls
can fail while browser voices keep working; and `DATABASE_URL` must be hosted Postgres,
since the Docker database is not reachable from Netlify.

## Environment variables

Values live in `apps/web/.env`. The Docker compose file reads the same names.

| Variable                               | Required        | Purpose                                                                |
| -------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                         | yes             | Postgres connection string                                             |
| `BETTER_AUTH_SECRET`                   | yes             | session signing (`openssl rand -base64 32`)                            |
| `AUTH_TOKEN_SECRET`                    | yes             | encrypts OAuth tokens + the AI key at rest                             |
| `ORIGIN`                               | yes             | canonical origin; builds the Google callback URL                       |
| `TRUSTED_ORIGINS`                      | for 2nd domain  | comma-separated extra origins                                          |
| `GOOGLE_CLIENT_ID`                     | for mail        | your OAuth client                                                      |
| `GOOGLE_CLIENT_SECRET`                 | for mail        | your OAuth client                                                      |
| `AI_BASE_URL` / `AI_KEY` / `AI_MODEL`  | no              | defaults for the Settings form                                         |
| `TTS_ENGINE`                           | no              | `kitten` (default) \| `kokoro` \| `webspeech` \| `google` \| `minimax` |
| `GOOGLE_TTS_KEY`                       | for cloud voice | Google Cloud text-to-speech                                            |
| `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` | for cloud voice | MiniMax                                                                |
| `PUBLIC_TTS_CDN`                       | no              | npm CDN base for the local engines                                     |

## Architecture

```
apps/web/src/
  lib/
    types/mail.ts     Valibot schemas shared by client + server (DTOs, filters, settings)
    server/
      auth.ts         Better Auth (Google-only sign-in, Drizzle adapter)
      db/             Drizzle schema: auth tables, mail_account, message, settings
      gmail.ts        Gmail REST client (list, get, parse to plain text)
      ai.ts           OpenAI-compatible client, strict JSON, one retry on parse failure
      organize.ts     batch-classify pending messages
      settings.ts     per-user settings, env fallbacks, encrypted key
      tokens.ts       AES-256-GCM at rest
    remote/           SvelteKit remote functions (query / command / form)
    tts/              engine registry, lazy CDN loaders, playback
    components/       ui/ (shadcn-svelte) + inbox, player, app shell
  routes/
    +page.svelte      landing
    login/            sign in
    (app)/dashboard/  inbox: sync, filters, categories, message view
    (app)/digest/     listening order + play-all player
    (app)/settings/   AI endpoint, voice, sync window
packages/contracts/src/index.ts
  mail, settings, importUrl DTOs every client imports
```

Decisions are recorded in [`docs/adr`](docs/adr). Validation runs through Valibot on both
sides: every remote-function argument and every AI JSON response. Stack: SvelteKit 2 +
Svelte 5 runes, Tailwind CSS v4, shadcn-svelte, Drizzle ORM + Postgres, Better Auth, Bun,
Vite+ task running and checks.

Security notes: the only Gmail scope is `gmail.readonly`, with no code path that sends
or deletes mail. Message text only goes to the AI endpoint you configured; with a local
model, nothing leaves. No telemetry in v1.

## Contributing

Issues and pull requests are welcome. Two things save a round trip: versions and
changelogs are cut by release-please, so leave `CHANGELOG.md` files alone; and the
pre-commit hook (`vp staged`) formats staged files, so CI only complains about real
problems.

## Roadmap

- [ ] Public launch: Google verification + CASA assessment
- [ ] Draft replies, IMAP/Outlook, digest as MP3 export, non-English voices
- [ ] Screenshots in this README once the OAuth walkthrough is exercised end-to-end

## License

There is no license file yet, so the code is not licensed for reuse. If you need one,
open an issue and I will pick one.
