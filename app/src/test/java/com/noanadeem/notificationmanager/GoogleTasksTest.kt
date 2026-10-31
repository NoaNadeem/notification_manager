package com.noanadeem.notificationmanager

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class GoogleTasksTest {
    @Test fun taskDateMovesUseCalendarDaysAndRejectHours() {
        val instant = Instant.parse("2026-10-31T12:00:00Z")
        assertEquals(LocalDate.of(2026, 11, 1), taskMoveDate(MoveTarget.After(Duration.ofDays(1)), instant, ZoneId.of("America/Los_Angeles")))
        assertThrows(IllegalArgumentException::class.java) { taskMoveDate(MoveTarget.After(Duration.ofHours(4)), instant) }
        assertEquals(LocalDate.of(2026, 12, 1), taskMoveDate(MoveTarget.OnDate(LocalDate.of(2026, 12, 1)), instant))
    }
    @Test fun taskNotesOnlyLinkToWebUrlsAndOnlyShowFirstNonblankLine() {
        assertEquals("Plain note", taskNote("\n Plain note\nhttps://example.invalid"))
        assertNull(taskNoteUrl("Plain note"))
        assertNull(taskNoteUrl("javascript:alert(1)"))
        assertEquals("https://example.invalid", taskNoteUrl("https://example.invalid More"))
    }
    @Test fun undatedTasksHaveStableKeysSurviveDismissalMergeAndSortLast() {
        val now = Instant.now()
        val undated = CalendarEvent("primary", "task:list:undated", "Synthetic task", Instant.EPOCH, null, ZoneId.of("UTC"),taskListId="list",taskId="undated",location="Plain text")
        assertTrue(undated.isUndatedTask)
        assertEquals("No due date", undated.ageDescription())
        assertFalse(undated.locationIsLink)
        val dismissal = DismissalRecord(undated.id, 0, now.toEpochMilli())
        assertEquals(listOf(dismissal), mergeDismissals(listOf(dismissal), emptyList(), now))
        assertEquals(listOf(undated),listOf(undated).withoutDismissals(listOf(dismissal)))
        val event = undated.copy(id="event",taskListId=null,taskId=null,start=now)
        assertEquals(listOf(event,undated),sortCalendarEvents(listOf(undated,event)))
        assertEquals("https://tasks.google.com/task/example", calendarEventOpenLink("https://tasks.google.com/task/example",true))
    }
    @Test fun datedTasksNeverUseTheLongEventHighlight() {
        val date=LocalDate.of(2026,10,31)
        val task=CalendarEvent("primary","task:list:synthetic","Synthetic task",date.atStartOfDay(ZoneId.of("UTC")).toInstant(),
            date,ZoneId.of("UTC"),end=date.plusDays(1).atStartOfDay(ZoneId.of("UTC")).toInstant(),taskListId="list",taskId="synthetic")
        assertFalse(task.isEmphasized())
        assertTrue(task.copy(taskListId=null,taskId=null).isEmphasized())
    }

}
