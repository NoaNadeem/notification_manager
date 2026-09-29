package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DismissalRulesTest {
    private val now = Instant.parse("2026-09-28T18:00:00Z")

    @Test
    fun keepsRecordsAcrossLookbackChangesThenPrunesAfterMaximumWindow() {
        val withinWindow = now.minus(364, ChronoUnit.DAYS).toEpochMilli()
        val expired = now.minus(366, ChronoUnit.DAYS).toEpochMilli()
        val merged = mergeDismissals(
            listOf(DismissalRecord("kept", withinWindow, now.toEpochMilli()),
                DismissalRecord("expired", expired, now.toEpochMilli())),
            emptyList(), now
        )
        assertEquals(listOf("kept"), merged.map { it.eventId })
    }

    @Test
    fun cloudMergeDoesNotLosePhoneDismissal() {
        val start = now.minus(2, ChronoUnit.DAYS).toEpochMilli()
        val local = DismissalRecord("phone-event", start, now.toEpochMilli())
        val remote = DismissalRecord("other-device-event", start, now.toEpochMilli())
        val merged = mergeDismissals(listOf(local), listOf(remote), now)
        assertEquals(setOf(local, remote), merged.toSet())
    }

    @Test
    fun concurrentClientsPublishIndependentMarkersInEitherOrder() = runBlocking {
        val phone = DismissalRecord("Test Event - 1", now.minusSeconds(60).toEpochMilli(), now.toEpochMilli())
        val extension = DismissalRecord("Test Event - 2", now.plusSeconds(60).toEpochMilli(), now.toEpochMilli())
        for (order in listOf(listOf(phone, extension), listOf(extension, phone))) {
            val driveMarkers = mutableListOf<DismissalRecord>()
            val sameInitialSnapshot = emptyList<DismissalRecord>()
            for (record in order) {
                publishMissingDismissals(listOf(record), sameInitialSnapshot, now) { driveMarkers.add(it) }
            }
            assertEquals(setOf(phone, extension), mergeDismissals(driveMarkers, emptyList(), now).toSet())
        }
    }

    @Test
    fun legacyRecordIsNotRepublished() = runBlocking {
        val legacy = DismissalRecord("Test Event - 1", now.minusSeconds(60).toEpochMilli(), now.toEpochMilli())
        val local = DismissalRecord("Test Event - 2", now.minusSeconds(120).toEpochMilli(), now.toEpochMilli())
        val created = mutableListOf<DismissalRecord>()
        val merged = publishMissingDismissals(listOf(legacy, local), listOf(legacy), now) { created.add(it) }
        assertEquals(listOf(local), created)
        assertEquals(setOf(legacy, local), merged.toSet())
    }

    @Test
    fun futureEventDismissalPersistsThroughPhoneAndCloudMerge() {
        val futureStart = now.plus(4, ChronoUnit.HOURS).toEpochMilli()
        val record = DismissalRecord("Test Event - 1", futureStart, now.toEpochMilli())
        val merged = mergeDismissals(listOf(record), emptyList(), now)
        assertEquals(listOf(record), merged)
        assertTrue(listOf(CalendarEvent("primary", record.eventId, "Test Event - 1",
            Instant.ofEpochMilli(futureStart), null, ZoneId.of("UTC"))).withoutDismissals(merged).isEmpty())
    }

    @Test
    fun dismissalMatchesOccurrenceAndStartTime() {
        val oldStart = now.minus(2, ChronoUnit.DAYS)
        fun event(start: Instant) = CalendarEvent(
            "primary", "same-id", "Test Event - 1", start, null, ZoneId.of("UTC")
        )
        val record = DismissalRecord("same-id", oldStart.toEpochMilli(), now.toEpochMilli())
        assertTrue(listOf(event(oldStart)).withoutDismissals(listOf(record)).isEmpty())
        assertFalse(listOf(event(oldStart.plusSeconds(60))).withoutDismissals(listOf(record)).isEmpty())
    }

    @Test
    fun dismissingRecurringInstanceLeavesNextInstanceVisible() {
        val first = CalendarEvent("primary", "series_20260928", "Test Event - 1",
            now.minus(1, ChronoUnit.DAYS), null, ZoneId.of("UTC"), isRecurring = true)
        val next = first.copy(id = "series_20260929", start = now)
        val record = DismissalRecord(first.id, first.start.toEpochMilli(), now.toEpochMilli())
        assertEquals(listOf(next), listOf(first, next).withoutDismissals(listOf(record)))
    }
}
