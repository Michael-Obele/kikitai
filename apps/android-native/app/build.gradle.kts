plugins {
	id("com.android.application")
	// AGP 9+ ships built-in Kotlin support: `org.jetbrains.kotlin.android` must
	// NOT be applied (see https://kotl.in/gradle/agp-built-in-kotlin). The Compose
	// compiler plugin below is still required.
	id("org.jetbrains.kotlin.plugin.compose")
}

android {
	namespace = "me.svelteapps.kikitai"
	// Latest public platform is android-36 (SDK 37 unreleased): every artifact
	// below targets ≤36. Do NOT re-add the Compose BOM until its artifacts stop
	// demanding SDK 37 (check aar-metadata.properties `minCompileSdk` first).
	compileSdk = 36
	defaultConfig {
		applicationId = "me.svelteapps.kikitai"
		minSdk = 26
		targetSdk = 36
		// Tracks the unified root version by hand (release-please only bumps
		// package.json files). Bump alongside every user-facing android change.
		versionCode = 2
		versionName = "0.1.1"
	}
	buildFeatures {
		compose = true
		buildConfig = true
	}
	// Origins + IDs are build-time constants so no secret ever sits in source.
	// CI/local builds pass KIKITAI_ORIGIN + GOOGLE_WEB_CLIENT_ID as env vars
	// (see docs/release.md); empty defaults compile, sign-in explains at runtime.
	val webOrigin: String = System.getenv("KIKITAI_ORIGIN") ?: "https://kikitai.example.com"
	val googleWebClientId: String = System.getenv("GOOGLE_WEB_CLIENT_ID") ?: ""
	defaultConfig {
		buildConfigField("String", "WEB_ORIGIN", "\"$webOrigin\"")
		buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
	}
}

dependencies {
	// No Compose BOM: 2026.09.00 resolves Compose 1.12.x (minCompileSdk 37,
	// unreleased). Versions below resolve per-artifact POMs at the M3 1.4.0 era.
	implementation("androidx.compose.material3:material3:1.4.0")
	implementation("androidx.compose.material3:material3-window-size-class:1.4.0")
	implementation("androidx.compose.material3:material3-adaptive-navigation-suite:1.4.0")
	implementation("androidx.core:core-ktx:1.17.0")
	implementation("androidx.activity:activity-compose:1.13.0")
	implementation("androidx.datastore:datastore-preferences:1.1.7")
	implementation("androidx.credentials:credentials:1.5.0")
	implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
	// Google ID option + ID-token credential types (NOT bundled in the
	// play-services-auth artifact, which only holds the provider bridge).
	implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
	implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
	implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
