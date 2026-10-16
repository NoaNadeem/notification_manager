export function syncHeadline(state, now = Date.now()) {
  if (state.pending?.length) return "Local changes waiting to sync";
  if (state.error) return "Sync needs attention";
  if (!state.calendarAt || !state.dismissalAt) return "Sync needs attention";
  if (now - state.calendarAt > 3_600_000 || now - state.dismissalAt > 3_600_000) return "Sync needs attention";
  return "Synced just now";
}

export function shouldShowSyncStatus(attempted, loading, signedOut, account) {
  return attempted && !loading && !signedOut && !!account;
}

// Sync-status persistence is diagnostic. A storage failure must not turn a
// successful Calendar refresh or Drive dismissal into a failed action.
export async function persistSyncState(storage, account, state) {
  if (!account) return null;
  const { history, ...saved } = state;
  try {
    await storage.set({ [`syncState:${account.toLowerCase()}`]: saved });
    return null;
  } catch (error) {
    return error?.message || String(error);
  }
}

export function syncDetail(state) {
  const date = (ms) => ms ? new Date(ms).toLocaleString() : "Never";
  return `Calendar refreshed: ${date(state.calendarAt)}\nDismissals synced: ${date(state.dismissalAt)}\n` +
    `Local-only dismissals: ${state.pending?.length || 0}\n` +
    `Newer state from another device: ${state.remoteNewer ? "Yes, merged" : "No new state detected"}\n` +
    `Conflict resolved: ${state.conflictResolved ? "Yes, dismissal union preserved" : "None detected"}` +
    (state.error ? `\nLast error: ${state.error}` : "");
}
