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
