import test from "node:test";
import assert from "node:assert/strict";

const MANAGER_URL = "chrome-extension://test/window.html";
const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(initialWindows, initialStorage = {}) {
  const listeners = {};
  const windows = structuredClone(initialWindows);
  const storage = { ...initialStorage };
  const calls = { created: [], focused: [], tabsUpdated: [], tabsReloaded: [], removed: [] };
  let nextWindowId = Math.max(1, ...windows.map((window) => window.id)) + 1;
  let nextTabId = Math.max(1, ...windows.flatMap((window) => window.tabs || []).map((tab) => tab.id || 0)) + 1;
  let rejectNextTabUpdate = false;
  globalThis.chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://test/${file}`,
      onStartup: { addListener: (listener) => { listeners.startup = listener; } },
      onInstalled: { addListener: (listener) => { listeners.installed = listener; } }
    },
    action: { onClicked: { addListener: (listener) => { listeners.clicked = listener; } } },
    system: { display: { getInfo: async () => [
      { isPrimary: true, bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 25, width: 1920, height: 1055 } },
      { isPrimary: false, bounds: { left: 1920, top: 0, width: 1600, height: 900 }, workArea: { left: 1920, top: 25, width: 1600, height: 875 } }
    ] } },
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (values) => { Object.assign(storage, values); },
      remove: async (key) => { delete storage[key]; }
    } },
    tabs: { reload: async (id) => { calls.tabsReloaded.push(id); }, update: async (id, options) => {
      if (rejectNextTabUpdate) { rejectNextTabUpdate = false; throw new Error("Tab disappeared"); }
      calls.tabsUpdated.push({ id, options });
      const tab = windows.flatMap((window) => window.tabs || []).find((item) => item.id === id);
      if (tab && options.url !== undefined) tab.url = options.url;
    } },
    windows: {
      onCreated: { addListener: (listener) => { listeners.created = listener; } },
      onRemoved: { addListener: (listener) => { listeners.removed = listener; } },
      getAll: async () => structuredClone(windows),
      create: async (options) => {
        calls.created.push(options);
        const created = { id: nextWindowId++, type: options.type, width: options.width, height: options.height,
          tabs: [{ id: nextTabId++, url: options.url }] };
        windows.push(created);
        return structuredClone(created);
      },
      update: async (id, options) => { calls.focused.push({ id, options }); },
      remove: async (id) => { calls.removed.push(id); windows.splice(windows.findIndex((window) => window.id === id), 1); }
    }
  };
  await import(`./background.js?test=${Math.random()}`);
  return { listeners, windows, storage, calls, failNextTabUpdate: () => { rejectNextTabUpdate = true; } };
}

test("Chrome startup opens one dedicated manager window and toolbar reuses it", async () => {
  const state = await setup([{ id: 1, type: "normal", focused: true, left: 2100, top: 80, width: 1000, height: 800, tabs: [] }]);
  state.listeners.startup();
  state.listeners.startup();
  await nextTurn();
  assert.equal(state.calls.created.length, 1);
  assert.equal(state.calls.created[0].type, "popup");
  assert.equal(state.calls.created[0].width, 520);
  assert.equal(state.calls.created[0].left, 2460);
  assert.equal(state.calls.created[0].top, 103);
  assert.deepEqual(state.storage.managerWindow, { windowId: 2, tabId: 2 });
  state.listeners.clicked();
  await nextTurn();
  assert.deepEqual(state.calls.focused, [{ id: 2, options: { left: 2460, top: 103, focused: true } }]);
  delete globalThis.chrome;
});

