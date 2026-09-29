import test from "node:test";
import assert from "node:assert/strict";
import { PullRefreshGesture } from "./pull-refresh.js";

test("pointer pull refreshes only after release beyond threshold at the top", () => {
  let refreshes = 0;
  const gesture = new PullRefreshGesture(() => {}, () => { refreshes++; });
  gesture.start(1, 100, false);
  assert.equal(gesture.end(1, true), false);
  gesture.start(1, 100, true);
  assert.equal(gesture.move(1, 150, true), 50);
  assert.equal(gesture.end(1, true), false);
  gesture.start(1, 100, true);
  assert.equal(gesture.move(1, 175, true), 75);
  assert.equal(gesture.end(1, true), true);
  assert.equal(refreshes, 1);
});

test("wheel overscroll refreshes once per pull and resets for the next pull", () => {
  let refreshes = 0;
  let now = 1_000;
  const gesture = new PullRefreshGesture(() => {}, () => { refreshes++; }, () => now);
  assert.equal(gesture.wheel(-35, true), false);
  now += 50;
  assert.equal(gesture.wheel(-40, true), true);
  assert.equal(gesture.wheel(-80, true), false);
  assert.equal(refreshes, 1);
  gesture.wheel(10, true);
  assert.equal(gesture.wheel(-70, true), true);
  assert.equal(refreshes, 2);
});

test("an incomplete wheel pull clears its hint when it stops", () => {
  const progress = [];
  const gesture = new PullRefreshGesture((distance) => progress.push(distance), () => {});
  gesture.wheel(-20, true);
  gesture.cancelWheel();
  assert.deepEqual(progress.slice(-2), [20, 0]);
});

test("pull cancels if the list scrolls away from the top", () => {
  let refreshes = 0;
  const gesture = new PullRefreshGesture(() => {}, () => { refreshes++; });
  gesture.start(1, 100, true);
  gesture.move(1, 190, false);
  assert.equal(gesture.end(1, true), false);
  assert.equal(refreshes, 0);
});
