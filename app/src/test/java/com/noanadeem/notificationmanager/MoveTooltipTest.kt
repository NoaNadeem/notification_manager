package com.noanadeem.notificationmanager

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class MoveTooltipTest {
    private val pacific = ZoneId.of("America/Los_Angeles")
    private val now = Instant.parse("2026-09-28T14:01:00Z")

    @Test fun dayTileShowsDestinationDate() {
        val event = CalendarEvent("test@example.com", "test", "Test Event - 1", now, null, pacific)
        assertEquals("Move to Tue Sep 29", event.moveDestinationTooltip(MoveTarget.After(Duration.ofDays(1)), now, pacific))
    }

    @Test fun hourTileShowsTimeAndZone() {
        val event = CalendarEvent("test@example.com", "test", "Test Event - 1", now, null, pacific)
        assertEquals("Move to Mon Sep 28, 11:01 AM PDT", event.moveDestinationTooltip(MoveTarget.After(Duration.ofHours(4)), now, pacific))
    }

    @Test fun allDayZeroDayShowsToday() {
        val event = CalendarEvent("test@example.com", "test", "Test Event - 1", now, LocalDate.parse("2026-09-22"), pacific)
        assertEquals("Move to Mon Sep 28", event.moveDestinationTooltip(MoveTarget.After(Duration.ZERO), now, pacific))
    }
}
