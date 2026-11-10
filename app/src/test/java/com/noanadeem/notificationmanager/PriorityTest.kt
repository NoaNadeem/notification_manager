package com.noanadeem.notificationmanager
import java.time.*
import org.junit.Assert.*
import org.junit.Test
class PriorityTest {
 private val now=Instant.parse("2026-11-10T12:00:00Z")
 private val event=CalendarEvent("fixture","fixture","Synthetic",now,null,ZoneId.of("UTC"))
 @Test fun markerToggleIsIdempotentAndCaseInsensitive() {
  assertEquals("Synthetic (pri)",priorityTitle(event.title,true))
  assertEquals("Synthetic (PRI)",priorityTitle("Synthetic (PRI)",true))
  assertEquals("Synthetic",priorityTitle("Synthetic (pri) (PRI)",false))
  assertTrue(event.copy(title="Synthetic (PRI)").isPriority)
  assertFalse(event.isPriority)
 }
 @Test fun priorityOutranksDatesAndKeepsChronologicalOrderWithinGroup() {
  val old=event.copy(id="old",start=now.minusSeconds(86400))
  val future=event.copy(id="future",title="Future (pri)",start=now.plusSeconds(86400))
  val earlier=event.copy(id="earlier",title="Earlier (pri)")
  val undated=event.copy(id="undated",title="Undated (pri)",taskListId="list")
  assertEquals(listOf("earlier","future","undated","old"),sortCalendarEvents(listOf(old,future,undated,earlier)).map{it.id})
  assertEquals("old",sortCalendarSearchEvents(listOf(old,future,undated,earlier)).last().id)
  assertFalse(event.copy(title=priorityTitle(future.title,false)).isPriority)
 }
}
