import { ageLabel, dismissalKey, eventStartMs, locationHref } from "./model.js";
import { primaryCalendar, recentEvents, moveEvent, syncDismissals, saveDismissal, searchPrimaryCalendar } from "./google.js";
import { UndoController, actionDescription } from "./undo.js";
import { flyoutPlacement } from "./layout.js";
import { headerClockLabel, moveTooltip } from "./clock.js";

const $ = (selector) => document.querySelector(selector);
const list = $("#event-list");
const notice = $("#notice");
const info = $("#info");
const accountLabel = $("#account-email");
const accountClock = $("#account-clock");
const count = $("#count");
const connectPanel = $("#connect-panel");
const datePicker = $("#date-picker");
const menu = $("#menu");
const menuToggle = $("#menu-toggle");
const searchQueryInput = $("#search-query");
const lookbackDialog = $("#lookback-dialog");

let account;
let calendarZone;
let events = [];
let dismissals = [];
let lookbackDays = 7;
let darkMode = true;
let signedOut = false;
let loading = false;
let dateTarget;
let openFlyoutRow;
let searchActive = false;
let remoteSearch;
let remoteSearchRequest = 0;
let clockTimer;
const committing = new Set();

const undo = new UndoController(commitAction, () => render());

function showError(message) { notice.textContent = message; }
function showInfo(message) { info.textContent = message; }
function eventKey(event) { return dismissalKey(event.id, eventStartMs(event, calendarZone)); }

function updateHeaderClock() {
  accountClock.textContent = account ? `, ${headerClockLabel(new Date())}` : "";
}

function scheduleHeaderClock() {
  clearTimeout(clockTimer);
  updateHeaderClock();
  if (account) clockTimer = setTimeout(scheduleHeaderClock, 60_000 - Date.now() % 60_000);
}

function button(label, title, action, className = "tile") {
  const element = document.createElement("button");
  element.className = className;
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  element.addEventListener("click", action);
  return element;
}

function moveTile(event, label, option, className = "tile") {
  const tooltip = () => {
    try { return moveTooltip(event, option, new Date()); }
    catch { return `Move ${label} from now`; }
  };
  const tile = button(label, tooltip(), () => void stageAction(event, "move", option), className);
  const refresh = () => {
    const value = tooltip();
    tile.title = value;
    tile.setAttribute("aria-label", value);
  };
  tile.addEventListener("pointerenter", refresh);
  tile.addEventListener("focus", refresh);
  return tile;
}

function openEventLink(url) {
  void (async () => {
    await undo.commit();
    if (!url || !url.startsWith("https://")) {
      showError("Google Calendar did not provide a valid event link.");
      return;
    }
    await chrome.tabs.create({ url });
  })().catch((error) => showError(`Could not open event: ${error.message}`));
}

function closeMenu() {
  menu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
}

