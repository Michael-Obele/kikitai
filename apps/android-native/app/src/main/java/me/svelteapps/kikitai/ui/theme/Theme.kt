package me.svelteapps.kikitai.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Classic M3 + dynamic color — NOT the Expressive theme.
 *
 * `MaterialExpressiveTheme`, `MotionScheme.expressive()` and friends are
 * `internal` in material3:1.4.0 (verified against the published sources jar)
 * and go public in 1.5.0, whose artifacts demand the unreleased SDK 37
 * (see docs/hybrid-tts-matrix.md + skill notes). When SDK 37 + M3 1.5.0
 * stable land, switch this body back to `MaterialExpressiveTheme`.
 */
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

        darkTheme -> darkColorScheme()
        else -> lightColorScheme()
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
