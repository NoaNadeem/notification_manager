package com.noanadeem.notificationmanager

import android.content.Context
import android.net.Uri
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val FILE_NAME = "notification-manager-dismissals-v1.json"
private const val MAX_LOOKBACK_DAYS = 365L

internal data class DismissalRecord(
    val eventId: String,
    val eventStartMillis: Long,
    val dismissedAtMillis: Long
) {
    val key: String get() = "$eventId/$eventStartMillis"
}

internal fun mergeDismissals(
    first: List<DismissalRecord>,
    second: List<DismissalRecord>,
    now: Instant
): List<DismissalRecord> {
    val cutoff = now.minus(MAX_LOOKBACK_DAYS, ChronoUnit.DAYS).toEpochMilli()
    return (first + second).asSequence()
        .filter { it.eventId.isNotBlank() && it.eventStartMillis >= cutoff && it.eventStartMillis <= now.toEpochMilli() }
        .groupBy { it.key }
        .values.map { records -> records.maxBy { it.dismissedAtMillis } }
        .sortedWith(compareBy(DismissalRecord::eventStartMillis, DismissalRecord::eventId))
}

internal fun List<CalendarEvent>.withoutDismissals(records: List<DismissalRecord>): List<CalendarEvent> {
    val keys = records.mapTo(HashSet()) { it.key }
    return filterNot { "${it.id}/${it.start.toEpochMilli()}" in keys }
}

internal class DismissalStore(private val context: Context) {
    private fun preferences(account: String) = context.getSharedPreferences(
        "dismissals_${account.lowercase().hashCode().toUInt().toString(16)}", Context.MODE_PRIVATE
    )

    fun read(account: String, now: Instant = Instant.now()): List<DismissalRecord> {
        val raw = preferences(account).getString("records", null) ?: return emptyList()
        val parsed = parseDismissals(raw)
        val current = mergeDismissals(parsed, emptyList(), now)
        if (current != parsed) write(account, current)
        return current
    }

    fun write(account: String, records: List<DismissalRecord>) {
        check(preferences(account).edit().putString("records", serializeDismissals(records)).commit()) {
            "Could not save dismissal on this phone."
        }
    }
}

internal suspend fun syncDismissals(
    token: String,
    store: DismissalStore,
    account: String,
    now: Instant = Instant.now()
): List<DismissalRecord> = withContext(Dispatchers.IO) {
    val local = store.read(account, now)
    val listUrl = Uri.parse("https://www.googleapis.com/drive/v3/files").buildUpon()
        .appendQueryParameter("spaces", "appDataFolder")
        .appendQueryParameter("q", "name = '$FILE_NAME' and trashed = false")
        .appendQueryParameter("fields", "nextPageToken,files(id,name)")
        .appendQueryParameter("pageSize", "100")
        .build().toString()
    val files = JSONObject(driveRequest(listUrl, token))
    val matches = files.optJSONArray("files") ?: JSONArray()
    if (files.optString("nextPageToken").isNotBlank()) {
        throw IllegalStateException("Drive has too many dismissal files to sync safely.")
    }
    val fileIds = (0 until matches.length()).map { matches.getJSONObject(it).getString("id") }
    val remote = fileIds.flatMap { id ->
        parseDismissals(driveRequest("https://www.googleapis.com/drive/v3/files/$id?alt=media", token))
    }
    val merged = mergeDismissals(local, remote, now)
    Log.i("NotificationManagerSync", "local=${local.size} drive=${remote.size} merged=${merged.size}")
    // Never replace the phone's copy until all remote records have been read successfully.
    store.write(account, merged)
    val encoded = serializeDismissals(merged)
    if (fileIds.isEmpty()) {
        if (merged.isNotEmpty()) createDriveFile(token, encoded)
    } else if (merged != remote) {
        updateDriveFile(token, fileIds.first(), encoded)
    }
    merged
}

private fun parseDismissals(raw: String): List<DismissalRecord> {
    val objectValue = JSONObject(raw)
    require(objectValue.getInt("version") == 1) { "Unsupported dismissal data version." }
    val rows = objectValue.getJSONArray("records")
    return (0 until rows.length()).map { index ->
        val row = rows.getJSONObject(index)
        DismissalRecord(row.getString("eventId"), row.getLong("start"), row.getLong("dismissed"))
    }
}

private fun serializeDismissals(records: List<DismissalRecord>): String {
    val rows = JSONArray()
    records.forEach { record ->
        rows.put(JSONObject().put("eventId", record.eventId)
            .put("start", record.eventStartMillis)
            .put("dismissed", record.dismissedAtMillis))
    }
    return JSONObject().put("version", 1).put("records", rows).toString()
}

internal fun estimateFullYearDismissalBytes(
    events: List<CalendarEvent>,
    now: Instant = Instant.now()
): Int = serializeDismissals(events.map { event ->
    DismissalRecord(event.id, event.start.toEpochMilli(), now.toEpochMilli())
}).toByteArray(Charsets.UTF_8).size

private fun createDriveFile(token: String, contents: String) {
    val boundary = "notification-manager-boundary"
    val metadata = JSONObject().put("name", FILE_NAME)
        .put("mimeType", "application/json")
        .put("parents", JSONArray().put("appDataFolder"))
    val body = buildString {
        append("--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n")
        append(metadata.toString())
        append("\r\n--$boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n")
        append(contents)
        append("\r\n--$boundary--\r\n")
    }
    driveRequest("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
        token, "POST", body, "multipart/related; boundary=$boundary")
}

private fun updateDriveFile(token: String, id: String, contents: String) {
    driveRequest("https://www.googleapis.com/upload/drive/v3/files/$id?uploadType=media&fields=id",
        token, "PATCH", contents, "application/json; charset=UTF-8")
}

private fun driveRequest(
    url: String,
    token: String,
    method: String = "GET",
    body: String? = null,
    contentType: String? = null
): String {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.requestMethod = if (method == "PATCH") "POST" else method
        if (method == "PATCH") connection.setRequestProperty("X-HTTP-Method-Override", "PATCH")
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", contentType)
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val response = connection.responseCode
        if (response !in 200..299) {
            val detail = connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
            val message = runCatching {
                JSONObject(detail).optJSONObject("error")?.optString("message")
            }.getOrNull().orEmpty()
            throw IllegalStateException("Drive sync failed (HTTP $response)${if (message.isBlank()) "" else ": $message"}")
        }
        return connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
        connection.disconnect()
    }
}
