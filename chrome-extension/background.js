import { MANAGER_WIDTH as WIDTH, MANAGER_HEIGHT as HEIGHT } from "./window-size.js";

const MANAGER_URL = chrome.runtime.getURL("window.html");
const MANAGER_WINDOW_KEY = "managerWindow";
let opening = false;

function managerTab(window) {
  return window.tabs?.find((tab) => tab.url === MANAGER_URL);
}

async function rememberManager(window) {
  if (!window) return;
  const tab = managerTab(window) || window.tabs?.[0];
  if (window.id == null || tab?.id == null) return;
  await chrome.storage.local.set({ [MANAGER_WINDOW_KEY]: { windowId: window.id, tabId: tab.id } });
}

function oldManagerWindow(windows) {
  // The version before window tracking may have been replaced with Chrome's
  // default Google page during an unpacked-extension reload. Only reclaim a
  // single-tab popup with the exact dimensions of our dedicated window.
  const candidates = windows.filter((window) =>
    window.type === "popup" && window.width === 520 && window.height === HEIGHT &&
    window.tabs?.length === 1 &&
    /^https:\/\/(?:www\.)?google\.com\/?(?:\?.*)?$/.test(window.tabs[0].url || "")
  );
  return candidates.length === 1 ? candidates[0] : null;
}

async function centeredPosition(windows) {
  try {
    const displays = await chrome.system.display.getInfo();
    const normal = windows.find((window) => window.type === "normal" && window.focused)
      || windows.find((window) => window.type === "normal");
    const centerX = normal?.left + normal?.width / 2;
    const centerY = normal?.top + normal?.height / 2;
    const display = displays.find(({ bounds }) =>
      centerX >= bounds.left && centerX < bounds.left + bounds.width &&
      centerY >= bounds.top && centerY < bounds.top + bounds.height
    ) || displays.find(({ isPrimary }) => isPrimary) || displays[0];
    if (!display) return {};
    const area = display.workArea || display.bounds;
    return {
      left: Math.round(area.left + Math.max(0, area.width - WIDTH) / 2),
      top: Math.round(area.top + Math.max(0, area.height - HEIGHT) / 2)
    };
  } catch {
    return {};
  }
}

async function openManager() {
  if (opening) return;
  opening = true;
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const position = await centeredPosition(windows);
    const existing = windows.find(managerTab);
    if (existing) {
      await rememberManager(existing);
      await chrome.tabs.update(managerTab(existing).id, { active: true });
      await chrome.windows.update(existing.id, existing.type === "popup" ? {
        ...position,
        ...(existing.width === 520 && existing.height === HEIGHT ? { width: WIDTH, height: HEIGHT } : {}),
        focused: true
      } : { focused: true });
      return;
    }
    const created = await chrome.windows.create({
      url: MANAGER_URL, type: "popup", width: WIDTH, height: HEIGHT,
      ...position
    });
    await rememberManager(created);
  } finally {
    opening = false;
  }
}

async function restoreManagerAfterUpdate(allowLegacyPopup) {
  if (opening) return;
  opening = true;
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const stored = (await chrome.storage.local.get(MANAGER_WINDOW_KEY))[MANAGER_WINDOW_KEY];
    const tracked = windows.find((window) =>
      window.id === stored?.windowId && window.type === "popup" &&
      window.tabs?.length === 1 && window.tabs[0].id === stored.tabId
    );
    const existing = tracked || windows.find((window) => window.type === "popup" && managerTab(window));
    const legacy = allowLegacyPopup && !stored && !existing ? oldManagerWindow(windows) : null;
    const browserManager = windows.find((window) => window.type === "normal" && managerTab(window));
    if (browserManager) await chrome.tabs.reload(managerTab(browserManager).id);
    const target = existing || legacy;
    if (!target) return;

    let reloaded = false;
    try {
      if (target.tabs[0].url === MANAGER_URL) {
        await chrome.tabs.reload(target.tabs[0].id);
      } else {
        await chrome.tabs.update(target.tabs[0].id, { url: MANAGER_URL, active: true });
      }
      reloaded = true;
    } catch {
      // If Chrome discarded the old tab during reload, replace only the
      // dedicated single-tab popup. The normal browser windows stay intact.
      await chrome.windows.remove(target.id).catch(() => {});
      const position = await centeredPosition(windows);
      const created = await chrome.windows.create({
        url: MANAGER_URL, type: "popup", width: WIDTH, height: HEIGHT,
        ...position
      });
      await rememberManager(created);
    }
    if (reloaded) {
      await rememberManager({ ...target, tabs: [{ ...target.tabs[0], url: MANAGER_URL }] });
      await chrome.windows.update(target.id, {
        ...(target.width === 520 && target.height === HEIGHT
          ? { ...await centeredPosition(windows), width: WIDTH, height: HEIGHT } : {}),
        focused: true
      });
    }
  } finally {
    opening = false;
  }
}

// Chrome fires this once per profile start. Reopening an already running Chrome
// profile is handled by the first normal window after all normal windows close.
chrome.runtime.onStartup.addListener(() => { void openManager(); });
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update") void restoreManagerAfterUpdate(details.previousVersion === "0.3.3");
});
chrome.action.onClicked.addListener(() => { void openManager(); });

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const stored = (await chrome.storage.local.get(MANAGER_WINDOW_KEY))[MANAGER_WINDOW_KEY];
    if (stored?.windowId === windowId) await chrome.storage.local.remove(MANAGER_WINDOW_KEY);
  })();
});

chrome.windows.onCreated.addListener((window) => {
  if (window.type !== "normal") return;
  void (async () => {
    const windows = await chrome.windows.getAll();
    if (windows.filter((item) => item.type === "normal").length === 1) {
      await openManager();
    }
  })();
});
