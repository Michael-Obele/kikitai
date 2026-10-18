---
name: kotlin-m3-expressive
description: Native Android (Kotlin + Compose M3 Expressive) thin-client for Kikitai. Use when editing apps/android-native, theming, or wiring Credential Manager + Bearer to the web backend.
---

# Kotlin + Compose Material 3 Expressive (`apps/android-native`)

## 1. Stack & Theming (`material3:1.4.0` — Expressive BLOCKED, see below)

- **Versions**: Kotlin `2.4.10` (`org.jetbrains.kotlin.plugin.compose`), AGP `9.1.0` + Gradle `9.3.1` + JDK 17 (AGP 9 ships built-in Kotlin — do NOT apply `org.jetbrains.kotlin.android`), `material3:1.4.0` + `material3-window-size-class:1.4.0` + `material3-adaptive-navigation-suite:1.4.0` (**no Compose BOM**: `2026.09.00` resolves Compose 1.12.x with `minCompileSdk 37`, unreleased — versions resolve per-artifact POMs at the M3 1.4.0 era instead), `compileSdk 36` (`targetSdk 36`, `minSdk 26`), `buildFeatures.compose=true` + `buildConfig=true`, `android.useAndroidX=true`.
- **Expressive is BLOCKED until SDK 37 + M3 1.5.0 stable**: `MaterialExpressiveTheme`, `MotionScheme.expressive()`, `expressiveLightColorScheme()` and the opt-in annotation are `internal` in 1.4.0 (verified against the published `-sources.jar`, Oct 2026) and go public in 1.5.0 — whose artifacts demand the unreleased SDK 37 (`minCompileSdk 37`, no `android-37` platform upstream). So `KikitaiTheme` is classic `MaterialTheme` + dynamic color for now; the expressive body is spelled out in a comment in `ui/theme/Theme.kt` for the switch-over. Do NOT re-add `ExperimentalMaterial3ExpressiveApi` usages or the Compose BOM until then.
  ```kotlin
  import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
  import androidx.compose.material3.MaterialExpressiveTheme
  import androidx.compose.material3.MotionScheme

  @OptIn(ExperimentalMaterial3ExpressiveApi::class)
  @Composable
  fun KikitaiTheme(
      darkTheme: Boolean = isSystemInDarkTheme(),
      dynamicColor: Boolean = true,
      content: @Composable () -> Unit
  ) {
      val context = LocalContext.current
      val colorScheme = when {
          dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
              if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
          darkTheme -> DarkColorScheme
          else -> LightColorScheme
      }
      MaterialExpressiveTheme(
          colorScheme = colorScheme,
          motionScheme = MotionScheme.expressive(),
          shapes = AppShapes,
          typography = AppTypography,
          content = content
      )
  }
  ```

## 2. Credential Manager → Better Auth `idToken` → Bearer

- **Obtain Google ID Token**: Use `androidx.credentials.CredentialManager` + `GetGoogleIdOption.Builder().setServerClientId(WEB_GOOGLE_CLIENT_ID).build()` → `GoogleIdTokenCredential.createFrom(credential.data).idToken`. Needs `androidx.credentials:credentials:1.5.0` + `credentials-play-services-auth:1.5.0` + `com.google.android.libraries.identity.googleid:googleid:1.2.1` — the googleid types are NOT in the play-services-auth artifact.
- **Exchange with Better Auth** (implemented: `data/GoogleAuth.kt` + `data/SessionStore.kt`, wired in `MainActivity`):
  - `POST ${WEB_ORIGIN}/api/auth/sign-in/social` with body `{ "provider": "google", "idToken": { "token": idToken } }`.
  - Extract response header `set-auth-token`, persist in Jetpack `DataStore` (`SessionStore.save`), and attach `Authorization: Bearer <token>` on all `/api/app/v1/*` requests via the `ApiClient` bearer lambda.
  - `WEB_ORIGIN` + `GOOGLE_WEB_CLIENT_ID` arrive as `BuildConfig` fields from `KIKITAI_ORIGIN` / `GOOGLE_WEB_CLIENT_ID` env (empty compiles, sign-in explains at runtime). On HTTP `401` from `requireAppSession`, clear the stored token and surface sign-in. Never store or use Gmail tokens on-device.
- **Dark mode**: free via `isSystemInDarkTheme()` + dynamic color in `KikitaiTheme` — no toggle needed (system setting is the idiom).

## 3. v1 Scope: Flagship `/read` Screen & Hybrid TTS

- **UI recreated in Compose** (no WebView reuse); OkHttp + `org.json` DTOs mirror `@kikitai/contracts` (no serialization plugin).
- **`/read` features**: Paste box + live word count, URL import (`POST /api/app/v1/import-url`) with Undo, M3 Expressive `ModalBottomSheet` for voice/speed (0.75–3×)/auto-ramp (+0.1×/2min)/sleep timer, typography prefs persisted in `DataStore` mirroring `kikitai.reader.prefs`, `LoadingIndicator` / `SplitButton` / `ToggleButton`, `autoSize` text, shared-element morph, and TalkBack semantics.
- **Hybrid TTS**: Android `android.speech.tts.TextToSpeech` + ONNX WASM/runtime via CDN + cloud opt-in (`/api/app/v1/tts/synthesize`).

Primary sources: `developer.android.com/develop/ui/compose/designsystems/material3`, `m3.material.io/develop/android/jetpack-compose`, `better-auth.com/docs/plugins/bearer`.
