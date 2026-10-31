package com.noanadeem.notificationmanager

import org.junit.Assert.*
import org.junit.Test

class AuthorizationFlowTest {
    @Test fun missingUpgradeAccessOffersConsentButCancellationDoesNotLoop() {
        assertTrue(shouldOfferGoogleConsent(explicitRequest = false, automaticPromptOffered = false))
        assertFalse(shouldOfferGoogleConsent(explicitRequest = false, automaticPromptOffered = true))
        assertTrue(shouldOfferGoogleConsent(explicitRequest = true, automaticPromptOffered = true))
    }
    @Test fun driveSuccessCannotEraseTasksPermissionFailure() {
        val now = 1_000_000_000L
        val tasksFailed = LocalSyncState(calendarAt = now, dismissalAt = now,
            tasksError = "Tasks permission missing")
        val driveSucceeded = tasksFailed.copy(error = null, dismissalAt = now + 1)
        assertEquals("Sync needs attention", driveSucceeded.headline(now + 1))
        assertEquals("Tasks permission missing", driveSucceeded.tasksError)
        assertEquals("Synced just now", driveSucceeded.copy(tasksError = null, tasksAt = now).headline(now + 1))
    }
}
