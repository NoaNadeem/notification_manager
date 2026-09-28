package com.noanadeem.notificationmanager

import android.net.Uri
import java.net.HttpURLConnection
import java.net.URL
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

internal data class CalendarSearchResults(val events: List<CalendarEvent>, val hasMore: Boolean)

internal data class CalendarEvent(
    val calendarId: String,
    val id: String,
    val title: String,
    val start: Instant,
    val allDayDate: LocalDate?,
    val calendarZone: ZoneId,
    val htmlLink: String? = null
) {
    fun ageDescription(now: Instant = Instant.now()): String {
        val elapsedSeconds = Duration.between(start, now).seconds.coerceAtLeast(0)
        return if (elapsedSeconds < 86_400) {
            val hours = ((elapsedSeconds + 3_599) / 3_600).coerceAtLeast(1)
            "$hours ${if (hours == 1L) "hr" else "hrs"} ago"
        } else {
            val days = (elapsedSeconds + 86_399) / 86_400
            "$days ${if (days == 1L) "day" else "days"} ago"
        }
    }
}

internal sealed interface MoveTarget {
    data class After(val duration: Duration) : MoveTarget
    data class OnDate(val date: LocalDate) : MoveTarget
}

internal fun filterLoadedEvents(events: List<CalendarEvent>, query: String): List<CalendarEvent> {
    val term = query.trim()
    return if (term.isEmpty()) events else events.filter { it.title.contains(term, ignoreCase = true) }
}

internal suspend fun fetchRecentEvents(
    accessToken: String,
    primaryCalendarId: String,
    lookbackDays: Int,
    now: Instant = Instant.now()
): List<CalendarEvent> = withContext(Dispatchers.IO) {
    require(lookbackDays in 1..365)
    val earliest = now.minus(lookbackDays.toLong(), ChronoUnit.DAYS)
    val events = mutableListOf<CalendarEvent>()
    var eventPage: String? = null
    do {
        val url = Uri.parse("https://www.googleapis.com/calendar/v3/calendars")
            .buildUpon()
            .appendPath(primaryCalendarId)
            .appendPath("events")
            .appendQueryParameter("timeMin", earliest.toString())
            .appendQueryParameter("timeMax", now.plusSeconds(1).toString())
            .appendQueryParameter("singleEvents", "true")
            .appendQueryParameter("showDeleted", "false")
            .appendQueryParameter("maxResults", "2500")
            .apply { eventPage?.let { appendQueryParameter("pageToken", it) } }
            .build()
            .toString()
        val response = getCalendarJson(url, accessToken)
        // timeMin filters by end time, so check the start time ourselves.
        events += parseCalendarPage(response, primaryCalendarId)
            .filter { isInPastWindow(it.start, now, lookbackDays) }
        eventPage = response.optString("nextPageToken").takeIf { it.isNotBlank() }
    } while (eventPage != null)
    events.sortedByDescending { it.start }
}

internal suspend fun searchPrimaryCalendar(
    accessToken: String,
    primaryCalendarId: String,
    query: String
): CalendarSearchResults = withContext(Dispatchers.IO) {
    val term = query.trim()
    require(term.isNotEmpty()) { "Enter a search term." }
    val events = mutableListOf<CalendarEvent>()
    var pageToken: String? = null
    var pagesRead = 0
    var truncatedPage = false
    do {
        val url = Uri.parse("https://www.googleapis.com/calendar/v3/calendars")
            .buildUpon()
            .appendPath(primaryCalendarId)
            .appendPath("events")
            .appendQueryParameter("q", term)
            .appendQueryParameter("singleEvents", "true")
            .appendQueryParameter("showDeleted", "false")
            .appendQueryParameter("maxResults", "100")
            .apply { pageToken?.let { appendQueryParameter("pageToken", it) } }
            .build().toString()
        val response = getCalendarJson(url, accessToken)
        pagesRead += 1
        val pageEvents = parseCalendarPage(response, primaryCalendarId)
        truncatedPage = pageEvents.size > 100 - events.size
        events += pageEvents.take(100 - events.size)
        pageToken = response.optString("nextPageToken").takeIf { it.isNotBlank() }
    } while (pageToken != null && events.size < 100 && pagesRead < 10)
    CalendarSearchResults(events.sortedByDescending { it.start }, pageToken != null || truncatedPage)
}

