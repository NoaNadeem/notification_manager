import test from "node:test";
import assert from "node:assert/strict";
import { updateHistory, syncHeadline, syncDetail } from "./sync-state.js";

test("offline, pending, stale, and failed synchronization remain distinguishable", () => {
  const now = 1_000_000_000;
  const fresh = { calendarAt: now, dismissalAt: now, pending: [], error: null };
  assert.equal(syncHeadline(fresh, true, now), "Synced just now");
  assert.equal(syncHeadline(fresh, false, now), "Offline — changes saved on this device");
  assert.equal(syncHeadline({ ...fresh, pending: ["event/1"] }, true, now), "Local changes waiting to sync");
  assert.equal(syncHeadline({ ...fresh, error: "Drive unavailable" }, true, now), "Sync needs attention");
  assert.equal(syncHeadline(fresh, true, now + 3_600_001), "Sync needs attention");
  assert.match(syncDetail({ ...fresh, remoteNewer: true, conflictResolved: true, history: [] }, now), /Yes, merged/);
});

test("local history keeps three days and caps heavy usage", () => {
  const now = 40 * 86_400_000;
  const old = { at: now - 4 * 86_400_000 };
  const withinWindow = { at: now - 2 * 86_400_000, status: "synced" };
  const recent = { at: now, status: "undone" };
  assert.deepEqual(updateHistory([old, withinWindow], recent, now), [withinWindow, recent]);
  assert.equal(updateHistory(Array.from({ length: 500 }, (_, id) => ({ at: now, id })), recent, now).length, 500);
});
