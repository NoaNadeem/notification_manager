package com.noanadeem.notificationmanager

import android.content.Context
import android.net.Uri
import android.util.Log
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

private const val MOVE_PREFIX = "notification-manager-move-v1-"
private const val MOVE_LIMIT = 10
private const val MOVE_RETENTION_DAYS = 30L
internal val moveHistoryMutex = Mutex()

internal data class MoveRecord(
    val id: String,
    val eventId: String,
    val title: String,
    val fromMillis: Long,
    val toMillis: Long,
    val movedAtMillis: Long
)

internal fun recentMoves(
    first: List<MoveRecord>, second: List<MoveRecord> = emptyList(), now: Instant = Instant.now()
): List<MoveRecord> {
    val cutoff = now.minus(MOVE_RETENTION_DAYS, ChronoUnit.DAYS).toEpochMilli()
    return (first + second).asSequence()
        .filter { it.id.isNotBlank() && it.eventId.isNotBlank() && it.movedAtMillis >= cutoff }
        .groupBy(MoveRecord::id).values.map { records -> records.maxBy(MoveRecord::movedAtMillis) }
        .sortedWith(compareByDescending(MoveRecord::movedAtMillis).thenBy(MoveRecord::id))
        .take(MOVE_LIMIT).toList()
}

internal class MoveHistoryStore(private val context: Context) {
    private fun preferences(account: String) = context.getSharedPreferences(
        "moves_${account.lowercase().hashCode().toUInt().toString(16)}", Context.MODE_PRIVATE
    )

    fun read(account: String, now: Instant = Instant.now()): List<MoveRecord> {
        val raw = preferences(account).getString("records", null) ?: return emptyList()
        val parsed = runCatching {
            val rows = JSONArray(raw)
            (0 until rows.length()).map { index -> parseMove(rows.getJSONObject(index)) }
        }.getOrDefault(emptyList())
        val current = recentMoves(parsed, now = now)
        if (current != parsed) write(account, current)
        return current
    }

    fun write(account: String, records: List<MoveRecord>) {
        val rows = JSONArray()
        records.forEach { rows.put(moveJson(it)) }
        check(preferences(account).edit().putString("records", rows.toString()).commit()) {
            "Could not save recent moves on this phone."
        }
    }
}

internal suspend fun syncMoveHistory(
    token: String, store: MoveHistoryStore, account: String, now: Instant = Instant.now()
): List<MoveRecord> = withContext(Dispatchers.IO) {
    val local = store.read(account, now)
    val files = mutableListOf<JSONObject>()
    var pageToken: String? = null
    do {
        val url = Uri.parse("https://www.googleapis.com/drive/v3/files").buildUpon()
            .appendQueryParameter("spaces", "appDataFolder")
            .appendQueryParameter("q", "name contains '$MOVE_PREFIX' and trashed = false")
            .appendQueryParameter("fields", "nextPageToken,files(id,name,description)")
            .appendQueryParameter("pageSize", "1000")
            .apply { pageToken?.let { appendQueryParameter("pageToken", it) } }
            .build().toString()
        val page = JSONObject(driveRequest(url, token))
        val listed = page.optJSONArray("files") ?: JSONArray()
        for (index in 0 until listed.length()) {
            val file = listed.getJSONObject(index)
            if (file.optString("name").startsWith(MOVE_PREFIX)) files.add(file)
        }
        pageToken = page.optString("nextPageToken").takeIf(String::isNotBlank)
    } while (pageToken != null)

    val remote = files.map { file -> parseMove(JSONObject(file.getString("description"))) }
    val merged = recentMoves(local, remote, now)
    val remoteIds = remote.mapTo(HashSet()) { it.id }
    for (record in merged) if (record.id !in remoteIds) createMoveMarker(token, record)
    store.write(account, merged)
    val retainedIds = merged.mapTo(HashSet()) { it.id }
    val seenIds = HashSet<String>()
    for ((index, file) in files.withIndex()) {
        val record = remote[index]
        if (record.id !in retainedIds || !seenIds.add(record.id)) {
            runCatching {
                driveRequest("https://www.googleapis.com/drive/v3/files/${file.getString("id")}", token, "DELETE")
            }.onFailure { Log.w("NotificationManagerMoves", "Could not prune move marker", it) }
        }
    }
    merged
}

private fun parseMove(data: JSONObject): MoveRecord {
    if (data.getInt("version") != 1) throw IllegalArgumentException("Unsupported move record version.")
    return MoveRecord(data.getString("id"), data.getString("eventId"), data.getString("title"),
        data.getLong("from"), data.getLong("to"), data.getLong("moved"))
}

private fun moveJson(record: MoveRecord): JSONObject = JSONObject()
    .put("version", 1).put("id", record.id).put("eventId", record.eventId)
    .put("title", record.title).put("from", record.fromMillis)
    .put("to", record.toMillis).put("moved", record.movedAtMillis)

private fun createMoveMarker(token: String, record: MoveRecord) {
    val metadata = JSONObject().put("name", "$MOVE_PREFIX${record.id}.json")
        .put("mimeType", "application/json")
        .put("parents", JSONArray().put("appDataFolder"))
        .put("description", moveJson(record).toString())
    driveRequest("https://www.googleapis.com/drive/v3/files?fields=id", token, "POST",
        metadata.toString(), "application/json; charset=UTF-8")
}

internal fun newMoveRecord(before: CalendarEvent, after: CalendarEvent, now: Instant = Instant.now()): MoveRecord =
    MoveRecord(UUID.randomUUID().toString(), before.id, before.title,
        before.start.toEpochMilli(), after.start.toEpochMilli(), now.toEpochMilli())
