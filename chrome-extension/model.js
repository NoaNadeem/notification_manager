export const DISMISSAL_FILE = "notification-manager-dismissals-v1.json";
const DAY_MS = 86_400_000;

export function ageLabel(startMs, nowMs = Date.now()) {
  const elapsed = Math.max(0, nowMs - startMs);
  if (elapsed < DAY_MS) {
    const hours = Math.max(1, Math.ceil(elapsed / 3_600_000));
    return `${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
  }
  const days = Math.ceil(elapsed / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function eventStartMs(event, calendarTimeZone) {
  if (event.start?.dateTime) return Date.parse(event.start.dateTime);
  if (!event.start?.date) return NaN;
  // Match Android's all-day date at midnight in the calendar's time zone.
  return zonedMidnightMs(event.start.date, calendarTimeZone);
}

export function zonedMidnightMs(date, zone) {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(utc));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const wallAsUtc = Date.UTC(+value.year, +value.month - 1, +value.day, +value.hour, +value.minute, +value.second);
  let candidate = utc + (utc - wallAsUtc);
  // A second pass handles an offset change near midnight.
  const secondParts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(candidate));
  const second = Object.fromEntries(secondParts.map((part) => [part.type, part.value]));
  const difference = Date.UTC(+second.year, +second.month - 1, +second.day, +second.hour, +second.minute) - Date.parse(`${date}T00:00:00Z`);
  candidate -= difference;
  return candidate;
}

export function shiftEvent(event, option, now = new Date()) {
  const updated = structuredClone(event);
  if (event.start?.date) {
    const originalStart = event.start.date;
    const span = Math.round((Date.parse(`${event.end.date}T00:00:00Z`) - Date.parse(`${originalStart}T00:00:00Z`)) / DAY_MS);
    if (span < 1) throw new Error("This all-day event has an invalid end date.");
    const target = option.date || dateInDays(now, option.days || 0);
    updated.start = { date: target };
    updated.end = { date: dateInDays(new Date(`${target}T12:00:00Z`), span, true) };
  } else {
    const originalStart = Date.parse(event.start.dateTime);
    const originalEnd = Date.parse(event.end.dateTime);
    const duration = originalEnd - originalStart;
    if (!Number.isFinite(duration) || duration < 0) throw new Error("This event has an invalid end time.");
    let targetMs;
    if (option.date) {
      const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      targetMs = new Date(`${option.date}T${clock}`).getTime();
    } else {
      targetMs = now.getTime() + (option.hours || 0) * 3_600_000 + (option.days || 0) * DAY_MS;
    }
    updated.start = { dateTime: new Date(targetMs).toISOString(), ...(event.start.timeZone ? { timeZone: event.start.timeZone } : {}) };
    updated.end = { dateTime: new Date(targetMs + duration).toISOString(), ...(event.end.timeZone ? { timeZone: event.end.timeZone } : {}) };
  }
  return updated;
}

function dateInDays(date, days, utc = false) {
  const value = new Date(date);
  if (utc) value.setUTCDate(value.getUTCDate() + days);
  else value.setDate(value.getDate() + days);
  return utc ? value.toISOString().slice(0, 10) : `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function mergeDismissals(local, remote, nowMs = Date.now()) {
  const cutoff = nowMs - 365 * DAY_MS;
  const byKey = new Map();
  for (const record of [...local, ...remote]) {
    if (!record.eventId || record.start < cutoff || record.start > nowMs) continue;
    const key = `${record.eventId}/${record.start}`;
    if (!byKey.has(key) || byKey.get(key).dismissed < record.dismissed) byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId));
}

export function parseDismissals(raw) {
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.records)) throw new Error("Unsupported dismissal data version.");
  return data.records;
}

export function dismissalKey(eventId, startMs) { return `${eventId}/${startMs}`; }

export function locationHref(location) {
  if (!location) return null;
  try {
    const url = new URL(location);
    if (["https:", "http:"].includes(url.protocol)) return url.href;
  } catch { /* Address rather than a URL. */ }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
