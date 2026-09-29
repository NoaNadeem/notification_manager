package com.noanadeem.notificationmanager

import android.content.SharedPreferences
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

internal val skinNames = listOf("Green", "Blue", "Purple", "Rose")
internal val skinFields = linkedMapOf(
    "dot" to "Old-event dot",
    "emphasized" to "Long/shared event",
    "event" to "Base event",
    "panel" to "Header and footer",
    "title" to "Title",
    "tile" to "Action tiles"
)

internal data class Skin(val name: String = "Green", val overrides: Map<String, String> = emptyMap()) {
    fun color(field: String, dark: Boolean, fallback: Color): Color {
        val override = overrides[field]
        if (override != null) return Color(android.graphics.Color.parseColor(override))
        val pair = when (name) {
            "Blue" -> "#64C9FF" to (if (dark) "#19394D" else "#D6F0FF")
            "Purple" -> "#C29BFF" to (if (dark) "#35264A" else "#ECDEFF")
            "Rose" -> "#FF8DC5" to (if (dark) "#4A2639" else "#FFE0EE")
            else -> "#A7FF57" to (if (dark) "#1D422E" else "#DDF5E4")
        }
        return when (field) {
            "dot" -> Color(android.graphics.Color.parseColor(pair.first))
            "emphasized" -> Color(android.graphics.Color.parseColor(pair.second))
            else -> fallback
        }
    }
}

internal val LocalSkin = compositionLocalOf { Skin() }
internal val LocalSkinDark = compositionLocalOf { true }

internal fun validSkinHex(value: String): Boolean = value.isBlank() || Regex("#[0-9a-fA-F]{6}").matches(value.trim())

internal fun readSkin(prefs: SharedPreferences): Skin = Skin(
    name = prefs.getString("skin_name", "Green")?.takeIf { it in skinNames } ?: "Green",
    overrides = skinFields.keys.mapNotNull { field ->
        prefs.getString("skin_$field", null)?.takeIf(::validSkinHex)?.takeIf { it.isNotBlank() }?.let { field to it }
    }.toMap()
)

internal fun saveSkin(prefs: SharedPreferences, skin: Skin) {
    prefs.edit().putString("skin_name", skin.name).apply {
        for (field in skinFields.keys) {
            val value = skin.overrides[field]
            if (value == null) remove("skin_$field") else putString("skin_$field", value)
        }
    }.apply()
}
