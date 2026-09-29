# Calendar date and instance rules

Both clients use the device's local time zone to choose the visible date range and to calculate move targets. The default window and the Current preset begin exactly 7 × 24 hours before refresh and end at the next local midnight. The other presets start at local midnight on their first day; end-of-week starts Monday at 00:00. A 0-day lookahead includes the rest of today. A 7-day lookahead ends at midnight after the seventh following day. Use calendar-day arithmetic for the end boundary and calendar-day presets so daylight-saving changes do not omit or add a day.

Google Calendar all-day starts are dates, and all-day ends are exclusive dates. An all-day item covering September 28 has start September 28 and end September 29. Keep the date span when moving an all-day event. Its age is measured from midnight in the Calendar time zone. Timed move tiles use the current device instant plus the tile duration. A picked date uses the current local clock time on that date. A move retains the event's original duration.

Sort by the event's local date, oldest first. Within a date, all-day events come before timed events, and timed events sort by start instant. A recurring instance has `recurringEventId` (or a recurrence rule on a master). It cannot be moved from either client; its pencil opens Google Calendar's editor. Dismissal uses the instance ID and start instant, so dismissing one instance does not dismiss the series. If Google later changes that same instance's start, its older dismissal key may no longer match; that is a known limitation.

Fixture matrix for both test suites:

| Case | Expected result |
| --- | --- |
| Today at 23:59 with 0-day lookahead | Included; tomorrow at 00:00 excluded |
| Spring-forward or fall-back day | Next local midnight remains the boundary |
| Wednesday end-of-week preset | Monday 00:00 through Thursday 00:00 |
| All-day with exclusive end | Keeps the same number of dates when moved |
| Recurring instances with shared parent | Moving either is rejected; dismissing one leaves the other |
| One-hour or longer event; external attendee | Highlighted and included by the real-event filter |
| Search on a primary calendar with shared calendars visible | Only the authenticated primary calendar ID is queried |

The Android fixtures live in the app's `CalendarEventRulesTest.kt` and `DismissalRulesTest.kt`; extension fixtures live in `model.test.js` and `dismissal-sync.test.js`. Add a matching fixture on both sides whenever date or instance rules change.
