import test from "node:test";
import assert from "node:assert/strict";
import { openInBrowser } from "./open.js";

test("opening an event activates its tab and focuses a normal Chrome window", async () => {
  const calls = [];
  const api = {
    windows: {
      getLastFocused: async (options) => { calls.push(["last", options]); return { id: 12, type: "normal" }; },
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
  assert.deepEqual(calls, [{ url: "https://calendar.google.com/event", type: "normal", focused: true }]);
});
