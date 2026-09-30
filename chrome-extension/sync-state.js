export const HISTORY_MS = 3 * 86_400_000;

export function updateHistory(history, entry, now = Date.now()) {
  return [...history, entry].filter((item) => item.at >= now - HISTORY_MS).slice(-500);
}

export function syncHeadline(state, online, now = Date.now()) {
  if (!online) return "Offline — changes saved on this device";
  if (state.error) return "Sync needs attention";
  if (state.pending?.length) return "Local changes waiting to sync";
  if (!state.calendarAt || !state.dismissalAt) return "Sync needs attention";
  if (now - state.calendarAt > 3_600_000 || now - state.dismissalAt > 3_600_000) return "Sync needs attention";
  return "Synced just now";
}

export function syncDetail(state, now = Date.now()) {
  const date = (ms) => ms ? new Date(ms).toLocaleString() : "Never";
  return `Calendar refreshed: ${date(state.calendarAt)}\nDismissals synced: ${date(state.dismissalAt)}\n` +
    `Local-only dismissals: ${state.pending?.length || 0}\n` +
    `Newer state from another device: ${state.remoteNewer ? "Yes, merged" : "No new state detected"}\n` +
    `Conflict resolved: ${state.conflictResolved ? "Yes, dismissal union preserved" : "None detected"}\n` +
    `History: ${(state.history || []).filter((item) => item.at >= now - HISTORY_MS).length} actions (3 days)` +
    (state.error ? `\nLast error: ${state.error}` : "");
}
