plugins {
	id("com.android.application")
	// AGP 9+ ships built-in Kotlin support: `org.jetbrains.kotlin.android` must
	// NOT be applied (see https://kotl.in/gradle/agp-built-in-kotlin). The Compose
	// compiler plugin below is still required.
	id("org.jetbrains.kotlin.plugin.compose")
}

android {
	namespace = "me.svelteapps.kikitai"
	compileSdk = 36
	defaultConfig {
		applicationId = "me.svelteapps.kikitai"
		minSdk = 26
		targetSdk = 36
		versionCode = 1
		versionName = "0.0.1"
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
	implementation(platform("androidx.compose:compose-bom:2026.09.00"))
	implementation("androidx.compose.material3:material3:1.4.0")
	implementation("androidx.compose.material3:material3-window-size-class:1.4.0")
	implementation("androidx.compose.material3:material3-adaptive-navigation-suite:1.5.0-beta01")
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
