import test from "node:test";
import assert from "node:assert/strict";
import { flyoutScrollDelta } from "./layout.js";

test("flyout stays at row level and scrolls the last row into view", () => {
  assert.equal(flyoutScrollDelta(590, 100, 650), 48);
});

test("middle event does not need extra scroll", () => {
  assert.equal(flyoutScrollDelta(250, 100, 650), 0);
});

test("short viewport uses a fixed row anchor", () => {
  assert.equal(flyoutScrollDelta(160, 100, 240), 28);
});
