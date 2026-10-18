# Releases & Versioning — ONE release page for every native shell

One version (root `package.json`), one tag (`vX.Y.Z`), one GitHub release
carrying every native artifact. Web deploys via Netlify and is not part of
releases at all.

Release-please (`.github/workflows/release-please.yml`, single root package
in `release-please-config.json`) reads conventional commits on `main`, opens
ONE PR bumping the root version, and merging it cuts ONE tag. That tag
triggers `.github/workflows/release.yml`, which builds everything and
attaches it to that ONE release before publishing it (stays draft on red).

## Commit message → version

| Commit message                                 | Root `version` | Example                                |
| ---------------------------------------------- | -------------- | -------------------------------------- |
| `fix(scope): …`                                | **patch**      | `fix(mobile): retry import on timeout` |
| `feat(scope): …`                               | **minor**      | `feat(desktop): file-open for .txt`    |
| `feat(scope)!: …` or `BREAKING CHANGE:` footer | **major**      | `feat(contracts)!: rename spokenText`  |
| `chore                                         | docs           | ci                                     | test | refactor | style(scope): …` | **no release** | `docs: webgpu matrix` |

The **scope** is cosmetic (changelog grouping only). Every `feat:`/`fix:`
on `main` moves the single root version; the tag it cuts releases
everything below.

## Android (`apps/android-native`)

## What ships on one release (`vX.Y.Z` tag)

| File                                                      | Built by                                                                | Notes                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| `kikitai-read-android-native-v*-debug.apk`                | `apk-native` job                                                        | Kotlin app, SDK-signed, installable                        |
| `kikitai-read-mobile-v*-debug.apk`                        | `apk-capacitor` job (`cap add` + `cap sync` + wrapper build, all in CI) | Same read route, WebView shell                             |
| Tauri bundles (`.AppImage`, `.deb`, `.dmg`, `nsis`/`msi`) | `tauri` matrix (linux/windows/macOS)                                    | Unsigned — OS warnings apply until signing identities land |

## Android (`apps/android-native`)

Gradle has no `package.json`, so release-please does not version it. Rule:

- `versionName` tracks the **root version** by hand (`0.1.1` today); bump it
  (+1 `versionCode`) in the same PR that ships user-facing android changes.
- Same for `apps/desktop/src-tauri/tauri.conf.json` `version`.
- Debug APKs are SDK-signed and installable as-is — no secrets needed.
  A Play-signed `release` APK needs `ANDROID_KEYSTORE_*` secrets first
  (keystore upload + `signingConfigs`); deliberately not wired yet —
  talk about it when distribution starts.
- `KIKITAI_ORIGIN` / `GOOGLE_WEB_CLIENT_ID` for release builds come from
  GitHub Actions variables/secrets (see `android.yml`), never from source.

## Desktop (`apps/desktop`)

- `src-tauri/` is hand-scaffolded (Cargo workspace, default `main.rs`/`lib.rs`,
  least-privilege capabilities, icons generated via `tauri icon`). No Rust
  toolchain needed locally unless editing backend commands.
- Signing identities (Apple/Windows/Tauri updater keys) are all still
  TODO — bundles ship unsigned until then.

## First release

Done — per-package `*-v0.1.0`/`*-v0.1.1` tags exist (history). From here:
single root version, single `v*` tag, single page.
