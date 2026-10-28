import test from "node:test";
import assert from "node:assert/strict";
import { UndoController, UNDO_MS, actionDescription, parseUndoSeconds } from "./undo.js";

test("Undo cancels a pending move without committing it", async () => {
  const commits = [];
  let callback;
  const controller = new UndoController((action) => commits.push(action), () => {}, (fn, ms) => {
    assert.equal(ms, UNDO_MS);
    callback = fn;
    return 1;
  }, () => { callback = null; });
  await controller.stage({ type: "move", option: { days: 1 } });
  assert.equal(controller.state.kind, "Pending");
  await controller.undo();
  assert.equal(controller.state.kind, "Idle");
  assert.equal(controller.current, null);
  assert.equal(callback, null);
  assert.deepEqual(commits, []);
});

test("undo lifecycle records committing and failed states without leaving a stale Undo action", async () => {
  const states = [];
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const controller = new UndoController(async () => {
    states.push(controller.state.kind);
    await wait;
    return false;
  }, () => {}, () => 1, () => {});
  await controller.stage({ type: "move", option: { days: 1 } });
  const commit = controller.commit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(states, ["Committing"]);
  assert.equal(controller.current, null);
  release();
  await commit;
  assert.equal(controller.state.kind, "Failed");
  await controller.stage({ type: "dismiss" });
  assert.equal(controller.state.kind, "Pending");
});

