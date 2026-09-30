import test from "node:test";
import assert from "node:assert/strict";
import { syncHeadline, syncDetail, shouldShowSyncStatus } from "./sync-state.js";

test("successful, pending, stale, and failed synchronization remain distinguishable", () => {
  const now = 1_000_000_000;
  const fresh = { calendarAt: now, dismissalAt: now, pending: [], error: null };
  assert.equal(syncHeadline(fresh, now), "Synced just now");
  assert.equal(syncHeadline({ ...fresh, pending: ["event/1"] }, now), "Local changes waiting to sync");
  assert.equal(syncHeadline({ ...fresh, error: "Drive unavailable" }, now), "Sync needs attention");
  assert.equal(syncHeadline(fresh, now + 3_600_001), "Sync needs attention");
  assert.match(syncDetail({ ...fresh, remoteNewer: true, conflictResolved: true }, now), /Yes, merged/);
});

test("startup status waits for a completed refresh", () => {
  assert.equal(shouldShowSyncStatus(false, false, false, "owner@example.com"), false);
  assert.equal(shouldShowSyncStatus(true, true, false, "owner@example.com"), false);
  assert.equal(shouldShowSyncStatus(true, false, false, "owner@example.com"), true);
  assert.equal(shouldShowSyncStatus(true, false, true, "owner@example.com"), false);
});
