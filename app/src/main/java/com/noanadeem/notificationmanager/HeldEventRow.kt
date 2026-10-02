package com.noanadeem.notificationmanager

internal fun displayEventsWithHeldAction(
    events: List<CalendarEvent>, held: CalendarEvent?, index: Int
): List<CalendarEvent> {
    if (held == null) return events
    val current = events.filterNot { it.calendarId == held.calendarId && it.id == held.id }
    return current.toMutableList().apply { add(index.coerceIn(0, size), held) }
}
