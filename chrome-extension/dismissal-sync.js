import { dismissalKey, mergeDismissals } from "./model.js";

export const DISMISSAL_MARKER_PREFIX = "notification-manager-dismissal-v2-";

export function parseDismissalMarker(file) {
  const data = JSON.parse(file.description || "");
  if (data.version !== 2 || typeof data.eventId !== "string" || !data.eventId ||
      !Number.isFinite(data.start) || !Number.isFinite(data.dismissed)) {
    throw new Error(`Invalid dismissal marker ${file.id || file.name}.`);
  }
  return { eventId: data.eventId, start: data.start, dismissed: data.dismissed,
    ...(typeof data.title === "string" && data.title ? { title: data.title } : {}) };
}

export async function publishMissingDismissals(local, remote, createMarker, nowMs = Date.now()) {
  const merged = mergeDismissals(local, remote, nowMs);
  const remoteKeys = new Set(remote.map((record) => dismissalKey(record.eventId, record.start)));
  for (const record of merged) {
    if (!remoteKeys.has(dismissalKey(record.eventId, record.start))) await createMarker(record);
  }
  return merged;
}
