package com.noanadeem.notificationmanager

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Test

class ClockLabelsTest {
    private val pacific = ZoneId.of("America/Los_Angeles")

    @Test fun daylightTimeInSeptember() {
        assertEquals(
            "Mon Sept 28th, 7:01 a.m. PDT",
            headerClockLabel(Instant.parse("2026-09-28T14:01:00Z"), pacific)
        )
    }

    @Test fun standardTimeInJanuary() {
        assertEquals(
            "Wed Jan 28th, 7:01 a.m. PST",
            headerClockLabel(Instant.parse("2026-01-28T15:01:00Z"), pacific)
        )
    }

    @Test fun teenOrdinal() {
        assertEquals(
            "Wed Nov 11th, 12:05 p.m. PST",
            headerClockLabel(Instant.parse("2026-11-11T20:05:00Z"), pacific)
        )
    }
}
