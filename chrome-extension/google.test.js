import test from "node:test";
import assert from "node:assert/strict";
import { primaryCalendar, primaryEventsUrl, recentEvents, searchPrimaryCalendar, dismissedEventTitle } from "./google.js";

test("event requests target only the authenticated primary calendar ID", () => {
  const primary = primaryEventsUrl("owner@example.com");
  assert.equal(primary.pathname, "/calendar/v3/calendars/owner%40example.com/events");
  assert.equal(primary.search, "");
  assert.notEqual(primaryEventsUrl("shared@example.com").pathname, primary.pathname);
  assert.throws(() => primaryEventsUrl(""), /Primary Calendar ID/);
});

test("older dismissal title lookup reads only the primary event", async () => {
  const calls = [];
  const title = await dismissedEventTitle("owner@example.com", "recurring_20260928", async (url, options) => {
    calls.push({ url, options });
    return { summary: "Test Event - 1" };
  });
  assert.equal(title, "Test Event - 1");
  assert.deepEqual(calls, [{
    url: "https://www.googleapis.com/calendar/v3/calendars/owner%40example.com/events/recurring_20260928",
    options: undefined
  }]);
});

test("authenticated user with shared calendars reads and searches only the primary calendar", async () => {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    if (url.endsWith("/calendars/primary")) {
      return { id: "owner@example.com", timeZone: "UTC", visibleCalendars: ["owner@example.com", "shared@example.com"] };
    }
    if (new URL(url).pathname === "/calendar/v3/calendars/owner%40example.com/events") {
      return { items: [{ id: "owned", start: { dateTime: "2026-09-28T12:00:00Z" } }] };
    }
    throw new Error(`Unexpected calendar request: ${url}`);
  };
  const primary = await primaryCalendar(false, request);
  const recent = await recentEvents(primary.id, 7, 0, null, request);
  const search = await searchPrimaryCalendar(primary.id, "owned", request);
  assert.deepEqual(recent.events.map((event) => event.id), ["owned"]);
  assert.deepEqual(search.events.map((event) => event.id), ["owned"]);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => !url.includes("shared%40example.com") && !url.includes("calendarList")));
});
