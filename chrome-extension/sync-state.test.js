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

test("local history keeps only thirty days", () => {
  const now = 40 * 86_400_000;
  const old = { at: now - 31 * 86_400_000 };
  const recent = { at: now, status: "undone" };
  assert.deepEqual(updateHistory([old], recent, now), [recent]);
});
