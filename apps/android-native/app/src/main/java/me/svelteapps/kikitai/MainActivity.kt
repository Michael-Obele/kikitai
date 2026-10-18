package me.svelteapps.kikitai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
import me.svelteapps.kikitai.data.ApiClient
import me.svelteapps.kikitai.data.GoogleAuth
import me.svelteapps.kikitai.data.SessionStore
import me.svelteapps.kikitai.ui.read.ReadScreen
import me.svelteapps.kikitai.ui.theme.KikitaiTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SessionStore(applicationContext)
        val auth = GoogleAuth(BuildConfig.WEB_ORIGIN, BuildConfig.GOOGLE_WEB_CLIENT_ID)
        setContent {
            var bearer by remember { mutableStateOf("") }
            val scope = rememberCoroutineScope()
            LaunchedEffect(Unit) { bearer = store.load() }
            val api = remember(bearer) {
                ApiClient(
                    webOrigin = BuildConfig.WEB_ORIGIN,
                    bearer = { bearer },
                    onUnauthorized = {
                        scope.launch {
                            store.clear()
                            bearer = ""
                        }
                    }
                )
            }
            KikitaiTheme {
                ReadScreen(
                    api = api,
                    signedIn = bearer.isNotEmpty(),
                    onSignIn = { activity, done ->
                        scope.launch {
                            try {
                                val token = auth.signIn(activity)
                                store.save(token)
                                bearer = token
                                done("")
                            } catch (e: Exception) {
                                done(e.message ?: "Sign-in failed.")
                            }
                        }
                    },
                    onSignOut = {
                        scope.launch {
                            store.clear()
                            bearer = ""
                        }
                    }
                )
            }
        }
    }
}
