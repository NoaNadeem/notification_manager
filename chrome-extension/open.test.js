import test from "node:test";
import assert from "node:assert/strict";
import { createOpenGuard, openInBrowser } from "./open.js";

test("repeated event clicks open once until the cooldown ends", async () => {
  let now = 0;
  const opened = [];
  const guarded = createOpenGuard(async (url) => { opened.push(url); }, 8_000, () => now);
  assert.equal(await guarded("https://calendar.google.com/event/1"), true);
  now = 7_999;
  assert.equal(await guarded("https://calendar.google.com/event/1"), false);
  assert.equal(opened.length, 1);
  now = 8_000;
  assert.equal(await guarded("https://calendar.google.com/event/1"), true);
  assert.equal(opened.length, 2);
});

test("event click guard blocks while opening and retries after an error", async () => {
  let rejectOpen;
  const guarded = createOpenGuard(() => new Promise((_, reject) => { rejectOpen = reject; }));
  const first = guarded("https://calendar.google.com/event/1");
  assert.equal(await guarded("https://calendar.google.com/event/1"), false);
  rejectOpen(new Error("Temporary error"));
  await assert.rejects(first, /Temporary error/);
  const next = guarded("https://calendar.google.com/event/1");
  rejectOpen(new Error("Temporary error"));
  await assert.rejects(next, /Temporary error/);
});

test("opening an event activates its tab and focuses a normal Chrome window", async () => {
  const calls = [];
  const api = {
    windows: {
      getLastFocused: async (options) => { calls.push(["last", options]); return { id: 12, type: "normal", incognito: false }; },
      update: async (id, options) => { calls.push(["focus", id, options]); }
    },
    tabs: { create: async (options) => { calls.push(["tab", options]); } }
  };
  await openInBrowser(api, "https://calendar.google.com/event");
  assert.deepEqual(calls, [
    ["last", { windowTypes: ["normal"] }],
    ["tab", { windowId: 12, url: "https://calendar.google.com/event", active: true }],
    ["focus", 12, { focused: true }]
  ]);
});

test("opening an event creates a focused browser window when only the manager popup exists", async () => {
  const calls = [];
  const api = {
    windows: {
      getLastFocused: async () => ({ id: 3, type: "popup" }),
      getAll: async () => [],
      create: async (options) => { calls.push(options); }
    },
    tabs: { create: async () => { throw new Error("Unexpected tab"); } }
  };
  await openInBrowser(api, "https://calendar.google.com/event");
  assert.deepEqual(calls, [{ url: "https://calendar.google.com/event", type: "normal", focused: true, incognito: false }]);
});

test("opening an event skips the last focused Incognito window", async () => {
  const calls = [];
  const api = {
    windows: {
      getLastFocused: async () => ({ id: 7, type: "normal", incognito: true }),
      getAll: async () => [
        { id: 7, type: "normal", incognito: true, focused: true },
        { id: 12, type: "normal", incognito: false, focused: false }
      ],
      update: async (id, options) => { calls.push(["focus", id, options]); }
    },
    tabs: { create: async (options) => { calls.push(["tab", options]); } }
  };
  await openInBrowser(api, "https://calendar.google.com/event");
  assert.deepEqual(calls, [
    ["tab", { windowId: 12, url: "https://calendar.google.com/event", active: true }],
    ["focus", 12, { focused: true }]
  ]);
});

test("opening an event makes a regular window if only Incognito windows exist", async () => {
  const calls = [];
  const api = {
    windows: {
      getLastFocused: async () => ({ id: 7, type: "normal", incognito: true }),
      getAll: async () => [{ id: 7, type: "normal", incognito: true }],
      create: async (options) => { calls.push(options); }
    },
    tabs: { create: async () => { throw new Error("Unexpected tab"); } }
  };
  await openInBrowser(api, "https://calendar.google.com/event");
  assert.deepEqual(calls, [{ url: "https://calendar.google.com/event", type: "normal", focused: true, incognito: false }]);
});
