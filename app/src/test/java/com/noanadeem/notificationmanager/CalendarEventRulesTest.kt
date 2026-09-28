package com.noanadeem.notificationmanager

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CalendarEventRulesTest {
    private val now = Instant.parse("2026-09-28T18:00:00Z")

    @Test
    fun moveTilesUseCurrentTimeAndKeepOriginalDuration() {
        val oldStart = now.minus(5, ChronoUnit.DAYS)
        val oldEnd = oldStart.plus(90, ChronoUnit.MINUTES)

        for (days in listOf(1, 3, 7)) {
            val (movedStart, movedEnd) = shiftTimedTimes(
                oldStart, oldEnd, now, ZoneId.of("UTC"),
                MoveTarget.After(Duration.ofDays(days.toLong()))
            )
            assertEquals(now.plus(days.toLong(), ChronoUnit.DAYS), movedStart)
            assertEquals(Duration.ofMinutes(90), Duration.between(movedStart, movedEnd))
            assertFalse(isInPastWindow(movedStart, now, 7))
        }
    }

    @Test
    fun allDayMoveKeepsEventAllDayAndPreservesItsSpan() {
        val (movedStart, movedEnd) = shiftAllDayDates(
            start = LocalDate.parse("2026-09-20"),
            end = LocalDate.parse("2026-09-22"),
            now = now,
            phoneZone = ZoneId.of("UTC"),
            calendarZone = ZoneId.of("UTC"),
            target = MoveTarget.After(Duration.ofDays(1))
        )

        assertEquals(LocalDate.parse("2026-09-29"), movedStart)
        assertEquals(LocalDate.parse("2026-10-01"), movedEnd)
    }

    @Test
    fun allDayMoveRemainsFutureWhenPhoneAndCalendarZonesDiffer() {
        val latePhoneTime = Instant.parse("2026-09-29T06:00:00Z")
        val (movedStart, _) = shiftAllDayDates(
            start = LocalDate.parse("2026-09-20"),
            end = LocalDate.parse("2026-09-21"),
            now = latePhoneTime,
            phoneZone = ZoneId.of("America/Los_Angeles"),
            calendarZone = ZoneId.of("Asia/Tokyo"),
            target = MoveTarget.After(Duration.ofDays(1))
        )

        assertTrue(movedStart.atStartOfDay(ZoneId.of("Asia/Tokyo")).toInstant() > latePhoneTime)
    }

    @Test
    fun ageIsRoundedUpInHoursThenDays() {
        fun label(start: Instant) = CalendarEvent(
            calendarId = "primary",
            id = "test",
            title = "Test Event - 1",
            start = start,
            allDayDate = null,
            calendarZone = ZoneId.of("UTC")
        ).ageDescription(now)

        assertEquals("1 hr ago", label(now.minusSeconds(1)))
        assertEquals("2 hrs ago", label(now.minusSeconds(3_601)))
        assertEquals("1 day ago", label(now.minusSeconds(86_400)))
        assertEquals("2 days ago", label(now.minusSeconds(86_401)))
    }

    @Test
    fun fourHourMoveUsesCurrentTime() {
        val oldStart = now.minus(5, ChronoUnit.DAYS)
        val (movedStart, movedEnd) = shiftTimedTimes(
            oldStart, oldStart.plusSeconds(3_600), now, ZoneId.of("UTC"),
            MoveTarget.After(Duration.ofHours(4))
        )
        assertEquals(now.plus(4, ChronoUnit.HOURS), movedStart)
        assertEquals(Duration.ofHours(1), Duration.between(movedStart, movedEnd))
    }

    @Test
    fun hourlyMoveIsRejectedForAllDayEvent() {
        assertThrows(IllegalArgumentException::class.java) {
            shiftAllDayDates(
                LocalDate.parse("2026-09-20"),
                LocalDate.parse("2026-09-21"),
                now,
                ZoneId.of("UTC"),
                ZoneId.of("UTC"),
                MoveTarget.After(Duration.ofHours(4))
            )
        }
    }

    @Test
    fun pickedDateUsesPhonesCurrentClockTime() {
        val phoneZone = ZoneId.of("America/Los_Angeles")
        val pickedDate = LocalDate.parse("2026-10-05")
        val (movedStart, _) = shiftTimedTimes(
            now.minus(2, ChronoUnit.DAYS), now.minus(2, ChronoUnit.DAYS).plusSeconds(3_600),
            now, phoneZone, MoveTarget.OnDate(pickedDate)
        )
        assertEquals(pickedDate, movedStart.atZone(phoneZone).toLocalDate())
        assertEquals(now.atZone(phoneZone).toLocalTime(), movedStart.atZone(phoneZone).toLocalTime())
    }

    @Test
    fun lookbackIncludesItsBoundariesButExcludesFutureEvents() {
        assertTrue(isInPastWindow(now, now, 7))
        assertTrue(isInPastWindow(now.minus(7, ChronoUnit.DAYS), now, 7))
        assertFalse(isInPastWindow(now.minus(7, ChronoUnit.DAYS).minusSeconds(1), now, 7))
        assertTrue(isInPastWindow(now.minus(30, ChronoUnit.DAYS), now, 30))
        assertFalse(isInPastWindow(now.plusSeconds(1), now, 365))
    }

    @Test
    fun invalidDurationsAreRejectedBeforeAnyCalendarWrite() {
        assertThrows(IllegalArgumentException::class.java) {
            shiftTimedTimes(
                now, now.minusSeconds(1), now, ZoneId.of("UTC"),
                MoveTarget.After(Duration.ofDays(1))
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            shiftAllDayDates(
                LocalDate.parse("2026-09-20"),
                LocalDate.parse("2026-09-20"),
                now,
                ZoneId.of("UTC"),
                ZoneId.of("UTC"),
                MoveTarget.After(Duration.ofDays(1))
            )
        }
    }
}
