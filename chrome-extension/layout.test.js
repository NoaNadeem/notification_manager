import test from "node:test";
import assert from "node:assert/strict";
import { flyoutPointerInReach } from "./layout.js";

const trigger = { left: 450, right: 490, top: 550, bottom: 580 };
const flyout = { left: 12, right: 508, top: 590, bottom: 682 };

test("pointer can travel from the event to its inline flyout", () => {
  assert.equal(flyoutPointerInReach(470, 585, trigger, flyout), true);
  assert.equal(flyoutPointerInReach(60, 620, trigger, flyout), true);
});

test("pointer leaving the flyout and trigger closes it", () => {
  assert.equal(flyoutPointerInReach(300, 720, trigger, flyout), false);
  assert.equal(flyoutPointerInReach(540, 620, trigger, flyout), false);
  assert.equal(flyoutPointerInReach(100, 400, trigger, flyout), false);
});