function showFlyout(row, flyout) {
  const rowBounds = row.getBoundingClientRect();
  if (openFlyoutRow && openFlyoutRow !== row) hideFlyout(openFlyoutRow);
  openFlyoutRow = row;
  row.classList.add("flyout-open");
  row.classList.remove("flyout-above");
  const listBounds = list.getBoundingClientRect();
  const height = flyout.getBoundingClientRect().height;
  const placement = flyoutPlacement(rowBounds.top, rowBounds.bottom, height, listBounds.top, listBounds.bottom);
  if (placement === "above") {
    row.classList.add("flyout-above");
  } else if (placement === "scroll") {
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function hideFlyout(row) {
  row.classList.remove("flyout-open", "flyout-above");
  if (openFlyoutRow === row) openFlyoutRow = undefined;
}

async function load(interactive = false) {
  if (loading || (signedOut && !interactive)) return;
  loading = true;
  showError("");
  count.textContent = "Loading…";
  try {
    const calendar = await primaryCalendar(interactive);
    account = calendar.id;
    calendarZone = calendar.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    accountLabel.textContent = account;
    scheduleHeaderClock();
    connectPanel.hidden = true;
    if (interactive) {
      signedOut = false;
      await chrome.storage.local.set({ signedOut: false });
      showInfo("");
    }
    const recent = await recentEvents(account, lookbackDays);
    events = recent.events.filter((event) => {
      const start = eventStartMs(event, calendarZone);
      return Number.isFinite(start) && start >= recent.first && start <= recent.now;
    }).sort((a, b) => eventStartMs(b, calendarZone) - eventStartMs(a, calendarZone));
    try {
      dismissals = await syncDismissals(account);
    } catch (error) {
      const saved = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
      dismissals = saved[`dismissals:${account.toLowerCase()}`] || [];
      showError(`Drive dismissal sync failed: ${error.message}. Local dismissals are still shown.`);
    }
    render();
  } catch (error) {
    showError(`Could not load Calendar: ${error.message}`);
    if (!account) connectPanel.hidden = false;
    count.textContent = "";
  } finally {
    loading = false;
  }
}

function render() {
  const previousScroll = list.scrollTop;
  openFlyoutRow = undefined;
  list.replaceChildren();
  const dismissed = new Set(dismissals.map((record) => dismissalKey(record.eventId, record.start)));
  const visible = events.filter((event) => !dismissed.has(eventKey(event)));
  const filtered = searchActive && searchQueryInput.value.trim()
    ? visible.filter((event) => (event.summary || "").toLowerCase().includes(searchQueryInput.value.trim().toLowerCase()))
    : visible;
  count.textContent = `${visible.length} event${visible.length === 1 ? "" : "s"}`;
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = !account ? "Connect Google Calendar to load events."
      : searchActive && searchQueryInput.value.trim() ? "No loaded events match this search."
      : `No events started in the last ${lookbackDays} days.`;
    list.append(empty);
  } else {
    for (const event of filtered) list.append(renderEvent(event));
  }
  if (searchActive) renderSearchFooter();
  list.scrollTop = previousScroll;
}

function renderSearchFooter() {
  const searchButton = button("Search Calendar", "Search all past and future Calendar events", () => void searchCalendar(), "search-calendar");
  searchButton.disabled = !searchQueryInput.value.trim() || remoteSearch?.loading;
  list.append(searchButton);
  if (!remoteSearch || remoteSearch.query !== searchQueryInput.value.trim()) return;
  if (remoteSearch.loading) {
    const loadingText = document.createElement("p");
    loadingText.className = "search-heading";
    loadingText.textContent = "Searching Calendar…";
    list.append(loadingText);
    return;
  }
  if (remoteSearch.error) {
    const error = document.createElement("p");
    error.className = "notice";
    error.textContent = remoteSearch.error;
    list.append(error);
    return;
  }
  const heading = document.createElement("div");
  heading.className = "search-heading";
  heading.textContent = "Calendar results · read only";
  list.append(heading);
  if (!remoteSearch.events.length) {
    const empty = document.createElement("p");
    empty.className = "search-heading";
    empty.textContent = "No Calendar events match this search.";
    list.append(empty);
  }
  for (const event of remoteSearch.events) {
    const row = document.createElement("div");
    row.className = "search-result";
    const title = document.createElement("a");
    title.href = event.htmlLink || "#";
    title.textContent = event.summary || "(Untitled event)";
    title.addEventListener("click", (click) => { click.preventDefault(); openEventLink(event.htmlLink); });
    const date = document.createElement("small");
    date.textContent = event.start?.date
      ? `${event.start.date} · all day`
      : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start.dateTime));
    row.append(title, date);
    list.append(row);
  }
  if (remoteSearch.hasMore) {
    const more = document.createElement("p");
    more.className = "search-heading";
    more.textContent = "Showing the first 100 matches. Narrow your search to find more.";
    list.append(more);
  }
}

