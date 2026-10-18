package me.svelteapps.kikitai.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.sessionStore: DataStore<Preferences> by preferencesDataStore("kikitai_session")
private val BEARER_KEY = stringPreferencesKey("bearer_token")

/**
 * Encrypted-at-rest Bearer session for the web backend. The token is the
 * Better Auth `set-auth-token` value — a session handle, never a Gmail token.
 * `cached` lets [ApiClient]'s sync `bearer()` lambda read without blocking.
 */
class SessionStore(private val context: Context) {
    @Volatile
    var cached: String = ""
        private set

    suspend fun load(): String {
        val token = context.sessionStore.data.map { it[BEARER_KEY].orEmpty() }.first()
        cached = token
        return token
    }

    suspend fun save(token: String) {
        cached = token
        context.sessionStore.edit { it[BEARER_KEY] = token }
    }

    suspend fun clear() {
        cached = ""
        context.sessionStore.edit { it.remove(BEARER_KEY) }
    }
}
