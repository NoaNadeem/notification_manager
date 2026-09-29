import test from "node:test";
import assert from "node:assert/strict";

test("Chrome startup opens one dedicated manager window and toolbar reuses it", async () => {
  const listeners = {};
  let windows = [{ id: 1, type: "normal", focused: true, left: 2100, top: 80, width: 1000, height: 800, tabs: [] }];
  const created = [];
  const focused = [];
  globalThis.chrome = {
    runtime: { getURL: (file) => `chrome-extension://test/${file}`, onStartup: { addListener: (listener) => { listeners.startup = listener; } } },
    action: { onClicked: { addListener: (listener) => { listeners.clicked = listener; } } },
    system: { display: { getInfo: async () => [
      { isPrimary: true, bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 25, width: 1920, height: 1055 } },
      { isPrimary: false, bounds: { left: 1920, top: 0, width: 1600, height: 900 }, workArea: { left: 1920, top: 25, width: 1600, height: 875 } }
    ] } },
    windows: {
      onCreated: { addListener: (listener) => { listeners.created = listener; } },
      getAll: async () => windows,
      create: async (options) => {
        created.push(options);
        windows = [...windows, { id: 2, type: "popup", tabs: [{ url: options.url }] }];
      },
      update: async (id, options) => { focused.push({ id, options }); }
    }
  };
  await import("./background.js");
  listeners.startup();
  listeners.startup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(created.length, 1);
  assert.equal(created[0].type, "popup");
  assert.equal(created[0].width, 520);
  assert.equal(created[0].left, 2460);
  assert.equal(created[0].top, 103);
  listeners.clicked();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(focused, [{ id: 2, options: { left: 2460, top: 103, focused: true } }]);
  delete globalThis.chrome;
});
