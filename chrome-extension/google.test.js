import test from "node:test";
import assert from "node:assert/strict";
import { primaryEventsUrl } from "./google.js";

test("event requests target only the authenticated primary calendar ID", () => {
  const primary = primaryEventsUrl("owner@example.com");
  assert.equal(primary.pathname, "/calendar/v3/calendars/owner%40example.com/events");
  assert.equal(primary.search, "");
  assert.notEqual(primaryEventsUrl("shared@example.com").pathname, primary.pathname);
  assert.throws(() => primaryEventsUrl(""), /Primary Calendar ID/);
});
