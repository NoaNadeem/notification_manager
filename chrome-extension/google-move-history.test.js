import test from "node:test";
import assert from "node:assert/strict";
import { saveRecentMove, syncRecentMoves } from "./google.js";

test("successful move history publishes one marker, reloads it, and limits Drive listing to move names", async () => {
  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const values = new Map();
  const files = [];
  const listQueries = [];
  globalThis.chrome = {
    identity: { getAuthToken: async () => ({ token: "fixture-token" }) },
    storage: { local: {
      get: async (key) => ({ [key]: values.get(key) }),
      set: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); }
    } }
  };
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method === "POST") {
      const marker = JSON.parse(options.body);
      files.push({ id: `file-${files.length + 1}`, name: marker.name, description: marker.description });
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: files.at(-1).id }) };
    }
    if (options.method === "DELETE") {
      files.splice(files.findIndex((file) => file.id === parsed.pathname.split("/").at(-1)), 1);
      return { ok: true, status: 204, text: async () => "" };
    }
    listQueries.push(parsed.searchParams.get("q"));
    return { ok: true, status: 200, text: async () => JSON.stringify({ files }) };
  };
  try {
    const now = Date.now();
    const record = { id: "fixture-id", eventId: "Test Event - 1", title: "Test Event - 1",
      from: now - 3_600_000, to: now + 3_600_000, moved: now };
    assert.deepEqual(await saveRecentMove("owner@example.com", record), [record]);
    assert.equal(files.length, 1);
    values.delete("moves:owner@example.com");
    assert.deepEqual(await syncRecentMoves("owner@example.com"), [record]);
    assert.equal(files.length, 1);
    for (let index = 1; index <= 12; index++) {
      const next = { ...record, id: `fixture-${index}`, moved: now + index };
      files.push({ id: `file-${index + 1}`, name: `notification-manager-move-v1-${next.id}.json`,
        description: JSON.stringify({ version: 1, ...next }) });
    }
    values.delete("moves:owner@example.com");
    const latest = await syncRecentMoves("owner@example.com");
    assert.equal(latest.length, 10);
    assert.equal(files.length, 10);
    assert.deepEqual(new Set(files.map((file) => JSON.parse(file.description).id)),
      new Set(Array.from({ length: 10 }, (_, index) => `fixture-${index + 3}`)));
    assert.ok(listQueries.every((query) => query.includes("name contains 'notification-manager-move-v1-'")));
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.fetch = previousFetch;
  }
});
