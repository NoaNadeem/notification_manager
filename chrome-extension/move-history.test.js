import test from "node:test";
import assert from "node:assert/strict";
import { recentMoves, parseMoveMarker } from "./move-history.js";

const now = Date.parse("2026-09-30T18:00:00Z");
const record = (id, moved = now) => ({ id, eventId: `event-${id}`, title: `Test Event - ${id}`,
  from: now - 3_600_000, to: now + 3_600_000, moved });

test("move history keeps ten newest records and drops entries older than thirty days", () => {
  const records = [...Array.from({ length: 12 }, (_, index) => record(`${index + 1}`, now + index + 1)),
    record("expired", now - 31 * 86_400_000)];
  assert.deepEqual(recentMoves(records, [], now).map((item) => item.id),
    Array.from({ length: 10 }, (_, index) => `${12 - index}`));
});

test("independent phone and extension move markers preserve their union in either order", () => {
  const phone = record("phone");
  const extension = record("extension");
  for (const order of [[phone, extension], [extension, phone]]) {
    const sameInitialDriveSnapshot = [];
    const driveMarkers = order.map((local) => recentMoves([local], sameInitialDriveSnapshot, now)[0]);
    assert.deepEqual(new Set(recentMoves([], driveMarkers, now).map((item) => item.id)),
      new Set(["phone", "extension"]));
  }
});

test("move marker parsing and retry deduplication preserve compact metadata", () => {
  const move = record("same");
  assert.deepEqual(parseMoveMarker({ id: "fixture", description: JSON.stringify({ version: 1, ...move }) }), move);
  assert.deepEqual(recentMoves([move], [move], now), [move]);
  assert.throws(() => parseMoveMarker({ id: "fixture", description: "{}" }), /Invalid move marker/);
});
