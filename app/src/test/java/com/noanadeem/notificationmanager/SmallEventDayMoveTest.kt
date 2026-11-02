package com.noanadeem.notificationmanager

import java.time.*
import org.junit.Assert.*
import org.junit.Test

class SmallEventDayMoveTest {
    private val zone = ZoneId.of("America/Los_Angeles")
    private val start = Instant.parse("2026-10-20T16:00:00Z")
    private val event = CalendarEvent("fixture", "fixture", "Synthetic event", start, null, zone,
        end = start.plusSeconds(900))

    @Test fun localMorningAcrossDaylightSavingPreservesDuration() {
        for (stamp in listOf("2026-10-31T23:30:00-07:00", "2027-03-13T23:30:00-08:00")) {
            val now = OffsetDateTime.parse(stamp).toInstant()
            for (days in listOf(1L, 2L, 3L, 4L, 7L)) {
                val choice = MoveTarget.After(Duration.ofDays(days))
                val target = smallEventMoveTarget(event, choice, now, zone)
                val expected = now.atZone(zone).toLocalDate().plusDays(days).atTime(6, 0).atZone(zone).toInstant()
                val moved = shiftTimedTimes(start, event.end!!, now, zone, target)
                assertEquals(expected, moved.first)
                assertEquals(Duration.ofMinutes(15), Duration.between(moved.first, moved.second))
                assertEquals(moved, shiftTimedTimes(start, event.end, now.plusSeconds(86400), zone, target))
                assertTrue(moveUndoDescription(event, target, now, zone).endsWith("6:00 AM"))
                assertTrue(event.moveDestinationTooltip(choice, now, zone, morning = true).contains("6:00 AM"))
            }
        }
    }

    @Test fun optOutAndOtherActionsKeepExistingSemantics() {
        val now = Instant.parse("2026-11-01T06:30:00Z")
        val choice = MoveTarget.After(Duration.ofDays(1))
        assertEquals(choice, smallEventMoveTarget(event, choice, now, zone, false))
        assertEquals(now.plusSeconds(86400), shiftTimedTimes(start, event.end!!, now, zone, choice).first)
        for (other in listOf(event.copy(hasOtherAttendees = true), event.copy(end = start.plusSeconds(3600)),
            event.copy(allDayDate = LocalDate.parse("2026-10-20")), event.copy(taskListId = "fixture"))) {
            assertEquals(choice, smallEventMoveTarget(other, choice, now, zone))
        }
        for (target in listOf(MoveTarget.After(Duration.ofHours(4)), MoveTarget.After(Duration.ZERO),
            MoveTarget.OnDate(LocalDate.parse("2026-11-05")), MoveTarget.OnDateTime(LocalDate.parse("2026-11-05"), LocalTime.NOON))) {
            assertEquals(target, smallEventMoveTarget(event, target, now, zone))
        }
    }
}
