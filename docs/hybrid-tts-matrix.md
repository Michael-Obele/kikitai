# Hybrid TTS + WebGPU Capability Matrix

The TTS ladder is identical on every shell — only the top rung's availability
changes per OS. **Feature-detect at runtime, never UA-sniff.**

Ladder (first available wins):

1. **ONNX WASM, multi-threaded** — Kitten/Kokoro via jsDelivr CDN (`PUBLIC_TTS_CDN`).
   Needs `SharedArrayBuffer` → needs COOP/COEP (`same-origin`/`credentialless`).
   All three Svelte shells send these headers in dev; Tauri sets them in
   `tauri.conf.json → app.security.headers` for production.
2. **ONNX WASM, single-threaded** — same models, no isolation headers needed.
   Automatic fallback when `SharedArrayBuffer` is undefined.
3. **WebGPU execution provider** (`navigator.gpu`) — progressive enhancement
   where the WebView exposes it, chosen inside the engine loader, not by OS.
4. **Native speech fallback** — Android `TextToSpeech` / `AVSpeech` (iOS) /
   Web Speech in WebViews / OS speech on desktop.
5. **Cloud opt-in** — `POST /api/app/v1/tts/synthesize` (`google`/`minimax`).

## Per-OS reality (Oct 2026)

| Shell                      | Engine                             | WebGPU                                | WASM threads     | Notes                                                                                     |
| -------------------------- | ---------------------------------- | ------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| web (desktop Chrome/Edge)  | Chromium 113+                      | ✅                                    | ✅ (headers set) | Reference implementation.                                                                 |
| web (macOS Safari)         | Safari on Tahoe 26+                | ✅ (Tahoe 26+)                        | ✅               | Older macOS: WASM path.                                                                   |
| web (Firefox)              | FF 141+ Win / 145+ macOS-ARM       | ✅                                    | ✅               | Linux support still in progress.                                                          |
| mobile (Android WebView)   | Evergreen Chromium via Play Store  | ✅ on Android 12+ w/ Qualcomm/ARM GPU | ✅               | Check `navigator.gpu`; otherwise WASM → native `TextToSpeech`.                            |
| mobile (iOS WKWebView)     | Safari engine (iOS 26+ has WebGPU) | ⚠️ assume absent                      | ✅               | onnxruntime-web does not support iOS regardless of browser — expect WASM → native speech. |
| desktop (Windows WebView2) | Chromium Edge base                 | ✅ per Edge release                   | ✅               | WebGPU flag lives in non-stable WebView2 channels; don't depend on it.                    |
| desktop (macOS WKWebView)  | Safari engine                      | ✅ on Tahoe 26+                       | ✅               | Same as Safari row.                                                                       |
| desktop (Linux WebKitGTK)  | WebKitGTK                          | ❌                                    | ✅               | WASM threads work; no WebGPU.                                                             |
| android-native             | — (no WebView)                     | N/A                                   | N/A              | Native `TextToSpeech` first, ONNX mobile runtime via CDN second, cloud opt-in third.      |

## Rules for engine code

- Detect in this order: `typeof SharedArrayBuffer !== 'undefined'` →
  `await navigator.gpu?.requestAdapter()` (guard with try/catch, it can throw)
  → native → cloud. Cache the decision per session, re-check on engine switch.
- iOS (any browser, any WebView): skip the WebGPU probe, go straight to WASM.
- Never gate on OS version strings; gate on the APIs above.
- Telemetry (`telemetry-card.svelte` on web, equivalents elsewhere) must record
  which rung served the utterance — that's how we learn the real matrix.

Primary sources: `onnxruntime.ai/docs/tutorials/web/ep-webgpu`,
`web.dev/blog/webgpu-supported-major-browsers`,
`microsoft/onnxruntime#22776` (iOS), `tauri-apps/tauri#6381` (WebView2),
`v2.tauri.app/reference/webview-versions`.
