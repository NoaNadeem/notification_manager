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

    @Test
    fun committedRowKeepsItsOriginalPositionUntilDisplayHoldClears() {
        fun event(id: String) = CalendarEvent("primary", id, "Test Event - $id",
            Instant.parse("2026-09-28T12:00:00Z"), null, ZoneId.of("UTC"))
        val first = event("1")
        val held = event("2")
        val last = event("3")
        assertEquals(listOf(first, held, last), displayEventsWithHeldAction(listOf(first, last), held, 1))
        assertEquals(listOf(first, held, last), displayEventsWithHeldAction(
            listOf(first, held.copy(start = held.start.plusSeconds(86_400)), last), held, 1))
        assertEquals(listOf(first, last), displayEventsWithHeldAction(listOf(first, last), null, 1))
    }

    @Test
    fun tenSuccessiveActionsImmediatelyOwnUndoWhilePreviousCommitsRun() {
        fun event(id: String) = CalendarEvent("primary", id, "Synthetic $id",
            Instant.parse("2026-09-28T12:00:00Z"), null, ZoneId.of("UTC"))
        var state: UndoState = UndoState.Idle
        val background = mutableListOf<UndoableAction>()
        val actions = (1..10).map { UndoableAction.Move(event(it.toString()),
            MoveTarget.After(java.time.Duration.ofDays(1)), "mock-token") }
        actions.forEach { action ->
            state = state.stageNextAction(action) { background += it }
            assertEquals(UndoState.Pending(action), state)
        }
        assertEquals(actions.dropLast(1), background)
        background.forEach { completed ->
            state = state.finishCommit(completed)
            assertEquals(UndoState.Pending(actions.last()), state)
            state = state.finishCommit(completed, "Injected network failure")
            assertEquals(UndoState.Pending(actions.last()), state)
        }
    }

    @Test
    fun cachedAuthorizationAllowsImmediateTapsButRejectsExpiredTokens() {
        val authorizedAt = 1_000_000L
        assertEquals("mock-token", cachedMoveToken("mock-token", authorizedAt, authorizedAt + 1_000))
        assertEquals(null, cachedMoveToken("mock-token", authorizedAt, authorizedAt + 45 * 60_000L))
        assertEquals(null, cachedMoveToken(null, authorizedAt, authorizedAt))
    }
}