private fun parseCalendarPage(response: JSONObject, calendarId: String): List<CalendarEvent> {
    val calendarZone = runCatching { ZoneId.of(response.optString("timeZone")) }
        .getOrDefault(ZoneId.systemDefault())
    val items = response.optJSONArray("items") ?: return emptyList()
    return buildList {
        for (index in 0 until items.length()) {
            val item = items.getJSONObject(index)
            if (item.optString("status") == "cancelled") continue
            val startObject = item.optJSONObject("start") ?: continue
            val dateTime = startObject.optString("dateTime")
            val allDayDate = if (dateTime.isBlank()) {
                startObject.optString("date").takeIf { it.isNotBlank() }?.let(LocalDate::parse)
                    ?: continue
            } else null
            val start = if (allDayDate != null) {
                allDayDate.atStartOfDay(calendarZone).toInstant()
            } else {
                runCatching { OffsetDateTime.parse(dateTime).toInstant() }
                    .getOrElse {
                        val zone = runCatching { ZoneId.of(startObject.optString("timeZone")) }
                            .getOrDefault(calendarZone)
                        LocalDateTime.parse(dateTime).atZone(zone).toInstant()
                    }
            }
            val id = item.optString("id")
            if (id.isBlank()) continue
            add(CalendarEvent(
                calendarId = calendarId,
                id = id,
                title = item.optString("summary").ifBlank { "(Untitled event)" },
                start = start,
                allDayDate = allDayDate,
                calendarZone = calendarZone,
                htmlLink = item.optString("htmlLink").takeIf { it.isNotBlank() }
            ))
        }
    }
}

internal suspend fun fetchEventWebLink(accessToken: String, event: CalendarEvent): String =
    withContext(Dispatchers.IO) {
        val url = Uri.parse("https://www.googleapis.com/calendar/v3/calendars")
            .buildUpon().appendPath(event.calendarId).appendPath("events").appendPath(event.id)
            .build().toString()
        getCalendarJson(url, accessToken).optString("htmlLink")
            .takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("Google Calendar did not provide a link for this event.")
    }

internal suspend fun moveCalendarEvent(
    accessToken: String,
    calendarEvent: CalendarEvent,
    target: MoveTarget,
    now: Instant = Instant.now()
): CalendarEvent = withContext(Dispatchers.IO) {
    val eventUrl = Uri.parse("https://www.googleapis.com/calendar/v3/calendars")
        .buildUpon()
        .appendPath(calendarEvent.calendarId)
        .appendPath("events")
        .appendPath(calendarEvent.id)
        .build()
        .toString()
    val event = getCalendarJson(eventUrl, accessToken)
    if (event.optString("status") == "cancelled") {
        throw IllegalStateException("This event was deleted in Google Calendar.")
    }
    val originalStart = event.getJSONObject("start")
    val originalEnd = event.getJSONObject("end")
    val movedEvent = if (originalStart.has("date")) {
        val startDate = LocalDate.parse(originalStart.getString("date"))
        val endDate = LocalDate.parse(originalEnd.getString("date"))
        val (nextStart, nextEnd) = shiftAllDayDates(
            startDate,
            endDate,
            now,
            ZoneId.systemDefault(),
            calendarEvent.calendarZone,
            target
        )
        event.put("start", JSONObject().put("date", nextStart.toString()))
        event.put("end", JSONObject().put("date", nextEnd.toString()))
        calendarEvent.copy(
            start = nextStart.atStartOfDay(calendarEvent.calendarZone).toInstant(),
            allDayDate = nextStart
        )
    } else {
        val originalStartInstant = parseEventInstant(originalStart)
        val originalEndInstant = parseEventInstant(originalEnd)
        val (nextStart, nextEnd) = shiftTimedTimes(
            originalStartInstant, originalEndInstant, now, ZoneId.systemDefault(), target
        )
        val zone = runCatching { ZoneId.of(originalStart.optString("timeZone")) }
            .getOrDefault(ZoneId.systemDefault())
        event.put("start", movedDateTime(nextStart, zone, originalStart))
        event.put("end", movedDateTime(nextEnd, zone, originalEnd))
        calendarEvent.copy(start = nextStart)
    }

    val updateUrlBuilder = Uri.parse(eventUrl).buildUpon()
        .appendQueryParameter("sendUpdates", "none")
        .appendQueryParameter("conferenceDataVersion", "1")
        .appendQueryParameter("supportsAttachments", "true")
    if (event.has("eventLabelId")) {
        updateUrlBuilder.appendQueryParameter("eventLabelVersion", "1")
    }
    val updateUrl = updateUrlBuilder.build().toString()
    val connection = URL(updateUrl).openConnection() as HttpURLConnection
    try {
        connection.requestMethod = "PUT"
        connection.doOutput = true
        connection.setRequestProperty("Authorization", "Bearer $accessToken")
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        event.optString("etag").takeIf { it.isNotBlank() }?.let {
            connection.setRequestProperty("If-Match", it)
        }
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        connection.outputStream.use { it.write(event.toString().toByteArray(Charsets.UTF_8)) }
        if (connection.responseCode !in 200..299) {
            throw calendarApiError(connection)
        }
        connection.inputStream.close()
    } finally {
        connection.disconnect()
    }
    movedEvent
}

