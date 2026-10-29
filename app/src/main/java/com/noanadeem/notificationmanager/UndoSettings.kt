package com.noanadeem.notificationmanager

internal const val UNDO_SECONDS_KEY = "undo_seconds"
internal const val DEFAULT_UNDO_SECONDS = 5
internal const val MAX_UNDO_SECONDS = 30

internal fun validUndoSeconds(value: Int): Int =
    value.takeIf { it in 1..MAX_UNDO_SECONDS } ?: DEFAULT_UNDO_SECONDS

internal fun parseUndoSeconds(text: String): Int? = text.trim().takeIf {
    it.isNotEmpty() && it.all { char -> char in '0'..'9' }
}?.toIntOrNull()?.takeIf { it in 1..MAX_UNDO_SECONDS }

internal fun widgetCanUndo(actionId: String?, newestId: String?, stagedAt: Long, seconds: Int, now: Long): Boolean =
    actionId != null && actionId == newestId && now - stagedAt in 0 until validUndoSeconds(seconds) * 1_000L

// Keep the source list intact so Undo and failed saves restore the original row.
internal fun visibleActionEvents(events: List<CalendarEvent>, hiddenIds: Collection<String>): List<CalendarEvent> =
    events.filterNot { it.id in hiddenIds }
