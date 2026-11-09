export function syncHeadline(state, now = Date.now()) {
  if (state.pending?.length) return "Local changes waiting to sync";
  if (state.error || state.tasksError) return "Sync needs attention";
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
    (state.error ? `\nLast error: ${state.error}` : "") +
    (state.tasksError ? `\nTasks error: ${state.tasksError}` : "");
}

// The latest known action is a watermark: once it finishes, older saves must
// not replace its message, even if they are still running in the background.
export function savingTitle(title) {
  const text = (title || "").replace(/\s+/g, " ").trim() || "Untitled event";
  const chars = Array.from(text);
  return chars.length > 20 ? chars.slice(0, 20).join("") + "…" : text;
}

export function latestSavingStatus(active, latest) {
  const candidates = [...active, ...(latest ? [latest] : [])];
  const newest = candidates.reduce((best, action) => !best || (action.stagedAtMs || 0) >= (best.stagedAtMs || 0) ? action : best, null);
  if (!newest || !active.some(action => action.id === newest.id)) return "";
  const title = savingTitle(newest.event?.summary);
  if (newest.type === "dismiss") return `Dismissing ${title}${title.endsWith("…") ? "" : "…"}`;
  const start = newest.destinationStart;
  const date = start?.date ? new Date(`${start.date}T12:00:00`)
    : start?.dateTime ? new Date(start.dateTime)
    : newest.option?.date ? new Date(`${newest.option.date}T12:00:00`)
    : new Date((newest.stagedAtMs || Date.now()) + (newest.option?.days || 0) * 86400000 + (newest.option?.hours || 0) * 3600000);
  if (!Number.isFinite(date.getTime())) return `Moving ${title}…`;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    weekday: "short", day: "numeric", month: "short", year: "numeric"
  }).formatToParts(date).map(part => [part.type, part.value]));
  const day = Number(parts.day);
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ({1:"st",2:"nd",3:"rd"}[day % 10] || "th");
  const month = parts.month === "Sep" ? "Sept" : parts.month;
  return `Moving ${title} to ${parts.weekday} ${day}${suffix} ${month} ${parts.year}`;
}
