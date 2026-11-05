package com.noanadeem.notificationmanager

import java.time.*
import org.junit.Assert.*
import org.junit.Test

class ReadOnlyPreviewTest {
    private val zone = ZoneId.of("America/Los_Angeles")
    @Test fun previewHasLocalCalendarBoundariesAndNeverOverlapsReview() {
        for ((stamp, hours) in listOf("2026-10-31T12:00:00-07:00" to 25L, "2027-03-13T12:00:00-08:00" to 23L)) {
            val now = OffsetDateTime.parse(stamp).toInstant()
            val (first, last) = nextDayPreviewBounds(now, 0, zone)
            assertEquals(displayEndExclusive(now, 0, zone), first)
            assertEquals(hours, Duration.between(first, last).toHours())
            val event = CalendarEvent("fixture", "fixture", "Synthetic preview", first, null, zone)
            assertTrue(event.isInNextDayPreview(now, 0, zone))
            assertFalse(isInDisplayWindow(first, now, 7, 0, zone))
            assertFalse(event.copy(start = first.minusNanos(1)).isInNextDayPreview(now, 0, zone))
            assertTrue(event.copy(start = last.minusNanos(1)).isInNextDayPreview(now, 0, zone))
            assertFalse(event.copy(start = last).isInNextDayPreview(now, 0, zone))
            assertFalse(event.copy(taskListId = "fixture").isInNextDayPreview(now, 0, zone))
        }
        val now = OffsetDateTime.parse("2026-11-04T12:00:00-08:00").toInstant()
        assertEquals(LocalDate.parse("2026-11-09"), nextDayPreviewBounds(now, 4, zone).first.atZone(zone).toLocalDate())
    }
}
