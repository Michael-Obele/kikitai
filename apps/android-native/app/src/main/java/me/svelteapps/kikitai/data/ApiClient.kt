package me.svelteapps.kikitai.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

@Serializable
data class ImportedPage(val title: String, val text: String, val url: String)

sealed interface ImportResult {
    data class Ok(val page: ImportedPage) : ImportResult
    data object Unauthorized : ImportResult
    data class Failed(val message: String) : ImportResult
}

class ApiClient(
    private val webOrigin: String,
    private val bearer: () -> String,
    private val onUnauthorized: () -> Unit
) {
    private val http = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun importUrl(url: String): ImportResult = withContext(Dispatchers.IO) {
        val token = bearer()
        val payload = JSONObject().put("url", url).toString()
        val req = Request.Builder()
            .url("$webOrigin/api/app/v1/import-url")
            .post(payload.toRequestBody("application/json".toMediaType()))
            .apply { if (token.isNotEmpty()) header("Authorization", "Bearer $token") }
            .build()
        http.newCall(req).execute().use { res ->
            if (res.code == 401) {
                onUnauthorized()
                return@withContext ImportResult.Unauthorized
            }
            val body = res.body?.string().orEmpty()
            if (!res.isSuccessful) return@withContext ImportResult.Failed("Import failed (${res.code})")
            return@withContext ImportResult.Ok(json.decodeFromString(ImportedPage.serializer(), body))
        }
    }

    fun countWords(text: String): Int =
        text.trim().takeIf { it.isNotEmpty() }?.split(Regex("\\s+"))?.size ?: 0
}
