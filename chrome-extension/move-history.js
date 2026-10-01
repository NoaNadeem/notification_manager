export const MOVE_MARKER_PREFIX = "notification-manager-move-v1-";
const MOVE_LIMIT = 10;
const MOVE_RETENTION_MS = 30 * 86_400_000;

export function recentMoves(local, remote = [], nowMs = Date.now()) {
  const cutoff = nowMs - MOVE_RETENTION_MS;
  const byId = new Map();
  for (const record of [...local, ...remote]) {
    if (!record?.id || !record.eventId || !Number.isFinite(record.moved) || record.moved < cutoff) continue;
    const previous = byId.get(record.id);
    if (!previous || previous.moved < record.moved) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => b.moved - a.moved || a.id.localeCompare(b.id)).slice(0, MOVE_LIMIT);
}

export function parseMoveMarker(file) {
  const data = JSON.parse(file.description || "");
  if (data.version !== 1 || typeof data.id !== "string" || !data.id ||
      typeof data.eventId !== "string" || !data.eventId || typeof data.title !== "string" ||
      !Number.isFinite(data.from) || !Number.isFinite(data.to) || !Number.isFinite(data.moved)) {
    throw new Error(`Invalid move marker ${file.id || file.name}.`);
  }
  const { id, eventId, title, from, to, moved } = data;
  return { id, eventId, title, from, to, moved };
}