function renderEvent(event) {
  const row = document.createElement("article");
  row.className = "event";
  const action = undo.current?.event === event ? undo.current : null;
  const busy = committing.has(eventKey(event));
  if (action) row.classList.add("pending");
  if (busy) row.classList.add("busy");
  const top = document.createElement("div");
  top.className = "event-top";
  const details = document.createElement("div");
  details.className = "details";
  const title = document.createElement(action || busy ? "span" : "a");
  title.className = "title";
  title.textContent = event.summary || "(Untitled event)";
  if (!action && !busy) {
    title.href = event.htmlLink || "#";
    title.addEventListener("click", (click) => { click.preventDefault(); openEventLink(event.htmlLink); });
  }
  const age = document.createElement("div");
  age.className = "age";
  age.textContent = action ? actionDescription(action) : busy ? "Committing action…" : ageLabel(eventStartMs(event, calendarZone));
  details.append(title, age);
  if (!action && !busy && event.location) {
    const location = document.createElement("a");
    location.className = "location";
    location.textContent = event.location;
    location.title = event.location;
    location.href = locationHref(event.location);
    location.addEventListener("click", (click) => {
      click.preventDefault();
      void undo.commit().then(() => chrome.tabs.create({ url: location.href }))
        .catch((error) => showError(`Could not open location: ${error.message}`));
    });
    details.append(location);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  if (action) {
    actions.append(button("Undo", `Undo pending action for ${event.summary || "event"}`, () => void undo.undo(), "tile undo"));
  } else if (!busy) {
    actions.append(moveTile(event, "1D", { days: 1 }, "tile primary"));
    const more = button("⋯", "More move and dismiss options", () => showFlyout(row, flyout), "tile more");
    more.setAttribute("aria-haspopup", "true");
    more.addEventListener("pointerenter", () => showFlyout(row, flyout));
    more.addEventListener("focus", () => showFlyout(row, flyout));
    row.addEventListener("pointerleave", () => hideFlyout(row));
    row.addEventListener("focusout", (event) => {
      if (!row.contains(event.relatedTarget)) hideFlyout(row);
    });
    actions.append(more);
  }
  top.append(details, actions);
  row.append(top);
  if (action || busy) return row;
  const flyout = document.createElement("div");
  flyout.className = "flyout";
  const topRow = document.createElement("div");
  const bottomRow = document.createElement("div");
  topRow.className = bottomRow.className = "tile-row";
  if (event.start.date) {
    topRow.append(moveTile(event, "0D", { days: 0 }));
    for (let i = 0; i < 2; i++) {
      const spacer = button("", "Unavailable for all-day events", () => {});
      spacer.disabled = true;
      topRow.append(spacer);
    }
  } else {
    for (const hours of [1, 4, 8]) {
      topRow.append(moveTile(event, `${hours}H`, { hours }));
    }
  }
  topRow.append(button("📅", "Choose a date", () => {
    void undo.commit();
    dateTarget = event;
    datePicker.value = "";
    if (datePicker.showPicker) datePicker.showPicker();
    else datePicker.click();
  }));
  topRow.append(button("✓", "Dismiss event in this app", () => void stageAction(event, "dismiss"), "tile danger"));
  for (const days of [2, 3, 4, 7]) {
    bottomRow.append(moveTile(event, `${days}D`, { days }));
  }
  bottomRow.append(button("↗", "Open event in Google Calendar", () => openEventLink(event.htmlLink)));
  flyout.append(topRow, bottomRow);
  row.append(flyout);
  return row;
}

async function stageAction(event, type, option) {
  showError("");
  try {
    await undo.stage({ event, type, option });
  } catch (error) {
    showError(`Could not prepare action for “${event.summary || "(Untitled event)"}”: ${error.message}`);
  }
}

async function commitAction(action) {
  const { event } = action;
  const key = eventKey(event);
  committing.add(key);
  render();
  try {
    if (action.type === "move") {
      const moved = await moveEvent(account, event.id, action.option);
      events = events.filter((item) => item !== event);
      const start = eventStartMs(moved, calendarZone);
      if (Number.isFinite(start) && start <= Date.now() && start >= Date.now() - lookbackDays * 86_400_000) {
        events.push(moved);
        events.sort((a, b) => eventStartMs(b, calendarZone) - eventStartMs(a, calendarZone));
      }
    } else {
      dismissals = await saveDismissal(account, {
        eventId: event.id, start: eventStartMs(event, calendarZone), dismissed: Date.now()
      });
    }
    showError("");
  } catch (error) {
    if (action.type === "dismiss") {
      const stored = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
      dismissals = stored[`dismissals:${account.toLowerCase()}`] || dismissals;
      const savedLocally = dismissals.some((record) => dismissalKey(record.eventId, record.start) === key);
      showError(savedLocally
        ? `Dismissal of “${event.summary || "(Untitled event)"}” was saved locally, but Drive sync failed: ${error.message}`
        : `Could not dismiss “${event.summary || "(Untitled event)"}”: ${error.message}`);
    } else {
      showError(`Could not move “${event.summary || "(Untitled event)"}”: ${error.message}`);
    }
  } finally {
    committing.delete(key);
    render();
  }
}

async function searchCalendar() {
  const query = searchQueryInput.value.trim();
  if (!query || !account) return;
  await undo.commit();
  const request = ++remoteSearchRequest;
  remoteSearch = { query, loading: true };
  render();
  try {
    const results = await searchPrimaryCalendar(account, query);
    if (request === remoteSearchRequest) remoteSearch = { query, ...results };
  } catch (error) {
    if (request === remoteSearchRequest) remoteSearch = { query, error: `Could not search Calendar: ${error.message}` };
  }
  if (request === remoteSearchRequest) render();
}

async function changeLookback(days) {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    showError("Choose 1–365 days.");
    return;
  }
  await undo.commit();
  lookbackDialog.close();
  lookbackDays = days;
  $("#lookback-label").textContent = `${days} days`;
  await chrome.storage.local.set({ lookbackDays: days });
  await load();
}

