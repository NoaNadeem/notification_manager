import test from "node:test";
import assert from "node:assert/strict";
import { syncHeadline, syncDetail, shouldShowSyncStatus, persistSyncState } from "./sync-state.js";

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

test("sync-status storage failure remains diagnostic and a later write clears it", async () => {
  const saved = [];
  let fail = true;
  const storage = { async set(value) {
    if (fail) throw new Error("Storage temporarily unavailable");
    saved.push(value);
  } };
  const state = { calendarAt: 42, pending: [], history: ["legacy"] };
  assert.equal(await persistSyncState(storage, "Me@Example.com", state), "Storage temporarily unavailable");
  fail = false;
  assert.equal(await persistSyncState(storage, "Me@Example.com", state), null);
  assert.deepEqual(saved, [{ "syncState:me@example.com": { calendarAt: 42, pending: [] } }]);
  assert.deepEqual(state.history, ["legacy"]);
});


test("a Tasks authorization failure survives successful Drive status updates", () => {
  const now=Date.now();
  const state={calendarAt:now,dismissalAt:now,error:null,tasksError:"Tasks access required",pending:[]};
  const driveSucceeded={...state,error:null,dismissalAt:now+1};
  assert.equal(syncHeadline(driveSucceeded,now+1),"Sync needs attention");
  assert.match(syncDetail(driveSucceeded),/Tasks error: Tasks access required/);
  assert.equal(syncHeadline({...driveSucceeded,tasksError:null},now+1),"Synced just now");
});

test('header describes only the newest action across rapid saves and ignores older completions', async () => {
  const {latestSavingStatus} = await import('./sync-state.js');
  const first={id:'first',type:'dismiss',stagedAtMs:1};
  const newest={id:'last',type:'move',stagedAtMs:10,destinationStart:{date:'2026-11-23'}};
  const middle=Array.from({length:8},(_,i)=>({id:`queued-${i}`,type:'dismiss',stagedAtMs:i+2}));
  assert.equal(latestSavingStatus([first],first),'Dismissing…');
  assert.equal(latestSavingStatus([first,...middle,newest],newest),'Moving to Monday 23 Nov 2026…');
  assert.equal(latestSavingStatus([...middle,newest],newest),'Moving to Monday 23 Nov 2026…');
  assert.equal(latestSavingStatus([first,...middle],newest),'');
  assert.equal(latestSavingStatus([],newest),'');
  // A newer unsaved record after reopening outranks the previously retained Undo.
  assert.equal(latestSavingStatus([newest],first),'Moving to Monday 23 Nov 2026…');
  assert.equal(latestSavingStatus([{...newest,id:'later',type:'dismiss'}],{...newest,id:'later',type:'dismiss'}),'Dismissing…');
});
