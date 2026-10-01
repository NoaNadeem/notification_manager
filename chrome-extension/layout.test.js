import test from "node:test";
import assert from "node:assert/strict";
import { flyoutAboveRowTop, flyoutPointerInReach } from "./layout.js";

const trigger = { left: 450, right: 490, top: 550, bottom: 580 };
const flyout = { left: 12, right: 508, top: 458, bottom: 550 };

test("pointer can travel from the event to its flyout above", () => {
  assert.equal(flyoutPointerInReach(470, 535, trigger, flyout), true);
  assert.equal(flyoutPointerInReach(60, 480, trigger, flyout), true);
});

test("pointer leaving the flyout and trigger closes it", () => {
  assert.equal(flyoutPointerInReach(300, 620, trigger, flyout), false);
  assert.equal(flyoutPointerInReach(540, 535, trigger, flyout), false);
  assert.equal(flyoutPointerInReach(100, 400, trigger, flyout), false);
});

test("every event places the flyout above itself, allowing the header overlap", () => {
  assert.equal(flyoutAboveRowTop(550, 92), 458);
  assert.equal(flyoutAboveRowTop(130, 92), 38);
  assert.equal(flyoutAboveRowTop(80, 92), 4);
});
