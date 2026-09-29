import test from "node:test";
import assert from "node:assert/strict";
import { mergeDismissals } from "./model.js";
import { parseDismissalMarker, publishMissingDismissals } from "./dismissal-sync.js";

test("two clients starting from the same Drive snapshot preserve both dismissals in either write order", async () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const phone = { eventId: "Test Event - 1", start: now - 1000, dismissed: now };
  const extension = { eventId: "Test Event - 2", start: now + 1000, dismissed: now };
  for (const order of [[phone, extension], [extension, phone]]) {
    const driveMarkers = [];
    const sameInitialSnapshot = [];
    for (const record of order) {
      await publishMissingDismissals([record], sameInitialSnapshot, async (marker) => {
        driveMarkers.push(marker);
      }, now);
    }
    assert.deepEqual(new Set(mergeDismissals([], driveMarkers, now).map((record) => record.eventId)),
      new Set([phone.eventId, extension.eventId]));
  }
});

test("legacy Drive records are kept and are not uploaded again as markers", async () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const legacy = { eventId: "Test Event - 1", start: now - 1000, dismissed: now };
  const local = { eventId: "Test Event - 2", start: now - 2000, dismissed: now };
  const created = [];
  const merged = await publishMissingDismissals([legacy, local], [legacy], async (record) => created.push(record), now);
  assert.deepEqual(created, [local]);
  assert.equal(merged.length, 2);
});

test("dismissal marker description round-trips a record", () => {
  const record = { eventId: "Test Event - 1", start: 1000, dismissed: 2000 };
  assert.deepEqual(parseDismissalMarker({ id: "fixture", description: JSON.stringify({ version: 2, ...record }) }), record);
  assert.throws(() => parseDismissalMarker({ id: "fixture", description: "{}" }), /Invalid dismissal marker/);
});
