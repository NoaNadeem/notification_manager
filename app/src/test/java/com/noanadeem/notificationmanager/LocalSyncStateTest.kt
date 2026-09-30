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
    fun localHistoryKeepsThreeDaysAndCapsHeavyUsage() {
        val now = 40L * 86_400_000L
        val old = ActionEntry("dismiss", "old", 0, now - 4L * 86_400_000L, "synced")
        val withinWindow = ActionEntry("dismiss", "within", 0, now - 2L * 86_400_000L, "synced")
        val recent = ActionEntry("move", "recent", 1, now, "undone")
        assertEquals(listOf(withinWindow, recent),
            LocalSyncState(history = listOf(old, withinWindow)).addHistory(recent, now).history)
        assertEquals(500, LocalSyncState(history = List(500) { recent }).addHistory(recent, now).history.size)
    }
}
