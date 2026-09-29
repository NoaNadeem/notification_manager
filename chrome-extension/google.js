import { DISMISSAL_FILE, mergeDismissals, parseDismissals, shiftEvent, compareEvents, displayWindow, isRecurring } from "./model.js";
import { DISMISSAL_MARKER_PREFIX, parseDismissalMarker, publishMissingDismissals } from "./dismissal-sync.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
let dismissalQueue = Promise.resolve();

export function primaryEventsUrl(primaryCalendarId) {
  if (!primaryCalendarId || typeof primaryCalendarId !== "string") throw new Error("Primary Calendar ID is required.");
  return new URL(`${CALENDAR}/${encodeURIComponent(primaryCalendarId)}/events`);
}

function enqueueDismissal(work) {
  const result = dismissalQueue.then(work);
  dismissalQueue = result.catch(() => {});
  return result;
}

async function token(interactive = false) {
  const result = await chrome.identity.getAuthToken({ interactive });
  if (!result?.token) throw new Error("Google sign-in did not return an access token.");
  return result.token;
}

export async function googleRequest(url, options = {}, interactive = false) {
  let accessToken = await token(interactive);
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
    if (response.status !== 401 || attempt) break;
    await chrome.identity.removeCachedAuthToken({ token: accessToken });
    accessToken = await token(false);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Google API returned HTTP ${response.status}.`);
  }
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

export async function primaryCalendar(interactive = false) {
  return googleRequest(`${CALENDAR}/primary`, {}, interactive);
}

export async function recentEvents(calendarId, lookbackDays, lookaheadDays = 0, preset = null) {
  const now = Date.now();
  const { first, lastExclusive } = displayWindow(now, lookbackDays, lookaheadDays, preset);
  const all = [];
  let pageToken;
  do {
    const url = primaryEventsUrl(calendarId);
    url.searchParams.set("timeMin", new Date(first).toISOString());
    url.searchParams.set("timeMax", new Date(lastExclusive).toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleRequest(url.href);
    for (const event of page.items || []) {
      if (event.status !== "cancelled") all.push(event);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { events: all, now, first, lastExclusive };
}

export async function searchPrimaryCalendar(calendarId, query) {
  const term = query.trim();
  if (!term) throw new Error("Enter a search term.");
  const all = [];
  let pageToken;
  let pages = 0;
  do {
    const url = primaryEventsUrl(calendarId);
    url.searchParams.set("q", term);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "false");
    url.searchParams.set("maxResults", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const result = await googleRequest(url.href);
    pages++;
    all.push(...(result.items || []).filter((event) => event.status !== "cancelled").slice(0, 100 - all.length));
    pageToken = result.nextPageToken;
  } while (pageToken && all.length < 100 && pages < 10);
  all.sort((a, b) => compareEvents(a, b, Intl.DateTimeFormat().resolvedOptions().timeZone));
  return { events: all, hasMore: !!pageToken };
}

export async function moveEvent(calendarId, eventId, option) {
  const url = `${CALENDAR}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const current = await googleRequest(url);
  if (current.status === "cancelled") throw new Error("This event was deleted in Google Calendar.");
  if (isRecurring(current)) throw new Error("Recurring events can only be dismissed or edited in Google Calendar.");
  const moved = shiftEvent(current, option);
  const update = new URL(url);
  update.searchParams.set("sendUpdates", "none");
  update.searchParams.set("conferenceDataVersion", "1");
  update.searchParams.set("supportsAttachments", "true");
  if (current.eventLabelId) update.searchParams.set("eventLabelVersion", "1");
  return googleRequest(update.href, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(current.etag ? { "If-Match": current.etag } : {}) },
    body: JSON.stringify(moved)
  });
}

export function syncDismissals(account) {
  return enqueueDismissal(() => syncDismissalsNow(account));
}

async function syncDismissalsNow(account) {
  const storageKey = `dismissals:${account.toLowerCase()}`;
  const stored = await chrome.storage.local.get(storageKey);
  const local = stored[storageKey] || [];
  const files = [];
  let pageToken;
  do {
    const url = new URL(DRIVE);
    url.searchParams.set("spaces", "appDataFolder");
    url.searchParams.set("q", "trashed = false");
    url.searchParams.set("fields", "nextPageToken,files(id,name,description)");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const listing = await googleRequest(url.href);
    files.push(...(listing.files || []));
    pageToken = listing.nextPageToken;
  } while (pageToken);
  const legacyIds = files.filter((file) => file.name === DISMISSAL_FILE).map((file) => file.id);
  const markerFiles = files.filter((file) => file.name?.startsWith(DISMISSAL_MARKER_PREFIX));
  const legacy = (await Promise.all(legacyIds.map(async (id) =>
    parseDismissals(JSON.stringify(await googleRequest(`${DRIVE}/${encodeURIComponent(id)}?alt=media`)))
  ))).flat();
  const remote = [...legacy, ...markerFiles.map(parseDismissalMarker)];
  const merged = mergeDismissals(local, remote);
  await chrome.storage.local.set({ [storageKey]: merged });
  await publishMissingDismissals(local, remote, createDismissalMarker);
  const cutoff = Date.now() - 365 * 86_400_000;
  for (const file of markerFiles) {
    if (parseDismissalMarker(file).start < cutoff) {
      try { await googleRequest(`${DRIVE}/${encodeURIComponent(file.id)}`, { method: "DELETE" }); }
      catch { /* Pruning is retried on the next sync. */ }
    }
  }
  return merged;
}

export function saveDismissal(account, record) {
  return enqueueDismissal(async () => {
    const storageKey = `dismissals:${account.toLowerCase()}`;
    const stored = await chrome.storage.local.get(storageKey);
    const merged = mergeDismissals(stored[storageKey] || [], [record]);
    await chrome.storage.local.set({ [storageKey]: merged });
    return syncDismissalsNow(account);
  });
}

async function createDismissalMarker(record) {
  const metadata = {
    name: `${DISMISSAL_MARKER_PREFIX}${crypto.randomUUID()}.json`,
    mimeType: "application/json",
    parents: ["appDataFolder"],
    description: JSON.stringify({ version: 2, ...record })
  };
  return googleRequest(`${DRIVE}?fields=id`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(metadata)
  });
}