test("updating the unpacked extension restores its tracked popup tab in place", async () => {
  const state = await setup([
    { id: 1, type: "normal", width: 1000, height: 800, tabs: [{ id: 10, url: "https://example.com" }] },
    { id: 2, type: "popup", width: 520, height: 720, tabs: [{ id: 20, url: "https://www.google.com/" }] }
  ], { managerWindow: { windowId: 2, tabId: 20 } });
  state.listeners.installed({ reason: "update", previousVersion: "0.3.3" });
  await nextTurn();
  assert.deepEqual(state.calls.tabsUpdated, [{ id: 20, options: { url: MANAGER_URL, active: true } }]);
  assert.equal(state.calls.created.length, 0);
  assert.equal(state.calls.removed.length, 0);
  assert.equal(state.windows[1].tabs[0].url, MANAGER_URL);
  delete globalThis.chrome;
});

test("an extension page that survived the update reloads its new code", async () => {
  const state = await setup([
    { id: 1, type: "normal", width: 1000, height: 800, tabs: [{ id: 10, url: "https://example.com" }] },
    { id: 2, type: "popup", width: 520, height: 720, tabs: [{ id: 20, url: MANAGER_URL }] }
  ], { managerWindow: { windowId: 2, tabId: 20 } });
  state.listeners.installed({ reason: "update", previousVersion: "0.3.3" });
  await nextTurn();
  assert.deepEqual(state.calls.tabsReloaded, [20]);
  assert.equal(state.calls.tabsUpdated.length, 0);
  delete globalThis.chrome;
});

test("first update can reclaim the old manager-sized Google popup", async () => {
  const state = await setup([
    { id: 1, type: "normal", width: 1000, height: 800, tabs: [{ id: 10, url: "https://example.com" }] },
    { id: 2, type: "popup", width: 520, height: 720, tabs: [{ id: 20, url: "https://www.google.com/" }] }
  ]);
  state.listeners.installed({ reason: "update", previousVersion: "0.3.3" });
  await nextTurn();
  assert.deepEqual(state.calls.tabsUpdated, [{ id: 20, options: { url: MANAGER_URL, active: true } }]);
  assert.deepEqual(state.storage.managerWindow, { windowId: 2, tabId: 20 });
  delete globalThis.chrome;
});

test("a discarded manager tab is replaced without closing regular Chrome windows", async () => {
  const state = await setup([
    { id: 1, type: "normal", width: 1000, height: 800, tabs: [{ id: 10, url: "https://example.com" }] },
    { id: 2, type: "popup", width: 520, height: 720, tabs: [{ id: 20, url: "https://www.google.com/" }] }
  ], { managerWindow: { windowId: 2, tabId: 20 } });
  state.failNextTabUpdate();
  state.listeners.installed({ reason: "update", previousVersion: "0.3.3" });
  await nextTurn();
  assert.deepEqual(state.calls.removed, [2]);
  assert.equal(state.calls.created.length, 1);
  assert.equal(state.windows[0].tabs[0].url, "https://example.com");
  assert.deepEqual(state.storage.managerWindow, { windowId: 3, tabId: 21 });
  delete globalThis.chrome;
});

test("install and Chrome updates do not reopen a manager that the user closed", async () => {
  const state = await setup([{ id: 1, type: "normal", width: 1000, height: 800, tabs: [] }]);
  state.listeners.installed({ reason: "install" });
  state.listeners.installed({ reason: "chrome_update" });
  state.listeners.installed({ reason: "update" });
  await nextTurn();
  assert.equal(state.calls.created.length, 0);
  assert.equal(state.calls.tabsUpdated.length, 0);
  delete globalThis.chrome;
});

test("toolbar activates a browser manager tab without resizing, and update reloads it", async () => {
  const state = await setup([{ id: 1, type: "normal", tabs: [{ id: 10, url: "https://example.com" }, { id: 20, url: MANAGER_URL }] }]);
  state.listeners.clicked();
  await nextTurn();
  assert.deepEqual(state.calls.tabsUpdated, [{ id: 20, options: { active: true } }]);
  assert.deepEqual(state.calls.focused, [{ id: 1, options: { focused: true } }]);
  state.listeners.installed({ reason: "update", previousVersion: "0.3.4" });
  await nextTurn();
  assert.deepEqual(state.calls.tabsReloaded, [20]);
  assert.equal(state.calls.created.length, 0);
  delete globalThis.chrome;
});
