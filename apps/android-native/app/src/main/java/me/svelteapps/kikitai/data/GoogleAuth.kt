package me.svelteapps.kikitai.data

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Native Google sign-in → web backend session.
 *
 * The device only ever holds an identity `idToken` for the seconds it takes
 * to exchange it. Gmail OAuth (restricted `gmail.readonly` scope + refresh
 * tokens) stays server-side in `apps/web`; [signIn] returns the Better Auth
 * Bearer token the app then stores in [SessionStore].
 */
class GoogleAuth(
    private val webOrigin: String,
    private val serverClientId: String
) {
    private val http = OkHttpClient()

    /** Returns the `set-auth-token` Bearer value. Throws with a user-facing message on failure. */
    suspend fun signIn(activity: Activity): String {
        if (serverClientId.isEmpty()) {
            throw IllegalStateException("Missing Google web client ID (GOOGLE_WEB_CLIENT_ID)")
        }
        val manager = CredentialManager.create(activity)
        val googleIdOption = GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(serverClientId)
            .setAutoSelectEnabled(false)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
        val result = try {
            manager.getCredential(activity, request)
        } catch (e: GetCredentialException) {
            throw IllegalStateException("Google sign-in failed: ${e.message}")
        }
        val credential = result.credential
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw IllegalStateException("Unexpected credential type ${credential.type}")
        }
        return exchange(GoogleIdTokenCredential.createFrom(credential.data).idToken)
    }

    private suspend fun exchange(idToken: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject()
            .put("provider", "google")
            .put("idToken", JSONObject().put("token", idToken))
            .toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("$webOrigin/api/auth/sign-in/social")
            .post(body)
            .build()
        http.newCall(req).execute().use { res ->
            val token = res.header("set-auth-token").orEmpty()
            if (!res.isSuccessful || token.isEmpty()) {
                throw IllegalStateException("Backend sign-in failed (${res.code})")
            }
            token
        }
    }
}
