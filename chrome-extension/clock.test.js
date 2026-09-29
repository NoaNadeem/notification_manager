import test from "node:test";
import assert from "node:assert/strict";
import { headerClockLabel, moveTooltip } from "./clock.js";

process.env.TZ = "America/Los_Angeles";

test("header uses daylight time in September and standard time in January", () => {
  assert.equal(headerClockLabel(new Date("2026-09-28T14:01:00Z"), "America/Los_Angeles"),
    "Mon Sept 28th, 7:01 a.m. PDT (Pacific Daylight Time)");
  assert.equal(headerClockLabel(new Date("2026-01-28T15:01:00Z"), "America/Los_Angeles"),
    "Wed Jan 28th, 7:01 a.m. PST (Pacific Standard Time)");
});

test("day move tooltip has destination date; hour move includes time zone", () => {
  const event = { start: { dateTime: "2026-09-21T10:00:00Z" }, end: { dateTime: "2026-09-21T11:00:00Z" } };
  const now = new Date("2026-09-28T14:01:00Z");
  assert.equal(moveTooltip(event, { days: 3 }, now, "America/Los_Angeles"), "Move to Thu Oct 1st");
  assert.equal(moveTooltip(event, { hours: 4 }, now, "America/Los_Angeles"),
    "Move to Mon Sept 28th, 11:01 a.m. PDT (Pacific Daylight Time)");
});

test("all-day zero-day tooltip points to today", () => {
  const event = { start: { date: "2026-09-21" }, end: { date: "2026-09-22" } };
  assert.equal(moveTooltip(event, { days: 0 }, new Date("2026-09-28T14:01:00Z"), "America/Los_Angeles"),
    "Move to Mon Sept 28th");
});