test("browser timer methods keep their global receiver", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let scheduled;
  let canceled;
  globalThis.setTimeout = function (callback, delay) {
    assert.equal(this, globalThis);
    assert.equal(delay, UNDO_MS);
    scheduled = callback;
    return 7;
  };
  globalThis.clearTimeout = function (id) {
    assert.equal(this, globalThis);
    canceled = id;
  };
  try {
    const controller = new UndoController(() => assert.fail("Must not commit"), () => {});
    await controller.stage({ type: "dismiss" });
    assert.equal(typeof scheduled, "function");
    await controller.undo();
    assert.equal(canceled, 7);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("failed timer setup never shows a pending action", async () => {
  const changes = [];
  const controller = new UndoController(() => {}, (action) => changes.push(action), () => {
    throw new TypeError("Illegal invocation");
  });
  await assert.rejects(controller.stage({ type: "dismiss" }), /Illegal invocation/);
  assert.equal(controller.current, null);
  assert.deepEqual(changes, []);
});

test("another action commits the first and timer commits the second", async () => {
  const commits = [];
  let callback;
  const controller = new UndoController((action) => commits.push(action.type), () => {}, (fn) => {
    callback = fn;
    return 1;
  }, () => {});
  await controller.stage({ type: "move", option: { hours: 4 } });
  await controller.stage({ type: "dismiss" });
  assert.equal(controller.current.type, "dismiss");
  await controller.queue;
  assert.deepEqual(commits, ["move"]);
  await callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(commits, ["move", "dismiss"]);
  assert.equal(controller.current, null);
});

test("action descriptions match Android wording", () => {
  assert.equal(actionDescription({ type: "dismiss" }), "Dismissed");
  assert.equal(actionDescription({ type: "move", option: { days: 0 }, destinationStart: { date: "2026-11-01" } }),
    "Moved to today, Sunday 1st Nov 2026");
  assert.equal(actionDescription({ type: "move", option: { days: 2 }, destinationStart: { date: "2026-11-03" } }),
    "Moved 2 days later, to Tuesday 3rd Nov 2026");
  assert.equal(actionDescription({ type: "move", option: { hours: 1 }, destinationStart: { date: "2026-11-03" } }),
    "Moved 1 hour later, to Tuesday 3rd Nov 2026");
  assert.equal(actionDescription({ type: "move", option: { date: "2026-10-05", time: "09:00" } }),
    "Moved to Monday 5th Oct 2026, 9:00 AM");
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function mockUndo(save = async () => {}, persist = async () => {}) {
  return new UndoController(save, () => {}, () => 1, () => {}, () => {}, persist);
}

test("ten clicks immediately show the newest Undo while prior saves persist and run serially", async () => {
  const gates = [], committed = [], persisted = [];
  let active = 0, maxActive = 0;
  const undo = mockUndo(async action => {
    committed.push(action.id);
    maxActive = Math.max(maxActive, ++active);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    active--;
  }, async action => persisted.push(action.id));
  for (let i = 0; i < 10; i++) {
    const action = { id: `fixture-${i}`, type: "move", option: { days: 1 } };
    void undo.stage(action);
    assert.equal(undo.current, action, `click ${i + 1} owns Undo immediately`);
  }
  await Promise.resolve();
  assert.equal(persisted.length, 9);
  assert.equal(undo.committingActions.size, 9);
  const saving = undo.commit();
  for (let i = 0; i < 10; i++) {
    while (!gates.length) await new Promise(resolve => setImmediate(resolve));
    gates.shift().resolve();
  }
  await saving;
  assert.deepEqual(committed, Array.from({ length: 10 }, (_, i) => `fixture-${i}`));
  assert.equal(maxActive, 1);
  assert.equal(undo.committingActions.size, 0);
});

test("Undo cancels only the newest action without waiting for older saves", async () => {
  const gate = deferred(), committed = [];
  const undo = mockUndo(async action => { committed.push(action.id); await gate.promise; });
  await undo.stage({ id: "first" });
  await undo.stage({ id: "last" });
  await undo.undo();
  assert.equal(undo.current, null);
  gate.resolve();
  await undo.queue;
  assert.deepEqual(committed, ["first"]);
});

test("a failed save preserves the newest Undo and does not block later saves", async () => {
  const gate = deferred(), committed = [];
  const undo = mockUndo(async action => {
    committed.push(action.id);
    if (action.id === "first") { await gate.promise; throw Error("Offline"); }
  });
  await undo.stage({ id: "first" });
  const newest = { id: "last" };
  await undo.stage(newest);
  gate.resolve();
  await undo.queue;
  assert.equal(undo.current, newest);
  await undo.commit();
  assert.deepEqual(committed, ["first", "last"]);
});

test("storage failure prevents a network write but keeps the newest Undo", async () => {
  let writes = 0;
  const undo = mockUndo(async () => writes++, async () => { throw Error("Storage full"); });
  await undo.stage({ id: "first" });
  const newest = { id: "last" };
  await undo.stage(newest);
  await undo.queue;
  assert.equal(writes, 0);
  assert.equal(undo.current, newest);
  await undo.undo();
});

test("a canceled older timer cannot commit the newest Undo early", async () => {
  const timers = [], committed = [];
  const undo = new UndoController(async action => committed.push(action.id), () => {}, callback => {
    timers.push(callback); return timers.length;
  }, () => {});
  await undo.stage({ id: "first" });
  const newest = { id: "last" };
  await undo.stage(newest);
  timers[0]();
  await undo.queue;
  assert.equal(undo.current, newest);
  assert.deepEqual(committed, ["first"]);
  await undo.undo();
});


test("Undo Time accepts only whole seconds from 1 through 30", () => {
  for (const value of [1, 5, 30, " 12 "]) assert.equal(parseUndoSeconds(value), Number(value));
  for (const value of [0, 31, -1, 1.5, "", "1e1", "5.5", null, "bad"]) assert.equal(parseUndoSeconds(value), null);
});

test("Undo defaults to five seconds and snapshots each new action's chosen delay", async () => {
  const delays = [];
  const undo = new UndoController(async () => {}, () => {}, (_, ms) => { delays.push(ms); return delays.length; }, () => {});
  await undo.stage({ id: "first" });
  undo.undoSeconds = 30;
  assert.deepEqual(delays, [5_000]);
  await undo.stage({ id: "second" });
  undo.undoSeconds = 1;
  await undo.stage({ id: "third" });
  assert.deepEqual(delays, [5_000, 30_000, 1_000]);
  await undo.undo();
  await undo.queue;
});
