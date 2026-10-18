package me.svelteapps.kikitai.ui.read

import android.app.Activity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import me.svelteapps.kikitai.data.ApiClient
import me.svelteapps.kikitai.data.ImportResult

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ReadScreen(
    api: ApiClient,
    signedIn: Boolean,
    onSignIn: (Activity, (String) -> Unit) -> Unit,
    onSignOut: () -> Unit
) {
    var text by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("") }
    var undoText by remember { mutableStateOf<String?>(null) }
    var importing by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val activity = LocalContext.current as Activity
    val words = remember(text) { api.countWords(text) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Paste & read") }) }
    ) { inner ->
        Column(
            modifier = Modifier.fillMaxSize().padding(inner).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it; undoText = null },
                label = { Text("Text") },
                placeholder = { Text("Paste an article…") },
                minLines = 8,
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Paste text" }
            )
            Text("$words words · nothing leaves the device until import/play")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (signedIn) {
                    Text("Signed in", modifier = Modifier.weight(1f))
                    TextButton(onClick = onSignOut) { Text("Sign out") }
                } else {
                    Button(
                        onClick = {
                            onSignIn(activity) { err ->
                                status = if (err.isEmpty()) "Signed in." else err
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) { Text("Sign in with Google") }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text("Import from URL") },
                    placeholder = { Text("https://example.com/article") },
                    modifier = Modifier.weight(1f)
                )
                Button(
                    onClick = {
                        scope.launch {
                            importing = true
                            try {
                                when (val r = api.importUrl(url)) {
                                    is ImportResult.Ok -> {
                                        undoText = text
                                        text = r.page.text
                                        status = "Imported ${r.page.title}."
                                    }

                                    ImportResult.Unauthorized -> status = "Session expired — sign in again."
                                    is ImportResult.Failed -> status = r.message
                                }
                            } finally {
                                importing = false
                            }
                        }
                    },
                    enabled = !importing
                ) { Text(if (importing) "Importing…" else "Import") }
            }
            if (status.isNotEmpty()) Text(status)
            if (undoText != null) {
                TextButton(onClick = {
                    text = undoText.orEmpty()
                    undoText = null
                }) { Text("Undo import") }
            }
            Text("Voice, speed 0.75–3×, ramp, sleep, typography: same ladder as web.")
        }
    }
}
