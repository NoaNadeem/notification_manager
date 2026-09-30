package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UndoStateTest {
    @Test
    fun pendingCommitTransitionsToSuccessOrFailureOnlyForMatchingAction() {
        val event = CalendarEvent("primary", "Test Event - 1", "Test Event - 1",
            Instant.parse("2026-09-28T12:00:00Z"), null, ZoneId.of("UTC"))
        val action = UndoableAction.Dismiss(event)
        val other = UndoableAction.Dismiss(event.copy(id = "Test Event - 2"))
        val pending = UndoState.Pending(action)
        assertEquals(pending, pending.beginCommit(other))
        val committing = pending.beginCommit(action)
        assertTrue(committing is UndoState.Committing)
        assertEquals(UndoState.Idle, committing.finishCommit(action))
        assertEquals(UndoState.Failed(action, "Drive unavailable"),
            committing.finishCommit(action, "Drive unavailable"))
    }
}
