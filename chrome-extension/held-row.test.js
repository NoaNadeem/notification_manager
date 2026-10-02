import test from "node:test";
import assert from "node:assert/strict";
import { withHeldEvent } from "./held-row.js";

test("completed action keeps its original row until the hold clears", () => {
  const first = { id: "first" };
  const held = { id: "held", start: "old" };
  const moved = { id: "held", start: "new" };
  const last = { id: "last" };
  assert.deepEqual(withHeldEvent([first, last], held, 1), [first, held, last]);
  assert.deepEqual(withHeldEvent([first, moved, last], held, 1), [first, held, last]);
  assert.deepEqual(withHeldEvent([first, moved, last], null, 1), [first, moved, last]);
});