internal fun shiftTimedTimes(
    start: Instant,
    end: Instant,
    now: Instant,
    phoneZone: ZoneId,
    target: MoveTarget
): Pair<Instant, Instant> {
    val duration = Duration.between(start, end)
    require(!duration.isNegative) { "This event has an invalid end time." }
    val movedStart = when (target) {
        is MoveTarget.After -> {
            require(target.duration > Duration.ZERO)
            now.plus(target.duration)
        }
        is MoveTarget.OnDate -> target.date.atTime(now.atZone(phoneZone).toLocalTime())
            .atZone(phoneZone).toInstant()
    }
    return movedStart to movedStart.plus(duration)
}

internal fun shiftAllDayDates(
    start: LocalDate,
    end: LocalDate,
    now: Instant,
    phoneZone: ZoneId,
    calendarZone: ZoneId,
    target: MoveTarget
): Pair<LocalDate, LocalDate> {
    val durationDays = ChronoUnit.DAYS.between(start, end)
    require(durationDays > 0) { "This all-day event has an invalid end date." }
    val movedStart = when (target) {
        is MoveTarget.OnDate -> target.date
        is MoveTarget.After -> {
            require(target.duration >= Duration.ofDays(1) &&
                target.duration.toHours() % 24L == 0L)
            var date = now.atZone(phoneZone).toLocalDate()
                .plusDays(target.duration.toDays())
            // A date in the calendar's zone can have already begun on the phone.
            if (date.atStartOfDay(calendarZone).toInstant() <= now) date = date.plusDays(1)
            date
        }
    }
    return movedStart to movedStart.plusDays(durationDays)
}

internal fun isInPastWindow(start: Instant, now: Instant, lookbackDays: Int): Boolean {
    require(lookbackDays in 1..365)
    return start >= now.minus(lookbackDays.toLong(), ChronoUnit.DAYS) && start <= now
}

private fun movedDateTime(instant: Instant, zone: ZoneId, original: JSONObject): JSONObject =
    JSONObject().put("dateTime", instant.atZone(zone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME))
        .also { result ->
            original.optString("timeZone").takeIf { it.isNotBlank() }?.let {
                result.put("timeZone", it)
            }
        }

private fun parseEventInstant(value: JSONObject): Instant {
    val dateTime = value.getString("dateTime")
    return runCatching { OffsetDateTime.parse(dateTime).toInstant() }
        .getOrElse {
            val zone = runCatching { ZoneId.of(value.optString("timeZone")) }
                .getOrDefault(ZoneId.systemDefault())
            LocalDateTime.parse(dateTime).atZone(zone).toInstant()
        }
}

private fun calendarApiError(connection: HttpURLConnection): IllegalStateException {
    val details = connection.errorStream?.bufferedReader()?.use { it.readText() }
    val message = runCatching {
        JSONObject(details ?: "").optJSONObject("error")?.optString("message")
    }.getOrNull().orEmpty()
    return IllegalStateException(
        if (message.isBlank()) "Calendar API returned HTTP ${connection.responseCode}."
        else "Calendar API: $message"
    )
}

private fun getCalendarJson(url: String, accessToken: String): JSONObject {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
        connection.requestMethod = "GET"
        connection.setRequestProperty("Authorization", "Bearer $accessToken")
        connection.connectTimeout = 15_000
        connection.readTimeout = 15_000
        if (connection.responseCode !in 200..299) throw calendarApiError(connection)
        return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
    } finally {
        connection.disconnect()
    }
}
