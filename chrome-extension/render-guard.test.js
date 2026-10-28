import test from "node:test";
import assert from "node:assert/strict";
import { InteractionRenderGuard } from "./render-guard.js";
import { UndoController } from "./undo.js";

function fixture(render) {
  const timers = new Map();
  let id = 0;
  const guard = new InteractionRenderGuard(render, (fn) => { timers.set(++id, fn); return id; }, (key) => timers.delete(key));
  return { guard, flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach((fn) => fn()); } };
}

test("async repaint cannot remove a 1D button between press, release and click", async () => {
  let generation = 0;
  let clicked = false;
  const { guard, flush } = fixture(() => { generation++; });
  guard.begin(7);
  const pressedButtonGeneration = generation;
  await Promise.resolve().then(() => guard.request()); // prior network completion
  assert.equal(generation, pressedButtonGeneration);
  guard.end(7);
  guard.request(); // state change in a pointerup handler
  await Promise.resolve();
  assert.equal(generation, pressedButtonGeneration, "pointerup must not remove the button before click");
  clicked = generation === pressedButtonGeneration;
  guard.request(); // new action stages during the delivered click
  assert.equal(clicked, true);
  flush();
  assert.equal(generation, 1, "one latest-state repaint after the click");
});

test("a second press before a scheduled repaint protects the next button too", () => {
  let renders = 0;
  const { guard, flush } = fixture(() => renders++);
  guard.begin(1); guard.request(); guard.end(1);
  guard.begin(2); flush();
  assert.equal(renders, 0);
  guard.end(2); flush();
  assert.equal(renders, 1);
});

test("unrelated pointer release cannot unblock a held event button", () => {
  let renders = 0;
  const { guard, flush } = fixture(() => renders++);
  guard.begin(1); guard.begin(2); guard.request();
  guard.end(99); guard.end(1); flush();
  assert.equal(renders, 0);
  guard.end(2); flush();
  assert.equal(renders, 1);
});

test("cancel or blur releases a pending repaint without inventing an action", () => {
  let renders = 0;
  const { guard, flush } = fixture(() => renders++);
  guard.begin(1); guard.request(); guard.release(); flush();
  assert.equal(renders, 1);
  guard.request();
  assert.equal(renders, 2);
});

test("ten rapid 1D actions survive slow mocked commits and each commits once", async () => {
  const committed = [];
  const gates = [];
  const pending = [];
  let generation = 0;
  const { guard, flush } = fixture(() => generation++);
  const controller = new UndoController(async (action) => {
    committed.push(action.event.id);
    await new Promise((resolve) => gates.push(resolve));
    guard.request();
  }, () => guard.request(), () => 1, () => {});
  for (let index = 0; index < 10; index++) {
    guard.begin(index);
    const pressedGeneration = generation;
    guard.request(); // completion while this target is being pressed
    await Promise.resolve();
    guard.end(index);
    assert.equal(generation, pressedGeneration, `event ${index} button stays connected`);
    pending.push(controller.stage({ event: { id: `fixture-${index}` }, type: "move", option: { days: 1 } }));
    await Promise.resolve();
    flush();
  }
  const commitLast = controller.commit();
  for (let index = 0; index < 10; index++) {
    while (!gates.length) await new Promise((resolve) => setImmediate(resolve));
    gates.shift()();
  }
  await Promise.all([...pending, commitLast]);
  assert.deepEqual(committed, Array.from({ length: 10 }, (_,index) => `fixture-${index}`));
  assert.equal(controller.current, null);
});
