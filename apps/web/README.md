# @kikitai/web

The Kikitai app. SvelteKit 2 + Svelte 5, Postgres (Drizzle), Google-only sign-in
(Better Auth), Gmail sync over `gmail.readonly`, and browser-local text-to-speech.
Start at the [repo README](../../README.md); this file covers web-only commands.

## Run it

```sh
cp .env.example .env  # fill in DATABASE_URL, secrets, Google + AI values
bun run db:push       # create tables; db:start runs the Docker Postgres
bun run dev           # http://localhost:5173 (or `bun run dev` from the repo root)
```

`ORIGIN` must match the URL you open, or the Google callback fails.

## Commands

| Command                   | What it does                                                            |
| ------------------------- | ----------------------------------------------------------------------- |
| `bun run dev`             | dev server                                                              |
| `bun run check`           | `svelte-kit sync` + `svelte-check`                                      |
| `bun run db:push`         | push the Drizzle schema to `DATABASE_URL`                               |
| `bun run db:studio`       | browse tables                                                           |
| `bun run db:start`        | local Postgres (`compose.yaml`)                                         |
| `bun run build`           | production build (`adapter-node` locally, `adapter-netlify` on Netlify) |
| `bun run test:guardrails` | Playwright guardrails                                                   |
| `bun run test:lighthouse` | LHCI run with seed data                                                 |

## Deploy

`Dockerfile`, `compose.yaml`, and `netlify.toml` live here. From this directory:
`docker compose up --build`, then `docker compose exec app bun run db:push`.
On Netlify, set env vars before the first deploy; `PUBLIC_*` values bake in at build
time and functions time out after 10s on the free tier.
