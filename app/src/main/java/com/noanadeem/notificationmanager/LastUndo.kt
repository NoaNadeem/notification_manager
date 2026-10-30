package com.noanadeem.notificationmanager

import android.content.Context
import org.json.JSONObject

// This device's last action, independent of the inline Undo timer. No tokens are stored.
internal data class LastUndoRecord(val event: CalendarEvent, val move: Boolean, val moved: CalendarEvent? = null)

internal class LastUndoStore(context: Context) {
    private val preferences = context.getSharedPreferences("notification_manager_last_undo", Context.MODE_PRIVATE)
    fun read(account: String): LastUndoRecord? = runCatching {
        val raw = preferences.getString(account.lowercase(), null) ?: return null
        val json = JSONObject(raw)
        LastUndoRecord(calendarEventFromLocalJson(json.getJSONObject("event")), json.getBoolean("move"),
            json.optJSONObject("moved")?.let(::calendarEventFromLocalJson))
    }.getOrNull()
    fun write(account: String, record: LastUndoRecord?) {
        val editor = preferences.edit()
        if (record == null) editor.remove(account.lowercase()) else {
            val json = JSONObject().put("event", calendarEventToLocalJson(record.event)).put("move", record.move)
            record.moved?.let { json.put("moved", calendarEventToLocalJson(it)) }
            editor.putString(account.lowercase(), json.toString())
        }
        check(editor.commit()) { "Could not remember the last action for Undo." }
    }
}
