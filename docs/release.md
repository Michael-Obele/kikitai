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
- Cut the release: push tag `android-v<versionName>`
  (e.g. `git tag android-v0.4.2 && git push origin android-v0.4.2`).
  `.github/workflows/android-release.yml` assembles the **debug APK** and
  attaches it as `kikitai-read-android-v<version>-debug.apk` on a GitHub
  release of the same name — this is what shows up in the Release tab.
  The workflow fails fast if the tag doesn't match `versionName`.
- Debug APKs are SDK-signed and installable as-is — no secrets needed.
  A Play-signed `release` APK needs `ANDROID_KEYSTORE_*` secrets first
  (keystore upload + `signingConfigs`); deliberately not wired yet —
  talk about it when distribution starts.
- `KIKITAI_ORIGIN` / `GOOGLE_WEB_CLIENT_ID` for release builds come from
  GitHub Actions variables/secrets (see `android.yml`), never from source.

## First release

Done — `contracts/web/mobile/desktop-v0.1.0` tags exist. `release.yml` stays
green on every push and opens a PR whenever a releasable commit lands.
