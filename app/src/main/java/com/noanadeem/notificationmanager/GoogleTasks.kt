package com.noanadeem.notificationmanager

import android.net.Uri
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal const val TASKS_SCOPE = "https://www.googleapis.com/auth/tasks"
private const val TASKS_ROOT = "https://tasks.googleapis.com/tasks/v1"
internal fun taskNote(notes: String?): String? = notes?.lineSequence()?.map(String::trim)?.firstOrNull(String::isNotBlank)
internal fun taskNoteUrl(note: String?): String? {
    val raw = Regex("https?://[^\\s<>]+", RegexOption.IGNORE_CASE).find(note.orEmpty())?.value?.trimEnd('.', ',', ';', ')')
        ?: note?.takeIf { it.startsWith("www.", ignoreCase = true) }?.substringBefore(' ')?.let { "https://$it" }
        ?: return null
    val uri = runCatching { java.net.URI(raw) }.getOrNull() ?: return null
    return raw.takeIf { uri.scheme?.lowercase() in setOf("https", "http") && !uri.host.isNullOrBlank() }
}
internal fun taskMoveDate(target: MoveTarget, stagedAt: Instant, zone: ZoneId = ZoneId.systemDefault()): LocalDate = when (target) {
    is MoveTarget.OnDate -> target.date
    is MoveTarget.OnDateTime -> throw IllegalArgumentException("Google Tasks supports dates only, not times.")
    is MoveTarget.After -> {
        require(target.duration >= Duration.ZERO && target.duration == Duration.ofDays(target.duration.toDays())) {
            "Google Tasks supports dates only, not hour moves."
        }
        stagedAt.atZone(zone).toLocalDate().plusDays(target.duration.toDays())
    }
}
private fun parseTask(row: JSONObject, listId: String, account: String): CalendarEvent {
    val due = row.optString("due").takeIf { it.isNotBlank() }?.take(10)?.let(LocalDate::parse)
    val zone = ZoneId.systemDefault()
    return CalendarEvent(account, "task:${Uri.encode(listId)}:${Uri.encode(row.getString("id"))}",
        row.optString("title").ifBlank { "(Untitled task)" }, due?.atStartOfDay(zone)?.toInstant() ?: Instant.EPOCH,
        due, zone, htmlLink = row.optString("webViewLink").ifBlank { "https://tasks.google.com/tasks/" },
        location = taskNote(row.optString("notes")), end = due?.plusDays(1)?.atStartOfDay(zone)?.toInstant(),
        taskListId = listId, taskId = row.getString("id"))
}
internal suspend fun fetchTasks(token: String, account: String): List<CalendarEvent> = withContext(Dispatchers.IO) {
    val lists = mutableListOf<String>()
    var page: String? = null
    do {
        val url = Uri.parse("$TASKS_ROOT/users/@me/lists").buildUpon().appendQueryParameter("maxResults", "100")
            .apply { page?.let { appendQueryParameter("pageToken", it) } }.build().toString()
        val response = taskRequest(url, token)
        response.optJSONArray("items")?.let { rows -> for (i in 0 until rows.length()) lists += rows.getJSONObject(i).getString("id") }
        page = response.optString("nextPageToken").takeIf(String::isNotBlank)
    } while (page != null)
    val result = mutableListOf<CalendarEvent>()
    for (list in lists) {
        page = null
        do {
            val url = Uri.parse("$TASKS_ROOT/lists/${Uri.encode(list)}/tasks").buildUpon()
                .appendQueryParameter("maxResults", "100").appendQueryParameter("showCompleted", "false")
                .appendQueryParameter("showDeleted", "false").appendQueryParameter("showHidden", "false")
                .appendQueryParameter("showAssigned", "true")
                .apply { page?.let { appendQueryParameter("pageToken", it) } }.build().toString()
            val response = taskRequest(url, token)
            response.optJSONArray("items")?.let { rows ->
                for (i in 0 until rows.length()) {
                    val row = rows.getJSONObject(i)
                    if (!row.optBoolean("deleted") && !row.optBoolean("hidden") && row.optString("status") != "completed") result += parseTask(row, list, account)
                }
            }
            page = response.optString("nextPageToken").takeIf(String::isNotBlank)
        } while (page != null)
    }
    sortCalendarEvents(result)
}
internal suspend fun fetchReviewItems(token: String, account: String, back: Int, ahead: Int, preset: WindowPreset?, onTasksError: (String) -> Unit): List<CalendarEvent> {
    val calendar = fetchRecentEvents(token, account, back, ahead, preset = preset)
    val tasks = try { fetchTasks(token, account) } catch (error: Exception) {
        onTasksError("Events loaded, but Tasks could not load: ${error.message}. Enable Google Tasks API and reconnect to grant Tasks access.")
        emptyList()
    }
    return sortCalendarEvents(calendar + tasks.filter { it.isUndatedTask || isInDisplayWindow(it.start, Instant.now(), back, ahead, preset = preset) })
}
internal suspend fun moveTaskEvent(token: String, event: CalendarEvent, target: MoveTarget, stagedAt: Instant,
    restoreOriginal: CalendarEvent? = null, expectedMoved: CalendarEvent? = null): CalendarEvent = withContext(Dispatchers.IO) {
    val url = "$TASKS_ROOT/lists/${Uri.encode(requireNotNull(event.taskListId))}/tasks/${Uri.encode(requireNotNull(event.taskId))}"
    val current = taskRequest(url, token)
    require(!current.optBoolean("deleted") && current.optString("status") != "completed") { "This task was completed or deleted. Refresh before moving it." }
    val currentDue = current.optString("due").takeIf(String::isNotBlank)?.take(10)?.let(LocalDate::parse)
    val desired = if (restoreOriginal != null) restoreOriginal.allDayDate else taskMoveDate(target, stagedAt)
    if (currentDue == desired) return@withContext parseTask(current, event.taskListId, event.calendarId)
    val expected = if (restoreOriginal != null) expectedMoved?.allDayDate else event.allDayDate
    require((restoreOriginal == null || expectedMoved != null) && currentDue == expected) { "This task changed after your action. Refresh and review it before moving it." }
    val body = JSONObject().put("due", desired?.let { "${it}T00:00:00.000Z" } ?: JSONObject.NULL)
    val updated = taskRequest(url, token, body, current.optString("etag").takeIf(String::isNotBlank))
    parseTask(updated, event.taskListId, event.calendarId)
}
internal suspend fun completeTaskEvent(token: String, event: CalendarEvent, completed: Boolean): CalendarEvent = withContext(Dispatchers.IO) {
    val url = "$TASKS_ROOT/lists/${Uri.encode(requireNotNull(event.taskListId))}/tasks/${Uri.encode(requireNotNull(event.taskId))}"
    val current = taskRequest(url, token)
    require(!current.optBoolean("deleted")) { "This task was deleted. Refresh before changing it." }
    val status = if (completed) "completed" else "needsAction"
    if (current.optString("status") == status) return@withContext parseTask(current, event.taskListId, event.calendarId)
    val body = JSONObject().put("status", status)
    if (!completed) body.put("completed", JSONObject.NULL)
    parseTask(taskRequest(url, token, body, current.optString("etag").takeIf(String::isNotBlank)), event.taskListId, event.calendarId)
}

private fun taskRequest(url: String, token: String, body: JSONObject? = null, etag: String? = null): JSONObject {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.connectTimeout = 15_000; connection.readTimeout = 15_000
        if (body != null) {
            connection.requestMethod = "POST"
            connection.setRequestProperty("X-HTTP-Method-Override", "PATCH")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            etag?.let { connection.setRequestProperty("If-Match", it) }
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        if (connection.responseCode !in 200..299) {
            val detail = runCatching { JSONObject(connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty())
                .optJSONObject("error")?.optString("message") }.getOrNull()
            throw IllegalStateException("Google Tasks HTTP ${connection.responseCode}${detail?.let { ": $it" }.orEmpty()}")
        }
        return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
    } finally { connection.disconnect() }
}
