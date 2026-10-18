# android-native

Kikitai as a thin native Android app: Kotlin + Compose M3 Expressive. It holds no mail
logic; it talks to the `apps/web` REST API (`/api/app/v1/*`) with a Bearer token from
Credential Manager sign-in.

## Run it

Open `apps/android-native` in Android Studio (pinned: Gradle wrapper, JDK 24) or build
from the command line; CI builds a signed APK on release tags only. Details live in
`../../.agents/skills/kotlin-m3-expressive/SKILL.md` and
`../../.github/workflows/android-release.yml`.
