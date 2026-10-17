---
name: kotlin-m3-expressive
description: Native Android (Kotlin + Compose M3 Expressive) thin-client for Kikitai. Use when editing apps/android-native, theming, or wiring Credential Manager + Bearer to the web backend.
---

# Kotlin + Compose Material 3 Expressive (`apps/android-native`)

## 1. Stack & `MaterialExpressiveTheme` (`material3:1.4.0`)
- **Versions**: Kotlin `2.4.10` (`org.jetbrains.kotlin.plugin.compose`), Compose BOM `2026.09.00`, `androidx.compose.material3:material3:1.4.0` (+ `material3-window-size-class`, `material3-adaptive-navigation-suite`).
- **Expressive Theme & Physics Motion**: Compose M3 `1.4.0` introduces `MaterialExpressiveTheme` and spring-based `MotionScheme.expressive()` (natural bounce/overshoot physics inherited by all M3 components, replacing static duration/easing curves):
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
- **Obtain Google ID Token**: Use `androidx.credentials.CredentialManager` + `GetGoogleIdOption.Builder().setServerClientId(WEB_GOOGLE_CLIENT_ID).build()` → `GoogleIdTokenCredential.createFrom(credential.data).idToken`.
- **Exchange with Better Auth**:
  - `POST ${WEB_ORIGIN}/api/auth/sign-in/social` with body `{ "provider": "google", "idToken": { "token": idToken } }`.
  - Extract response header `set-auth-token`, persist in encrypted Jetpack `DataStore`, and attach `Authorization: Bearer <token>` on all `/api/app/v1/*` requests via Ktor/OkHttp interceptor.
  - On HTTP `401` from `requireAppSession`, clear the stored token and surface sign-in. Never store or use Gmail tokens on-device.

## 3. v1 Scope: Flagship `/read` Screen & Hybrid TTS
- **UI recreated in Compose** (no WebView reuse); `kotlinx.serialization` DTOs mirror `@kikitai/contracts`.
- **`/read` features**: Paste box + live word count, URL import (`POST /api/app/v1/import-url`) with Undo, M3 Expressive `ModalBottomSheet` for voice/speed (0.75–3×)/auto-ramp (+0.1×/2min)/sleep timer, typography prefs persisted in `DataStore` mirroring `kikitai.reader.prefs`, `LoadingIndicator` / `SplitButton` / `ToggleButton`, `autoSize` text, shared-element morph, and TalkBack semantics.
- **Hybrid TTS**: Android `android.speech.tts.TextToSpeech` + ONNX WASM/runtime via CDN + cloud opt-in (`/api/app/v1/tts/synthesize`).

Primary sources: `developer.android.com/develop/ui/compose/designsystems/material3`, `m3.material.io/develop/android/jetpack-compose`, `better-auth.com/docs/plugins/bearer`.
