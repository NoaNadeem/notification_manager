import test from "node:test";
import assert from "node:assert/strict";
import { flyoutPlacement } from "./layout.js";

test("last event opens ribbon above the row", () => {
  assert.equal(flyoutPlacement(590, 640, 100, 100, 650), "above");
});

test("middle event keeps ribbon below the row", () => {
  assert.equal(flyoutPlacement(250, 300, 100, 100, 650), "below");
});

test("short viewport scrolls when neither direction has room", () => {
  assert.equal(flyoutPlacement(160, 210, 100, 100, 240), "scroll");
});
