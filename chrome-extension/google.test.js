import test from "node:test";
import assert from "node:assert/strict";
import { primaryCalendar, primaryEventsUrl, recentEvents, searchPrimaryCalendar, dismissedEventTitle, moveEvent } from "./google.js";

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

test("full Calendar search shows newest dates first and all-day first within a date", async () => {
  const events = [
    { id: "old", start: { dateTime: "2025-01-01T09:00:00Z" } },
    { id: "morning", start: { dateTime: "2026-11-03T09:00:00Z" } },
    { id: "all-day", start: { date: "2026-11-03" } },
    { id: "afternoon", start: { dateTime: "2026-11-03T15:00:00Z" } }
  ];
  const { events: results } = await searchPrimaryCalendar("owner@example.com", "meeting",
    async () => ({ items: events }));
  assert.deepEqual(results.map((event) => event.id), ["all-day", "afternoon", "morning", "old"]);
});


test("committed move Undo restores exact original times, preserves other fields, and refuses newer edits", async () => {
  const original = {start:{dateTime:"2026-10-30T12:00:00Z"},end:{dateTime:"2026-10-30T13:00:00Z"}};
  const moved = {id:"synthetic",summary:"Synthetic",etag:"saved-etag",location:"Keep this",start:{dateTime:"2026-10-31T12:00:00Z"},end:{dateTime:"2026-10-31T13:00:00Z"}};
  const reverse = {...original,originalStart:moved.start,originalEnd:moved.end};
  const writes=[];
  const restored=await moveEvent("fixture@example.invalid","synthetic",{},new Date(),reverse,async (_url,options)=>{
    if (!options) return moved;
    writes.push(options);return JSON.parse(options.body);
  });
  assert.deepEqual(restored.start,original.start);
  assert.deepEqual(restored.end,original.end);
  assert.equal(restored.location,"Keep this");
  assert.equal(writes[0].headers["If-Match"],"saved-etag");
  await assert.rejects(moveEvent("fixture@example.invalid","synthetic",{},new Date(),reverse,async (_url,options)=>{
    assert.equal(options,undefined);
    return {...moved,start:{dateTime:"2026-11-02T12:00:00Z"}};
  }),/changed after/);
});
