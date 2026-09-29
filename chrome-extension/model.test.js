import test from "node:test";
import assert from "node:assert/strict";
import { ageLabel, eventStartMs, shiftEvent, mergeDismissals, locationHref, isTwoDaysOld, isEmphasized, compareEvents } from "./model.js";

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

test("all-day events sort ahead of newer timed events", () => {
  const timed = { start: { dateTime: "2026-09-28T11:00:00Z" } };
  const allDay = { start: { date: "2026-09-27" } };
  assert.deepEqual([timed, allDay].sort((a, b) => compareEvents(a, b, "UTC")), [allDay, timed]);
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

test("location becomes a safe web link or map query", () => {
  assert.equal(locationHref("https://example.com/place"), "https://example.com/place");
  assert.equal(locationHref("Meet here: https://example.com/room"), "https://example.com/room");
  assert.equal(locationHref("www.example.com/room"), "https://www.example.com/room");
  assert.match(locationHref("San Jose, CA"), /google.com\/maps\/search/);
  assert.match(locationHref("javascript:alert(1)"), /google.com\/maps\/search/);
});
