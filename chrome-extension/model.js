export const DISMISSAL_FILE = "notification-manager-dismissals-v1.json";
const DAY_MS = 86_400_000;

export function ageLabel(startMs, nowMs = Date.now()) {
  if (startMs > nowMs) {
    const remaining = startMs - nowMs;
    if (remaining < DAY_MS) {
      const hours = Math.max(1, Math.ceil(remaining / 3_600_000));
      return `In ${hours} ${hours === 1 ? "hr" : "hrs"}`;
    }
    const days = Math.ceil(remaining / DAY_MS);
    return `In ${days} ${days === 1 ? "day" : "days"}`;
  }
  const elapsed = Math.max(0, nowMs - startMs);
  if (elapsed < DAY_MS) {
    const hours = Math.max(1, Math.ceil(elapsed / 3_600_000));
    return `${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
  }
  const days = Math.ceil(elapsed / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export const WINDOW_PRESETS = {
  current: { label: "Current: 7 days back to today", back: 7, ahead: 0 },
  daily: { label: "Daily cleanup: yesterday + today", back: 1, ahead: 0 },
  weekAhead: { label: "Week-ahead: 7 days back + 7 ahead", back: 7, ahead: 7 },
  meetings: { label: "Meeting-heavy: 2 days back + today", back: 2, ahead: 0 },
  monthly: { label: "Monthly cleanup: 30 days back", back: 30, ahead: 0 },
  endOfWeek: { label: "End-of-week: Monday through today", back: 1, ahead: 0 }
};

export function displayWindow(nowMs, lookbackDays, lookaheadDays, preset = null) {
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 365 ||
      !Number.isInteger(lookaheadDays) || lookaheadDays < 0 || lookaheadDays > 36500) {
    throw new RangeError("Invalid lookback or lookahead days.");
  }
  const end = new Date(nowMs);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + lookaheadDays + 1);
  let first = nowMs - lookbackDays * DAY_MS;
  if (preset && WINDOW_PRESETS[preset] && preset !== "current") {
    const start = new Date(nowMs);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (preset === "endOfWeek" ? (start.getDay() + 6) % 7 : WINDOW_PRESETS[preset].back));
    first = start.getTime();
  }
  return { first, lastExclusive: end.getTime() };
}

export function isRecurring(event) {
  return Boolean(event.recurringEventId || event.recurrence?.length);
}

export function eventStartMs(event, calendarTimeZone) {
  if (event.start?.dateTime) return Date.parse(event.start.dateTime);
  if (!event.start?.date) return NaN;
  // Match Android's all-day date at midnight in the calendar's time zone.
  return zonedMidnightMs(event.start.date, calendarTimeZone);
}

export function isTwoDaysOld(event, zone, nowMs = Date.now()) {
  return eventStartMs(event, zone) <= nowMs - 2 * DAY_MS;
}

export function isEmphasized(event, account) {
  if (event.start?.date) return true;
  const start = Date.parse(event.start?.dateTime);
  const end = Date.parse(event.end?.dateTime);
  if (Number.isFinite(start) && Number.isFinite(end) && end - start >= 3_600_000) return true;
  return (event.attendees || []).some((attendee) =>
    !attendee.resource && !attendee.self && attendee.email &&
    attendee.email.toLowerCase() !== account?.toLowerCase());
}

export function compareEvents(a, b, zone) {
  const localDate = (event) => {
    if (event.start?.date) return event.start.date;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone: zone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date(eventStartMs(event, zone))).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const dateOrder = localDate(a).localeCompare(localDate(b));
  if (dateOrder) return dateOrder;
  if (Boolean(a.start?.date) !== Boolean(b.start?.date)) return a.start?.date ? -1 : 1;
  return eventStartMs(a, zone) - eventStartMs(b, zone);
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
  if (isRecurring(event)) throw new Error("Recurring events can only be dismissed or edited in Google Calendar.");
  if (option.time && (!option.date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(option.time))) {
    throw new Error("Choose a valid date and time before moving this event.");
  }
  const updated = structuredClone(event);
  if (event.start?.date) {
    if (option.time) throw new Error("All-day events cannot be moved to a time.");
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
      const clock = option.time ? `${option.time}:00`
        : `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      targetMs = new Date(`${option.date}T${clock}`).getTime();
      if (!Number.isFinite(targetMs)) throw new Error("Choose a valid date and time before moving this event.");
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
    if (!record.eventId || record.start < cutoff) continue;
    const key = `${record.eventId}/${record.start}`;
    const current = byKey.get(key);
    if (!current || current.dismissed < record.dismissed) {
      byKey.set(key, record.title || !current?.title ? record : { ...record, title: current.title });
    } else if (!current.title && record.title) {
      byKey.set(key, { ...current, title: record.title });
    }
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start || a.eventId.localeCompare(b.eventId));
}

export function recentDismissals(records) {
  return [...records].sort((a, b) => b.dismissed - a.dismissed ||
    dismissalKey(a.eventId, a.start).localeCompare(dismissalKey(b.eventId, b.start))).slice(0, 10);
}

export function parseDismissals(raw) {
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.records)) throw new Error("Unsupported dismissal data version.");
  return data.records;
}

export function dismissalKey(eventId, startMs) { return `${eventId}/${startMs}`; }

export function locationHref(location) {
  if (!location) return null;
  const text = location.trim();
  const embeddedUrl = text.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[.,;)]+$/, "");
  if (embeddedUrl) return embeddedUrl;
  if (/^www\./i.test(text)) return `https://${text}`;
  try {
    const url = new URL(text);
    if (["https:", "http:"].includes(url.protocol)) return url.href;
  } catch { /* Address rather than a URL. */ }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;
}
