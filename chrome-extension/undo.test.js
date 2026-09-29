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
  await controller.undo();
  assert.equal(controller.current, null);
  assert.equal(callback, null);
  assert.deepEqual(commits, []);
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
