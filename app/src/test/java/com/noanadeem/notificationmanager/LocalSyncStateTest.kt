package com.noanadeem.notificationmanager

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalSyncStateTest {
    @Test
    fun staleAndOfflineStatesAreVisible() {
        val now = 1_000_000_000L
        val fresh = LocalSyncState(calendarAt = now, dismissalAt = now)
        assertEquals("Synced just now", fresh.headline(true, now))
        assertEquals("Offline — changes saved on this device", fresh.headline(false, now))
        assertEquals("Sync needs attention", fresh.headline(true, now + 3_600_001))
        assertEquals("Local changes waiting to sync", fresh.copy(pending = setOf("event/1")).headline(true, now))
    }

    @Test
    fun localHistoryDropsEntriesOlderThanThirtyDays() {
        val now = 40L * 86_400_000L
        val old = ActionEntry("dismiss", "old", 0, now - 31L * 86_400_000L, "synced")
        val recent = ActionEntry("move", "recent", 1, now, "undone")
        assertEquals(listOf(recent), LocalSyncState(history = listOf(old)).addHistory(recent, now).history)
    }
}
