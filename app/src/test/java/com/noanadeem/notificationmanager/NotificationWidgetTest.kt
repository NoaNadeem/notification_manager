package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationWidgetTest {
    @Test fun hourlyCheckSkipsRecentSuccessfulCalendarRefresh() {
        val hour = 3_600_000L
        assertFalse(widgetRefreshDue(hour, hour + 58 * 60_000L))
        assertTrue(widgetRefreshDue(hour, hour + 59 * 60_000L))
        assertTrue(widgetRefreshDue(0L, hour))
    }

    @Test fun nextCheckTargetsNextLocalHour() {
        val zone = ZoneId.systemDefault()
        val now = ZonedDateTime.of(2026, 9, 30, 10, 37, 0, 0, zone).toInstant().toEpochMilli()
        val target = Instant.ofEpochMilli(now + nextWidgetHourDelay(now)).atZone(zone)
        assertEquals(11, target.hour)
        assertEquals(0, target.minute)
    }
}
