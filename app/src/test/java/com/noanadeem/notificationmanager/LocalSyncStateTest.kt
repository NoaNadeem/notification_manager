package com.noanadeem.notificationmanager

import org.junit.Assert.assertEquals
import org.junit.Test

class LocalSyncStateTest {
    @Test
    fun successfulPendingAndStaleStatesAreVisible() {
        val now = 1_000_000_000L
        val fresh = LocalSyncState(calendarAt = now, dismissalAt = now)
        assertEquals("Synced just now", fresh.headline(now))
        assertEquals("Sync needs attention", fresh.headline(now + 3_600_001))
        assertEquals("Local changes waiting to sync", fresh.copy(pending = setOf("event/1")).headline(now))
    }

    @Test
    fun cachedStatusWaitsForCurrentSessionRefresh() {
        val sessionStartedAt = 2_000_000_000L
        val cached = LocalSyncState(calendarAt = sessionStartedAt - 1_000, dismissalAt = sessionStartedAt - 1_000)
        assertEquals(false, shouldShowSyncStatus(cached, sessionStartedAt, false, false))
        assertEquals(false, shouldShowSyncStatus(cached, sessionStartedAt, true, true))
        assertEquals(true, shouldShowSyncStatus(cached.copy(calendarAt = sessionStartedAt + 1),
            sessionStartedAt, false, false))
        assertEquals(true, shouldShowSyncStatus(cached, sessionStartedAt, false, true))
    }
}
