package com.noanadeem.notificationmanager

import java.time.*
import org.junit.Assert.*
import org.junit.Test

class ActionSavingStatusTest {
    private val now = Instant.parse("2026-11-06T20:00:00Z")
    private val event = CalendarEvent("fixture", "fixture", "Synthetic", now, null, ZoneId.of("UTC"))
    @Test fun newestActionOwnsHeaderUntilItFinishes() {
        val old = UndoableAction.Dismiss(event.copy(id = "old"))
        val newest = UndoableAction.Move(event, MoveTarget.OnDate(LocalDate.parse("2026-11-23")), "mock", now)
        assertEquals("Dismissing…", latestSavingStatus(old, old, emptySet()))
        assertEquals("Moving to Monday 23 Nov 2026…", latestSavingStatus(newest, newest, setOf(old.event.id)))
        assertEquals("Moving to Monday 23 Nov 2026…", latestSavingStatus(newest, null, setOf(old.event.id, event.id)))
        assertNull(latestSavingStatus(newest, null, setOf(old.event.id)))
        assertNull(latestSavingStatus(null, null, emptySet()))
    }
    @Test fun dateUsesStagedDestinationAndLocalZoneIncludingTasks() {
        val zone = ZoneId.of("America/Los_Angeles")
        val staged = Instant.parse("2026-11-07T07:30:00Z")
        assertEquals("Moving to Saturday 7 Nov 2026…", movingSaveStatus(event,
            MoveTarget.OnDateTime(LocalDate.parse("2026-11-07"), LocalTime.of(6,0)), staged, zone))
        assertEquals("Moving to Saturday 7 Nov 2026…", movingSaveStatus(event.copy(taskListId="fixture"),
            MoveTarget.After(Duration.ofDays(1)), staged, zone))
    }
}
