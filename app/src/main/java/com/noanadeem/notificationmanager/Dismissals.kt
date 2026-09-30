package com.noanadeem.notificationmanager

import android.content.Context
import android.net.Uri
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import org.json.JSONArray
import org.json.JSONObject

private const val FILE_NAME = "notification-manager-dismissals-v1.json"
private const val MARKER_PREFIX = "notification-manager-dismissal-v2-"
private const val MAX_LOOKBACK_DAYS = 365L
internal val dismissalSyncMutex = Mutex()

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
        .filter { it.eventId.isNotBlank() && it.eventStartMillis >= cutoff }
        .groupBy { it.key }
        .values.map { records -> records.maxBy { it.dismissedAtMillis } }
        .sortedWith(compareBy(DismissalRecord::eventStartMillis, DismissalRecord::eventId))
}

internal fun List<CalendarEvent>.withoutDismissals(records: List<DismissalRecord>): List<CalendarEvent> {
    val keys = records.mapTo(HashSet()) { it.key }
    return filterNot { "${it.id}/${it.start.toEpochMilli()}" in keys }
}

internal suspend fun publishMissingDismissals(
    local: List<DismissalRecord>,
    remote: List<DismissalRecord>,
    now: Instant,
    createMarker: suspend (DismissalRecord) -> Unit
): List<DismissalRecord> {
    val merged = mergeDismissals(local, remote, now)
    val remoteKeys = remote.mapTo(HashSet()) { it.key }
    for (record in merged) if (record.key !in remoteKeys) createMarker(record)
    return merged
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
        NotificationWidget.updateAll(context)
    }
}

internal suspend fun syncDismissals(
    token: String,
    store: DismissalStore,
    account: String,
    now: Instant = Instant.now()
): List<DismissalRecord> = withContext(Dispatchers.IO) {
    val local = store.read(account, now)
    val files = mutableListOf<JSONObject>()
    var pageToken: String? = null
    do {
        val listUrl = Uri.parse("https://www.googleapis.com/drive/v3/files").buildUpon()
            .appendQueryParameter("spaces", "appDataFolder")
            .appendQueryParameter("q", "trashed = false")
            .appendQueryParameter("fields", "nextPageToken,files(id,name,description)")
            .appendQueryParameter("pageSize", "1000")
            .apply { pageToken?.let { appendQueryParameter("pageToken", it) } }
            .build().toString()
        val page = JSONObject(driveRequest(listUrl, token))
        val matches = page.optJSONArray("files") ?: JSONArray()
        for (index in 0 until matches.length()) files.add(matches.getJSONObject(index))
        pageToken = page.optString("nextPageToken").takeIf { it.isNotBlank() }
    } while (pageToken != null)
    val legacyIds = files.filter { it.optString("name") == FILE_NAME }.map { it.getString("id") }
    val markerFiles = files.filter { it.optString("name").startsWith(MARKER_PREFIX) }
    val legacy = legacyIds.flatMap { id ->
        parseDismissals(driveRequest("https://www.googleapis.com/drive/v3/files/$id?alt=media", token))
    }
    val markerRecords = markerFiles.map(::parseDismissalMarker)
    val remote = legacy + markerRecords
    val merged = mergeDismissals(local, remote, now)
    Log.i("NotificationManagerSync", "local=${local.size} drive=${remote.size} merged=${merged.size}")
    // Never replace the phone's copy until all remote records have been read successfully.
    store.write(account, merged)
    publishMissingDismissals(local, remote, now) { record -> createDismissalMarker(token, record) }
    val cutoff = now.minus(MAX_LOOKBACK_DAYS, ChronoUnit.DAYS).toEpochMilli()
    for ((index, file) in markerFiles.withIndex()) {
        if (markerRecords[index].eventStartMillis < cutoff) {
            runCatching {
                driveRequest("https://www.googleapis.com/drive/v3/files/${file.getString("id")}", token, "DELETE")
            }.onFailure { Log.w("NotificationManagerSync", "Could not prune old dismissal marker", it) }
        }
    }
    merged
}

private fun parseDismissalMarker(file: JSONObject): DismissalRecord {
    val data = JSONObject(file.optString("description"))
    require(data.getInt("version") == 2) { "Unsupported dismissal marker version." }
    val eventId = data.getString("eventId")
    require(eventId.isNotBlank()) { "Dismissal marker is missing an event ID." }
    return DismissalRecord(eventId, data.getLong("start"), data.getLong("dismissed"))
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

internal fun estimateFullYearMarkerPayloadBytes(
    events: List<CalendarEvent>,
    now: Instant = Instant.now()
): Int = events.sumOf { event ->
    JSONObject().put("version", 2).put("eventId", event.id)
        .put("start", event.start.toEpochMilli()).put("dismissed", now.toEpochMilli())
        .toString().toByteArray(Charsets.UTF_8).size
}

private fun createDismissalMarker(token: String, record: DismissalRecord) {
    val metadata = JSONObject()
        .put("name", "$MARKER_PREFIX${UUID.randomUUID()}.json")
        .put("mimeType", "application/json")
        .put("parents", JSONArray().put("appDataFolder"))
        .put("description", JSONObject().put("version", 2).put("eventId", record.eventId)
            .put("start", record.eventStartMillis).put("dismissed", record.dismissedAtMillis).toString())
    driveRequest("https://www.googleapis.com/drive/v3/files?fields=id", token, "POST",
        metadata.toString(), "application/json; charset=UTF-8")
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
        if (response == 204) return ""
        return connection.inputStream.bufferedReader().use { it.readText() }
    } finally {
        connection.disconnect()
    }
}
