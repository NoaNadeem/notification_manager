import { DISMISSAL_FILE, mergeDismissals, parseDismissals, shiftEvent } from "./model.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

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

export async function recentEvents(calendarId, lookbackDays) {
  const now = Date.now();
  const first = now - lookbackDays * 86_400_000;
  const all = [];
  let pageToken;
  do {
    const url = new URL(`${CALENDAR}/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("timeMin", new Date(first).toISOString());
    url.searchParams.set("timeMax", new Date(now + 1000).toISOString());
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
  return { events: all, now, first };
}

export async function moveEvent(calendarId, eventId, option) {
  const url = `${CALENDAR}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  const current = await googleRequest(url);
  if (current.status === "cancelled") throw new Error("This event was deleted in Google Calendar.");
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

export async function syncDismissals(account) {
  const storageKey = `dismissals:${account.toLowerCase()}`;
  const stored = await chrome.storage.local.get(storageKey);
  const local = stored[storageKey] || [];
  const url = new URL(DRIVE);
  url.searchParams.set("spaces", "appDataFolder");
  url.searchParams.set("q", `name = '${DISMISSAL_FILE}' and trashed = false`);
  url.searchParams.set("fields", "nextPageToken,files(id,name)");
  url.searchParams.set("pageSize", "100");
  const listing = await googleRequest(url.href);
  if (listing.nextPageToken) throw new Error("Drive has too many dismissal files to sync safely.");
  const fileIds = (listing.files || []).map((file) => file.id);
  const remote = (await Promise.all(fileIds.map(async (id) =>
    parseDismissals(JSON.stringify(await googleRequest(`${DRIVE}/${encodeURIComponent(id)}?alt=media`)))
  ))).flat();
  const merged = mergeDismissals(local, remote);
  await chrome.storage.local.set({ [storageKey]: merged });
  if (fileIds.length === 0) {
    if (merged.length) await createDriveFile(merged);
  } else if (JSON.stringify(merged) !== JSON.stringify(remote)) {
    await updateDriveFile(fileIds[0], merged);
  }
  return merged;
}

export async function saveDismissal(account, record) {
  const storageKey = `dismissals:${account.toLowerCase()}`;
  const stored = await chrome.storage.local.get(storageKey);
  const merged = mergeDismissals(stored[storageKey] || [], [record]);
  await chrome.storage.local.set({ [storageKey]: merged });
  await syncDismissals(account);
  return merged;
}

async function createDriveFile(records) {
  const boundary = `notification-manager-${crypto.randomUUID()}`;
  const metadata = { name: DISMISSAL_FILE, mimeType: "application/json", parents: ["appDataFolder"] };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ version: 1, records })}\r\n--${boundary}--\r\n`;
  return googleRequest("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body
  });
}

async function updateDriveFile(id, records) {
  return googleRequest(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&fields=id`, {
    method: "PATCH", headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ version: 1, records })
  });
}
