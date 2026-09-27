# Kikitai

> **聞きたい** (ききたい, _kikitai_) — Japanese, **"I want to hear it."**

A self-hosted, open-source AI email organizer that **reads your mail aloud**.

Connect Gmail → the AI categorizes, summarizes and prioritizes it → a local neural voice reads the digest
in your browser. Open-source AI assistants all triage and summarize; none of them read your mail to you.
Audio is the differentiator, and it costs **$0 forever** because synthesis runs on your device.

- **Read-only** — one restricted scope, `gmail.readonly`. Nothing in this codebase can send, delete,
  modify or label mail. "Organizing" happens in this app's own database, never written back to Gmail.
- **BYO-AI** — any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, or a local Ollama / LM Studio.
  It is one Settings value, not a code change.
- **Local voices by default** — Kitten (~57MB) and Kokoro (~90MB) load once in the browser, then work
  offline. Web Speech is the zero-download fallback. Google/MiniMax cloud voices are opt-in.
- **A free local reader** — `/read` takes any pasted text and reads it aloud: speeds
  0.75×–3×, an auto-ramp that adds 0.1× every two minutes up to your chosen cap, no account
  needed. Text never leaves the device.
- **Self-hosted** — `docker compose up`, or `bun run dev` for development.

## Quick start (development)

Prerequisites: [Bun](https://bun.sh) ≥ 1.4 and a Postgres database (a Neon project, or the local
container below).

```sh
bun install                 # installs dependencies
cp .env.example .env        # then fill in DATABASE_URL (+ Google/AI values, see below)
bun run db:push             # creates the tables (Drizzle schema)
bun run dev                 # http://localhost:5173
```

> `ORIGIN` in `.env` must match the origin you actually serve on — the dev server prints it, and
> Better Auth builds the Google callback URL from it.

Scripts:

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `bun run dev`       | dev server                                 |
| `bun run check`     | `svelte-kit sync` + `svelte-check` (types) |
| `bun run format`    | Prettier write                             |
| `bun run db:push`   | push the Drizzle schema to `DATABASE_URL`  |
| `bun run db:studio` | Drizzle Studio (browse tables)             |
| `bun run build`     | production build (adapter-node → `build/`) |

Prefer a local database instead of Neon?

```sh
bun run db:start   # docker compose up db
```

## Google OAuth — your own client (5 minutes)

`gmail.readonly` is a **restricted** scope. A public deployment would need Google verification + a CASA
security assessment, but a client in _Testing_ mode that only you authorize needs **no verification at
all** — that is why self-hosting ships first.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create a project (any name).
2. **APIs & Services → OAuth consent screen**
   - User type: **External** → fill the app name and your email.
   - Scopes: add **`https://www.googleapis.com/auth/gmail.readonly`** (plus the automatic
     `email`/`profile`).
   - Save it while still in **Testing**. Add your Gmail address under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:5173/api/auth/callback/google`
     (use your real origin in production, e.g. `https://mail.example.com/api/auth/callback/google`).
   - Copy the **client ID** and **client secret**.
4. Enable the Gmail API: **APIs & Services → Library → Gmail API → Enable**.
5. Put both values in `.env`:

```env
GOOGLE_CLIENT_ID="…apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="…"
ORIGIN="http://localhost:5173"     # must match the redirect URI origin
```

Sign in with Google (it asks for consent — that is what mints the refresh token), then press
**Connect Gmail** on the Inbox page. Tokens are encrypted at rest with `AUTH_TOKEN_SECRET`.

Sign-in is **Google-only** — email/password is deliberately disabled server-side, so a deployment
you accidentally leave reachable can't be signed up on; only the test users you listed on the consent
screen can get in.

## AI endpoint

Settings → **AI endpoint**. Any OpenAI-compatible `base URL` + `model` (+ key, unless it is local):

| Provider   | Base URL                         | Model example             |
| ---------- | -------------------------------- | ------------------------- |
| OpenAI     | `https://api.openai.com/v1`      | `gpt-4o-mini`             |
| Groq       | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| OpenRouter | `https://openrouter.ai/api/v1`   | `openai/gpt-4o-mini`      |
| Ollama     | `http://localhost:11434/v1`      | `llama3.2`                |

Defaults can be baked into `.env` (`AI_BASE_URL`, `AI_KEY`, `AI_MODEL`); per-user Settings override
them. The key is stored encrypted and only ever sent to the base URL you configured. Failures are
non-fatal: the inbox still renders raw, and each message gets a **Re-organize** button.

## Voices

| Engine      | Download | Runs where      | Notes                               |
| ----------- | -------- | --------------- | ----------------------------------- |
| `kitten`    | ~57MB    | in your browser | default, Apache-2.0, 8 voices       |
| `kokoro`    | ~90MB    | in your browser | hi-fi option, WebGPU when available |
| `webspeech` | 0MB      | OS voices       | instant fallback                    |
| `google`    | 0MB      | Google servers  | opt-in, needs `GOOGLE_TTS_KEY`      |
| `minimax`   | 0MB      | MiniMax servers | opt-in, needs `MINIMAX_*`           |

