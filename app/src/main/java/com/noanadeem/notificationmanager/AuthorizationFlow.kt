package com.noanadeem.notificationmanager

// Offer new-scope consent once on foreground upgrade; an explicit retry may offer it again.
internal fun shouldOfferGoogleConsent(explicitRequest: Boolean, automaticPromptOffered: Boolean): Boolean =
    explicitRequest || !automaticPromptOffered

internal const val GOOGLE_ACCESS_REQUIRED = "Google access needs updating for Calendar, Tasks, and sync. Tap Reconnect Google access to review permissions."
