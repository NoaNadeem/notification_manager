package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.temporal.ChronoUnit
import org.junit.Assert.assertEquals
import org.junit.Test

class MoveHistoryTest {
    private val now = Instant.parse("2026-09-30T18:00:00Z")

    private fun record(id: String, movedAt: Instant = now) = MoveRecord(
        id, "event-$id", "Test Event - $id", now.minusSeconds(3600).toEpochMilli(),
        now.plusSeconds(3600).toEpochMilli(), movedAt.toEpochMilli()
    )

    @Test
    fun keepsOnlyTenNewestMovesAndPrunesThirtyDayOldRecords() {
        val records = (1..12).map { index -> record("$index", now.plusSeconds(index.toLong())) } +
            record("expired", now.minus(31, ChronoUnit.DAYS))
        assertEquals((12 downTo 3).map(Int::toString), recentMoves(records, now = now).map { it.id })
    }

    @Test
    fun twoClientsMovingConcurrentlyPreserveBothRecordsInEitherOrder() {
        val phone = record("phone")
        val extension = record("extension")
        for (order in listOf(listOf(phone, extension), listOf(extension, phone))) {
            val sameInitialDriveSnapshot = emptyList<MoveRecord>()
            val driveMarkers = order.map { local -> recentMoves(listOf(local), sameInitialDriveSnapshot, now).single() }
            assertEquals(setOf(phone, extension), recentMoves(emptyList(), driveMarkers, now).toSet())
        }
    }

    @Test
    fun retriesDoNotDuplicateMoveRecords() {
        val move = record("same")
        assertEquals(listOf(move), recentMoves(listOf(move), listOf(move), now))
    }
}