async function logout() {
  await undo.commit();
  try {
    await chrome.identity.clearAllCachedAuthTokens();
    await chrome.storage.local.set({ signedOut: true });
    signedOut = true;
    account = undefined;
    scheduleHeaderClock();
    events = [];
    dismissals = [];
    remoteSearch = undefined;
    remoteSearchRequest++;
    accountLabel.textContent = "Connect Google Calendar";
    connectPanel.hidden = false;
    render();
    showError("");
    showInfo("Disconnected. To use another Google account, switch Chrome profile and connect there.");
  } catch (error) {
    showError(`Could not disconnect Calendar: ${error.message}`);
  }
}

menuToggle.addEventListener("click", () => {
  void undo.commit();
  menu.hidden = !menu.hidden;
  menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("pointerdown", (event) => {
  if (!menu.hidden && !menu.contains(event.target) && event.target !== menuToggle) closeMenu();
});
$("#refresh").addEventListener("click", () => {
  closeMenu();
  void undo.commit().then(() => load());
});
$("#logout").addEventListener("click", () => { closeMenu(); void logout(); });
$("#lookback-open").addEventListener("click", () => {
  closeMenu();
  void undo.commit();
  $("#custom-lookback").value = String(lookbackDays);
  lookbackDialog.showModal();
});
$("#estimate-storage").addEventListener("click", () => {
  closeMenu();
  void (async () => {
    await undo.commit();
    if (!account) throw new Error("Reconnect Calendar before estimating storage.");
    showInfo("Counting events from the past year…");
    const result = await recentEvents(account, 365);
    const now = Date.now();
    const eventsInYear = result.events.filter((event) => {
      const start = eventStartMs(event, calendarZone);
      return Number.isFinite(start) && start >= result.first && start <= result.now;
    });
    const records = eventsInYear.map((event) => ({ eventId: event.id, start: eventStartMs(event, calendarZone), dismissed: now }));
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, records })).byteLength;
    showInfo(`${eventsInYear.length} events in the past year. If every one were dismissed, the Drive file would be ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB).`);
  })().catch((error) => showError(`Could not estimate storage: ${error.message}`));
});
$("#theme-toggle").addEventListener("click", () => {
  closeMenu();
  void undo.commit();
  darkMode = !darkMode;
  document.documentElement.classList.toggle("light", !darkMode);
  $("#theme-toggle").textContent = `Dark mode: ${darkMode ? "On" : "Off"}`;
  void chrome.storage.local.set({ darkMode });
});
$("#search-toggle").addEventListener("click", () => {
  void undo.commit();
  searchActive = true;
  $("#header-heading").hidden = true;
  $("#search-controls").hidden = false;
  searchQueryInput.focus();
  render();
});
$("#search-close").addEventListener("click", () => {
  searchActive = false;
  searchQueryInput.value = "";
  remoteSearch = undefined;
  remoteSearchRequest++;
  $("#header-heading").hidden = false;
  $("#search-controls").hidden = true;
  render();
});
searchQueryInput.addEventListener("input", () => { remoteSearchRequest++; render(); });
searchQueryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); void searchCalendar(); }
  if (event.key === "Escape") $("#search-close").click();
});
for (const choice of document.querySelectorAll("[data-days]")) {
  choice.addEventListener("click", () => void changeLookback(Number(choice.dataset.days)));
}
$("#lookback-apply").addEventListener("click", () => void changeLookback(Number($("#custom-lookback").value)));
$("#lookback-cancel").addEventListener("click", () => lookbackDialog.close());
datePicker.addEventListener("change", () => {
  if (datePicker.value && dateTarget) void stageAction(dateTarget, "move", { date: datePicker.value });
  dateTarget = undefined;
});
$("#connect").addEventListener("click", () => void load(true));
window.addEventListener("blur", () => { void undo.commit(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) void undo.commit(); });
window.addEventListener("focus", () => {
  updateHeaderClock();
  if (account && !loading && !undo.current && committing.size === 0 && !lookbackDialog.open && !dateTarget) void load();
});

const saved = await chrome.storage.local.get(["lookbackDays", "darkMode", "signedOut"]);
lookbackDays = Number.isInteger(saved.lookbackDays) && saved.lookbackDays >= 1 && saved.lookbackDays <= 365 ? saved.lookbackDays : 7;
darkMode = saved.darkMode !== false;
signedOut = saved.signedOut === true;
document.documentElement.classList.toggle("light", !darkMode);
$("#theme-toggle").textContent = `Dark mode: ${darkMode ? "On" : "Off"}`;
$("#lookback-label").textContent = `${lookbackDays} days`;
if (signedOut) {
  connectPanel.hidden = false;
  showInfo("Disconnected. Connect this Chrome profile to load your primary Calendar.");
  render();
} else {
  void load();
}
