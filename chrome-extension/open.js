export async function managerWindowMode(api) {
  const tab = await api.tabs.getCurrent();
  if (tab?.id == null) throw new Error("Manager tab is unavailable.");
  return (await api.windows.get(tab.windowId)).type;
}

export async function toggleManagerWindow(api) {
  const tab = await api.tabs.getCurrent();
  if (tab?.id == null) throw new Error("Manager tab is unavailable.");
  const current = await api.windows.get(tab.windowId);
  if (current.type !== "normal") {
    await moveManagerToTab(api);
    return "normal";
  }
  // Move the existing page back into a centered dedicated window.
  await api.windows.create({
    tabId: tab.id, type: "popup", width: 520, height: 720,
    left: Math.round(current.left + Math.max(0, current.width - 520) / 2),
    top: Math.round(current.top + Math.max(0, current.height - 720) / 2),
    focused: true, incognito: current.incognito
  });
  return "popup";
}

// Move the live manager tab so its UI and pending Undo state stay intact.
export async function moveManagerToTab(api) {
  const tab = await api.tabs.getCurrent();
  if (tab?.id == null) throw new Error("Manager tab is unavailable.");
  const current = await api.windows.get(tab.windowId);
  if (current.type === "normal") return;
  const windows = await api.windows.getAll({ windowTypes: ["normal"] });
  const regular = windows.filter((window) => window.type === "normal" && window.incognito === false);
  const target = regular.find((window) => window.focused) || regular.at(-1);
  if (!target) {
    await api.windows.create({ tabId: tab.id, type: "normal", focused: true, incognito: false });
    return;
  }
  await api.tabs.move(tab.id, { windowId: target.id, index: -1 });
  await api.tabs.update(tab.id, { active: true });
  await api.windows.update(target.id, { focused: true });
}

export async function openInBrowser(api, url) {
  let target;
  try {
    target = await api.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch { /* There may be no normal browser window. */ }
  if (target?.type !== "normal" || target.incognito !== false || target.id == null) {
    const windows = await api.windows.getAll({ windowTypes: ["normal"] });
    const regularWindows = windows.filter((window) => window.type === "normal" && window.incognito === false);
    target = regularWindows.find((window) => window.focused) || regularWindows.at(-1);
  }
  if (target?.id == null) {
    await api.windows.create({ url, type: "normal", focused: true, incognito: false });
    return;
  }
  await api.tabs.create({ windowId: target.id, url, active: true });
  await api.windows.update(target.id, { focused: true });
}

export function calendarEditUrl(htmlLink) {
  try {
    const url = new URL(htmlLink);
    if (url.protocol !== "https:" || !["www.google.com", "calendar.google.com"].includes(url.hostname)) return null;
    const eid = url.searchParams.get("eid");
    if (!eid || !/^[A-Za-z0-9_+/=-]+$/.test(eid)) return null;
    return `https://calendar.google.com/calendar/u/0/r/eventedit/${encodeURIComponent(eid)}`;
  } catch { return null; }
}

export function calendarEventAction(event, kind = "view") {
  if (kind !== "view" && kind !== "edit") throw new Error("Unsupported Calendar action.");
  try {
    const view = new URL(event?.htmlLink);
    if (view.protocol !== "https:" || !["www.google.com", "calendar.google.com"].includes(view.hostname)) return null;
    return { kind, url: kind === "edit" ? calendarEditUrl(view.href) || view.href : view.href };
  } catch { return null; }
}

export function createOpenGuard(open, cooldownMs = 8_000, now = () => Date.now()) {
  const openedAt = new Map();
  const pending = new Set();
  return async (url) => {
    for (const [openedUrl, time] of openedAt) {
      if (!pending.has(openedUrl) && now() - time >= cooldownMs) openedAt.delete(openedUrl);
    }
    const last = openedAt.get(url);
    if (pending.has(url) || (last !== undefined && now() - last < cooldownMs)) return false;
    openedAt.set(url, now());
    pending.add(url);
    try {
      await open(url);
      return true;
    } catch (error) {
      openedAt.delete(url);
      throw error;
    } finally {
      pending.delete(url);
    }
  };
}
