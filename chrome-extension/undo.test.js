import test from "node:test";
import assert from "node:assert/strict";
import { UndoController, UNDO_MS, actionDescription } from "./undo.js";

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
  assert.deepEqual(commits, ["move"]);
  await callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(commits, ["move", "dismiss"]);
  assert.equal(controller.current, null);
});

test("action descriptions match Android wording", () => {
  assert.equal(actionDescription({ type: "dismiss" }), "Dismissed");
  assert.equal(actionDescription({ type: "move", option: { days: 0 } }), "Moved to today");
  assert.equal(actionDescription({ type: "move", option: { days: 3 } }), "Moved 3 days later");
  assert.equal(actionDescription({ type: "move", option: { hours: 1 } }), "Moved 1 hour later");
});

test("rapid actions serialize their commits", async () => {
  const commits = [];
  let releaseFirst;
  const firstCommitted = new Promise((resolve) => { releaseFirst = resolve; });
  const controller = new UndoController(async (action) => {
    commits.push(action.type);
    if (action.type === "first") await firstCommitted;
  }, () => {}, () => 1, () => {});
  await controller.stage({ type: "first" });
  const second = controller.stage({ type: "second" });
  const third = controller.stage({ type: "third" });
  releaseFirst();
  await Promise.all([second, third]);
  assert.deepEqual(commits, ["first", "second"]);
  assert.equal(controller.current.type, "third");
});
