export async function openInBrowser(api, url) {
  let target;
  try {
    target = await api.windows.getLastFocused({ windowTypes: ["normal"] });
  } catch { /* There may be no normal browser window. */ }
  if (target?.type !== "normal" || target.id == null) {
    const windows = await api.windows.getAll({ windowTypes: ["normal"] });
    target = windows.find((window) => window.focused) || windows.at(-1);
  }
  if (target?.id == null) {
    await api.windows.create({ url, type: "normal", focused: true });
    return;
  }
  await api.tabs.create({ windowId: target.id, url, active: true });
  await api.windows.update(target.id, { focused: true });
}
