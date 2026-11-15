package com.noanadeem.notificationmanager

import java.time.*
import org.junit.Assert.*
import org.junit.Test

class MoveToNowTest {
    private val zone = ZoneId.of("America/Los_Angeles")
    private val now = Instant.parse("2026-11-14T18:20:30Z")
    private val start = now.minus(Duration.ofDays(3))
    private val event = CalendarEvent("fixture", "synthetic", "Synthetic", start, null, zone, end=start.plusSeconds(900))

    @Test fun selectsOnlyPurpleDotPersonalItems() {
        assertTrue(event.canMoveToNow(now))
        for (excluded in listOf(event.copy(title="Priority."), event.copy(hasOtherAttendees=true),
            event.copy(canChangePriority=false), event.copy(isRecurring=true),
            event.copy(end=start.plusSeconds(3600)), event.copy(start=now),
            event.copy(allDayDate=LocalDate.of(2026,11,11)))) assertFalse(excluded.canMoveToNow(now))
        assertTrue(event.copy(taskListId="list",allDayDate=LocalDate.of(2026,11,11)).canMoveToNow(now))
        assertFalse(event.copy(taskListId="list").canMoveToNow(now))
    }

    @Test fun movesEventsToExactTapTimeAndTasksToLocalToday() {
        val target=event.moveToNowTarget(now,zone)
        assertEquals(target, smallEventMoveTarget(event,target,now,zone))
        assertEquals(now to now.plusSeconds(900),shiftTimedTimes(start,event.end!!,now,zone,target))
        val task=event.copy(taskListId="list",allDayDate=LocalDate.of(2026,11,11))
        assertEquals(LocalDate.of(2026,11,14),taskMoveDate(task.moveToNowTarget(now,zone),now,zone))
    }
}
