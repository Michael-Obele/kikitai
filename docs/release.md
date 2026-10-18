# Releases & Versioning

Releases are automated with **release-please** (`.github/workflows/release.yml`,
`.github/release-please-config.json`). It reads conventional commits on `main`
and opens one release PR per package; merging it tags and creates the GitHub
release. No manual version edits — never hand-bump `version` in a feature PR.

Release-please opens PRs with `GITHUB_TOKEN`, which needs the repo's
_Allow GitHub Actions to create and approve pull requests_ setting
(readback + enable via
`gh api repos/<owner>/<repo>/actions/permissions/workflow`).

## Commit message → version (also written in `release.yml`)

| Commit message                                 | `packages/contracts` / `apps/*` | Example                                |
| ---------------------------------------------- | ------------------------------- | -------------------------------------- |
| `fix(scope): …`                                | **patch** `0.0.1 → 0.0.2`       | `fix(mobile): retry import on timeout` |
| `feat(scope): …`                               | **minor** `0.0.1 → 0.1.0`       | `feat(desktop): file-open for .txt`    |
| `feat(scope)!: …` or `BREAKING CHANGE:` footer | **major** `0.0.1 → 1.0.0`       | `feat(contracts)!: rename spokenText`  |
| `chore                                         | docs                            | ci                                     | test | refactor | style(scope): …` | **no release** | `docs: webgpu matrix` |

The **scope** selects the package: `contracts`, `web`, `mobile`, `desktop`
(e.g. `feat(mobile): …` releases only `@kikitai/mobile`). Unscoped `feat:` /
`fix:` apply to every configured package — avoid unless the change truly spans
all shells. Scopes outside the four packages release nothing.

## Android (`apps/android-native`)

Gradle has no `package.json`, so release-please does not version it. Rule:

- `versionName` tracks the **web minor**: web `0.4.x` → android `0.4.N`
  (N = android patch, bumped by hand).
- Bump `versionCode` (+1) and `versionName` in `app/build.gradle.kts` in the
  same PR that ships user-facing android changes, with a
  `feat(android): …` message for the changelog record.
- `KIKITAI_ORIGIN` / `GOOGLE_WEB_CLIENT_ID` for release builds come from
  GitHub Actions variables/secrets (see `android.yml`), never from source.

## First release

Manifest versions all read `0.0.1`. The first `feat:`/`fix:` merged to `main`
opens the inaugural release PRs; until then `release.yml` is a no-op that
still validates on every push.
