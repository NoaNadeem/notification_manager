package com.noanadeem.notificationmanager
import java.time.*
import org.junit.Assert.*
import org.junit.Test
class PriorityTest {
 private val now=Instant.parse("2026-11-10T12:00:00Z")
 private val event=CalendarEvent("fixture","fixture","Synthetic",now,null,ZoneId.of("UTC"))
 @Test fun markerToggleIsIdempotentAndCaseInsensitive() {
  assertEquals("Synthetic ★",priorityTitle(event.title,true))
  assertEquals("Synthetic ★",priorityTitle("Synthetic (PRI)",true))
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
 @Test fun starsAndPersonalEventEligibility() {
  assertEquals("Event ★",priorityTitle("Event ★",true))
  assertEquals("Event",priorityTitle("Event (pri) ★ ★",false))
  assertTrue(event.copy(title="Event ★").isPriority)
  assertFalse(event.copy(title="★ inside title").isPriority)
  val mine="fixture@example.invalid"
  assertTrue(personalPriorityAllowed(emptyList(),mine))
  assertTrue(personalPriorityAllowed(listOf(mine to false,"alias@example.invalid" to true),mine))
  assertFalse(personalPriorityAllowed(listOf("guest@example.invalid" to false),mine))
  assertFalse(personalPriorityAllowed(listOf("room@example.invalid" to false),mine))
  assertFalse(personalPriorityAllowed(listOf("" to false),mine))
  assertFalse(personalPriorityAllowed(emptyList(),mine,omitted=true))
  assertFalse(personalPriorityAllowed(emptyList(),mine,organizer="other@example.invalid"))
 }
}