The local engines are lazy-loaded from `PUBLIC_TTS_CDN` (default
`https://cdn.jsdelivr.net/npm`, addressed as `<base>/<pkg>/+esm`) the first time you press Play, with
an explicit _"downloads ~57MB once"_ notice — the ONNX runtimes are **not** bundled as npm
dependencies (that would be ~450MB on disk). The base must be jsDelivr-style: esm.sh injects a Node
`process` shim, which makes the loaders take their Node path and fail with
`[unenv] fs.mkdirSync is not implemented yet!`. Point `PUBLIC_TTS_CDN` at your own mirror to run
fully offline. Text for local engines never leaves the device.

## Paste & read

`/read` is a standalone reader: paste an article, a chapter or a PDF page and press play. It
runs entirely in the browser — **nothing is uploaded, no sign-in required** (sign in and it
picks up your saved engine, voice and speed).

| Control   | Values                                                     |
| --------- | ---------------------------------------------------------- |
| Speed     | 0.75× · 1× · 1.25× · 1.5× · 1.75× · 2× · 2.5× · 3×         |
| Auto ramp | +0.1× every 2 minutes of playback, up to your chosen speed |

## Self-host with Docker

```sh
cp .env.example .env       # set BETTER_AUTH_SECRET, AUTH_TOKEN_SECRET, Google + AI values
docker compose up --build  # app on :3000, Postgres on :5432
docker compose exec app bun run db:push
```

The `app` image is built from the repo `Dockerfile` (bun build → adapter-node). Put Caddy/nginx with
TLS in front of it in production, and set `ORIGIN` to the public URL.

## Environment variables

| Variable                               | Required        | Purpose                                                                |
| -------------------------------------- | --------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                         | yes             | Postgres connection string                                             |
| `BETTER_AUTH_SECRET`                   | yes             | session signing (`openssl rand -base64 32`)                            |
| `AUTH_TOKEN_SECRET`                    | yes             | encrypts OAuth tokens + the AI key at rest                             |
| `ORIGIN`                               | yes             | public origin; Better Auth builds the Google callback from it          |
| `GOOGLE_CLIENT_ID`                     | for mail        | your OAuth client                                                      |
| `GOOGLE_CLIENT_SECRET`                 | for mail        | your OAuth client                                                      |
| `AI_BASE_URL` / `AI_KEY` / `AI_MODEL`  | no              | defaults for the Settings form                                         |
| `TTS_ENGINE`                           | no              | `kitten` (default) \| `kokoro` \| `webspeech` \| `google` \| `minimax` |
| `GOOGLE_TTS_KEY`                       | for cloud voice | Google Cloud text-to-speech                                            |
| `MINIMAX_API_KEY` / `MINIMAX_GROUP_ID` | for cloud voice | MiniMax                                                                |
| `PUBLIC_TTS_CDN`                       | no              | npm CDN base (`<base>/<pkg>/+esm`) for the local engines               |

## Architecture

```
src/
  lib/
    types/mail.ts            Valibot schemas shared by client + server (DTOs, filters, settings)
    server/
      auth.ts                Better Auth (Google-only sign-in, Drizzle adapter)
      db/                    Drizzle schema: auth tables, mail_account, message, settings
      gmail.ts               Gmail REST client (list → get → parse to plain text)
      ai.ts                  OpenAI-compatible client, strict JSON, one retry on parse failure
      organize.ts            batch-classify pending messages
      settings.ts            per-user settings, env fallbacks, encrypted key
      tokens.ts              AES-256-GCM at rest
    remote/                  SvelteKit remote functions (query / command / form)
    tts/                     engine registry, lazy CDN loaders, playback
    components/              ui/ (shadcn-svelte) + inbox, player, app shell
  routes/
    +page.svelte             landing
    login/                   sign in / sign up
    (app)/dashboard/         inbox: sync, filters, categories, message view
    (app)/digest/            listening order + play-all player
    (app)/settings/          AI endpoint, voice, sync window
```

- **Remote functions** (`kit.experimental.remoteFunctions` + `compilerOptions.experimental.async`):
  `getInbox`/`getMessage`/`getDigest`/`getAccountStatus` (queries), `syncMail`/`organizeMail`/
  `regenerateSummary`/`connectGmail`/`synthesize` (commands), `saveSettings` (form).
- **Validation**: every remote argument and the AI's JSON response go through Valibot.
- **Stack**: SvelteKit 2 + Svelte 5 runes, Tailwind CSS v4, shadcn-svelte, Drizzle ORM + Postgres,
  Better Auth, Bun.

## Security & privacy

- The only Gmail scope requested is `gmail.readonly`; there is no code path that sends, modifies or
  deletes mail, and no Gmail label is ever written back.
- OAuth tokens and the AI key are encrypted at rest (`AUTH_TOKEN_SECRET`); secrets never reach the
  client. Message **text only** goes to your AI endpoint — with a local model, nothing leaves.
- No telemetry in v1.

## Roadmap

- [ ] Public launch → Google verification + CASA assessment
- [ ] Draft replies, IMAP/Outlook, digest → MP3 export, non-English voices
- [ ] Screenshots in this README once the OAuth walkthrough is exercised end-to-end
