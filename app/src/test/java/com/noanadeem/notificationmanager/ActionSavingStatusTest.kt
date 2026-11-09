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
        assertEquals("Dismissing Synthetic…", latestSavingStatus(old, old, emptySet()))
        assertEquals("Moving Synthetic to Mon 23rd Nov 2026", latestSavingStatus(newest, newest, setOf(old.event.id)))
        assertEquals("Moving Synthetic to Mon 23rd Nov 2026", latestSavingStatus(newest, null, setOf(old.event.id, event.id)))
        assertNull(latestSavingStatus(newest, null, setOf(old.event.id)))
        assertNull(latestSavingStatus(null, null, emptySet()))
    }
    @Test fun dateUsesStagedDestinationAndLocalZoneIncludingTasks() {
        val zone = ZoneId.of("America/Los_Angeles")
        val staged = Instant.parse("2026-11-07T07:30:00Z")
        assertEquals("Moving Synthetic to Sat 7th Nov 2026", movingSaveStatus(event,
            MoveTarget.OnDateTime(LocalDate.parse("2026-11-07"), LocalTime.of(6,0)), staged, zone))
        assertEquals("Moving Synthetic to Sat 7th Nov 2026", movingSaveStatus(event.copy(taskListId="fixture"),
            MoveTarget.After(Duration.ofDays(1)), staged, zone))
    }
    @Test fun shortTitleAndOrdinalDateFormatting() {
        assertEquals("Dentist appointment", savingTitle("  Dentist\n appointment  "))
        assertEquals("😀".repeat(20) + "…", savingTitle("😀".repeat(21)))
        assertEquals("Untitled event", savingTitle(" "))
        for ((day, suffix) in listOf(1 to "st", 2 to "nd", 3 to "rd", 7 to "th", 11 to "th", 12 to "th", 13 to "th", 21 to "st", 22 to "nd", 23 to "rd")) {
            val status = movingSaveStatus(event.copy(title="A".repeat(30)), MoveTarget.OnDate(LocalDate.of(2027,9,day)), now)
            assertTrue(status.matches(Regex("Moving ${"A".repeat(20)}… to [A-Za-z]{3} $day$suffix Sept 2027")))
        }
    }
}
