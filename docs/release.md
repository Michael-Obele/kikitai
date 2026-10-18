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

The **scope** is cosmetic (changelog grouping only). What decides _which_
packages release is **which package paths the commits touched**
(`packages/contracts/**`, `apps/web/**`, …) — e.g. a workflow fix that also
reformats every `CHANGELOG.md` releases everything, as happened with 0.1.1.
Keep commits path-disciplined if you want a single-package release.

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

Done — `contracts/web/mobile/desktop-v0.1.0` tags exist. `release.yml` stays
green on every push and opens a PR whenever a releasable commit lands.
