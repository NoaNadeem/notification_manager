package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

internal fun headerClockLabel(now: Instant, zone: ZoneId): String {
    val local = now.atZone(zone)
    val day = local.dayOfMonth
    val suffix = if (day % 100 in 11..13) "th" else when (day % 10) {
        1 -> "st"
        2 -> "nd"
        3 -> "rd"
        else -> "th"
    }
    val weekday = local.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.US)
    val month = local.month.getDisplayName(TextStyle.SHORT, Locale.US)
        .let { if (it == "Sep") "Sept" else it }
    val hour = (local.hour % 12).takeIf { it != 0 } ?: 12
    val minute = local.minute.toString().padStart(2, '0')
    val period = if (local.hour < 12) "a.m." else "p.m."
    val shortZone = local.format(DateTimeFormatter.ofPattern("z", Locale.US))
    val fullZone = local.format(DateTimeFormatter.ofPattern("zzzz", Locale.US))
    return "$weekday $month $day$suffix, $hour:$minute $period $shortZone ($fullZone)"
}
