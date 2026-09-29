import test from "node:test";
import assert from "node:assert/strict";
import { ageLabel, eventStartMs, shiftEvent, mergeDismissals, locationHref, isTwoDaysOld, isEmphasized, isRecurring, compareEvents, displayWindow } from "./model.js";

test("recurring instances cannot move and dismissal keys remain occurrence specific", () => {
  const first = { id: "series_20260928", recurringEventId: "series", start: { dateTime: "2026-09-28T12:00:00Z" } };
  const second = { ...first, id: "series_20260929", start: { dateTime: "2026-09-29T12:00:00Z" } };
  assert.equal(isRecurring(first), true);
  assert.throws(() => shiftEvent(first, { days: 1 }), /Recurring events/);
  const dismissed = new Set([`${first.id}/${eventStartMs(first, "UTC")}`]);
  assert.equal(dismissed.has(`${second.id}/${eventStartMs(second, "UTC")}`), false);
});

test("zero lookahead includes the rest of today in browser local time", () => {
  const now = new Date(2026, 8, 28, 10, 30).getTime();
  const bounds = displayWindow(now, 7, 0);
  assert.equal(bounds.lastExclusive, new Date(2026, 8, 29).getTime());
  assert.ok(new Date(2026, 8, 28, 23, 59).getTime() < bounds.lastExclusive);
  assert.ok(new Date(2026, 8, 29, 0, 0).getTime() >= bounds.lastExclusive);
  assert.equal(displayWindow(now, 7, 3).lastExclusive, new Date(2026, 9, 2).getTime());
  assert.equal(ageLabel(now + 3_600_000, now), "In 1 hr");
});

test("review presets use local calendar-day boundaries, including Monday", () => {
  const wednesday = new Date(2026, 8, 30, 15).getTime();
  assert.equal(displayWindow(wednesday, 1, 0, "daily").first, new Date(2026, 8, 29).getTime());
  assert.equal(displayWindow(wednesday, 7, 0, "current").first, wednesday - 7 * 86_400_000);
  assert.equal(displayWindow(wednesday, 1, 0, "endOfWeek").first, new Date(2026, 8, 28).getTime());
  assert.equal(displayWindow(wednesday, 7, 7, "weekAhead").lastExclusive, new Date(2026, 9, 8).getTime());
});

test("lookahead follows calendar days across daylight saving changes", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const now = new Date(2026, 2, 8, 1, 30).getTime();
    assert.equal(displayWindow(now, 7, 0).lastExclusive, new Date(2026, 2, 9).getTime());
    assert.equal(displayWindow(now, 7, 1).lastExclusive, new Date(2026, 2, 10).getTime());
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("old dot uses 48 hours; long, shared, and all-day events get highlighted", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const event = { start: { dateTime: "2026-09-26T12:00:00Z" }, end: { dateTime: "2026-09-26T12:15:00Z" }, attendees: [{ email: "me@example.com", self: true }] };
  assert.equal(isTwoDaysOld(event, "UTC", now), true);
  assert.equal(isTwoDaysOld(event, "UTC", now - 1), false);
  assert.equal(isEmphasized(event, "me@example.com"), false);
  assert.equal(isEmphasized({ ...event, end: { dateTime: "2026-09-26T13:00:00Z" } }, "me@example.com"), true);
  assert.equal(isEmphasized({ ...event, attendees: [...event.attendees, { email: "friend@example.com" }] }, "me@example.com"), true);
  assert.equal(isEmphasized({ start: { date: "2026-09-25" } }, "me@example.com"), true);
});

test("events sort oldest date first and all-day first within that date", () => {
  const timed = { start: { dateTime: "2026-09-28T11:00:00Z" } };
  const allDay = { start: { date: "2026-09-27" } };
  const sameDayAllDay = { start: { date: "2026-09-28" } };
  assert.deepEqual([timed, allDay, sameDayAllDay].sort((a, b) => compareEvents(a, b, "UTC")),
    [allDay, sameDayAllDay, timed]);
});

test("ages round up and switch from hours to days after 24 hours", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(ageLabel(now - 1, now), "1 hr ago");
  assert.equal(ageLabel(now - 3_600_001, now), "2 hrs ago");
  assert.equal(ageLabel(now - 86_400_000, now), "1 day ago");
  assert.equal(ageLabel(now - 86_400_001, now), "2 days ago");
});

test("timed moves use current time, preserve duration, and do not mutate input", () => {
  const original = { start: { dateTime: "2026-09-21T10:00:00Z", timeZone: "America/Los_Angeles" }, end: { dateTime: "2026-09-21T11:30:00Z", timeZone: "America/Los_Angeles" } };
  const moved = shiftEvent(original, { days: 1 }, new Date("2026-09-28T12:00:00Z"));
  assert.equal(moved.start.dateTime, "2026-09-29T12:00:00.000Z");
  assert.equal(moved.end.dateTime, "2026-09-29T13:30:00.000Z");
  assert.equal(original.start.dateTime, "2026-09-21T10:00:00Z");
});

test("all-day moves preserve day span and 0D targets today", () => {
  const original = { start: { date: "2026-09-20" }, end: { date: "2026-09-22" } };
  const moved = shiftEvent(original, { days: 0 }, new Date("2026-09-28T12:00:00"));
  assert.equal(moved.start.date, "2026-09-28");
  assert.equal(moved.end.date, "2026-09-30");
});

test("all-day date is midnight in the calendar time zone", () => {
  const event = { start: { date: "2026-09-28" } };
  assert.equal(new Date(eventStartMs(event, "America/Los_Angeles")).toISOString(), "2026-09-28T07:00:00.000Z");
});

test("dismissal union keeps newest version and prunes old events", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const start = now - 2 * 86_400_000;
  const merged = mergeDismissals(
    [{ eventId: "a", start, dismissed: now - 100 }, { eventId: "old", start: now - 366 * 86_400_000, dismissed: now }],
    [{ eventId: "a", start, dismissed: now }, { eventId: "b", start, dismissed: now }], now
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((record) => record.eventId === "a").dismissed, now);
});

test("future event dismissal survives local and Drive union", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const future = { eventId: "Test Event - 1", start: now + 4 * 3_600_000, dismissed: now };
  assert.deepEqual(mergeDismissals([future], [], now), [future]);
});

test("location becomes a safe web link or map query", () => {
  assert.equal(locationHref("https://example.com/place"), "https://example.com/place");
  assert.equal(locationHref("Meet here: https://example.com/room"), "https://example.com/room");
  assert.equal(locationHref("www.example.com/room"), "https://www.example.com/room");
  assert.match(locationHref("San Jose, CA"), /google.com\/maps\/search/);
  assert.match(locationHref("javascript:alert(1)"), /google.com\/maps\/search/);
});
