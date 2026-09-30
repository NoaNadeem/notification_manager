package com.noanadeem.notificationmanager

import android.content.Context
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject

internal const val HISTORY_MILLIS = 3L * 86_400_000L

internal data class ActionEntry(
    val action: String,
    val eventId: String,
    val start: Long,
    val at: Long,
    val status: String,
    val error: String? = null
)

internal data class LocalSyncState(
    val calendarAt: Long = 0,
    val dismissalAt: Long = 0,
    val pending: Set<String> = emptySet(),
    val error: String? = null,
    val remoteNewer: Boolean = false,
    val conflictResolved: Boolean = false,
    val history: List<ActionEntry> = emptyList()
) {
    fun headline(online: Boolean, now: Long = System.currentTimeMillis()): String = when {
        !online -> "Offline — changes saved on this device"
        error != null || calendarAt == 0L || dismissalAt == 0L ||
            now - calendarAt > 3_600_000 || now - dismissalAt > 3_600_000 -> "Sync needs attention"
        pending.isNotEmpty() -> "Local changes waiting to sync"
        else -> "Synced just now"
    }

    fun addHistory(entry: ActionEntry, now: Long = System.currentTimeMillis()): LocalSyncState =
        copy(history = (history + entry).filter { it.at >= now - HISTORY_MILLIS }.takeLast(500))
}

internal class LocalStateStore(context: Context) {
    private val preferences = context.getSharedPreferences("notification_manager_local_state", Context.MODE_PRIVATE)
    private fun key(account: String) = account.lowercase().hashCode().toUInt().toString(16)

    fun readSync(account: String): LocalSyncState {
        val raw = preferences.getString("sync_${key(account)}", null) ?: return LocalSyncState()
        return runCatching {
            val json = JSONObject(raw)
            val pending = json.optJSONArray("pending") ?: JSONArray()
            val rows = json.optJSONArray("history") ?: JSONArray()
            LocalSyncState(
                calendarAt = json.optLong("calendarAt"), dismissalAt = json.optLong("dismissalAt"),
                pending = (0 until pending.length()).map { pending.getString(it) }.toSet(),
                error = json.optString("error").takeIf { it.isNotBlank() },
                remoteNewer = json.optBoolean("remoteNewer"),
                conflictResolved = json.optBoolean("conflictResolved"),
                history = (0 until rows.length()).map { index ->
                    val row = rows.getJSONObject(index)
                    ActionEntry(row.getString("action"), row.getString("eventId"), row.getLong("start"),
                        row.getLong("at"), row.getString("status"), row.optString("error").takeIf { it.isNotBlank() })
                }.filter { it.at >= System.currentTimeMillis() - HISTORY_MILLIS }.takeLast(500)
            )
        }.getOrDefault(LocalSyncState())
    }

    fun writeSync(account: String, state: LocalSyncState) {
        val rows = JSONArray()
        state.history.filter { it.at >= System.currentTimeMillis() - HISTORY_MILLIS }.takeLast(500).forEach { entry ->
            rows.put(JSONObject().put("action", entry.action).put("eventId", entry.eventId)
                .put("start", entry.start).put("at", entry.at).put("status", entry.status)
                .put("error", entry.error ?: ""))
        }
        val json = JSONObject().put("calendarAt", state.calendarAt).put("dismissalAt", state.dismissalAt)
            .put("pending", JSONArray(state.pending.toList())).put("error", state.error ?: "")
            .put("remoteNewer", state.remoteNewer).put("conflictResolved", state.conflictResolved)
            .put("history", rows)
        check(preferences.edit().putString("sync_${key(account)}", json.toString()).commit()) {
            "Could not save local sync status."
        }
    }

    fun readEvents(account: String): List<CalendarEvent> {
        val raw = preferences.getString("events_${key(account)}", null) ?: return emptyList()
        return runCatching {
            val rows = JSONArray(raw)
            (0 until rows.length()).map { index ->
                val row = rows.getJSONObject(index)
                CalendarEvent(
                    calendarId = row.getString("calendarId"), id = row.getString("id"),
                    title = row.getString("title"), start = Instant.ofEpochMilli(row.getLong("start")),
                    allDayDate = row.optString("allDayDate").takeIf { it.isNotBlank() }?.let(LocalDate::parse),
                    calendarZone = ZoneId.of(row.getString("zone")),
                    htmlLink = row.optString("htmlLink").takeIf { it.isNotBlank() },
                    location = row.optString("location").takeIf { it.isNotBlank() },
                    end = row.optLong("end").takeIf { it != 0L }?.let(Instant::ofEpochMilli),
                    hasOtherAttendees = row.optBoolean("otherAttendees"),
                    isRecurring = row.optBoolean("recurring")
                )
            }
        }.getOrDefault(emptyList())
    }

    fun writeEvents(account: String, events: List<CalendarEvent>) {
        val rows = JSONArray()
        events.forEach { event ->
            rows.put(JSONObject().put("calendarId", event.calendarId).put("id", event.id)
                .put("title", event.title).put("start", event.start.toEpochMilli())
                .put("allDayDate", event.allDayDate?.toString() ?: "")
                .put("zone", event.calendarZone.id).put("htmlLink", event.htmlLink ?: "")
                .put("location", event.location ?: "").put("end", event.end?.toEpochMilli() ?: 0L)
                .put("otherAttendees", event.hasOtherAttendees).put("recurring", event.isRecurring))
        }
        check(preferences.edit().putString("events_${key(account)}", rows.toString()).commit()) {
            "Could not save offline Calendar cache."
        }
    }
}
