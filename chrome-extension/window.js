import { eventAgeLabel, isFutureEvent, dismissalKey, eventStartMs, locationHref, isTwoDaysOld, isEmphasized, isRecurring, compareEvents, displayWindow, WINDOW_PRESETS, recentDismissals, shiftEvent, withoutDismissals } from "./model.js";
import { primaryCalendar, recentEvents, moveEvent, syncDismissals, saveDismissal, searchPrimaryCalendar, dismissedEventTitle, syncRecentMoves, saveRecentMove } from "./google.js";
import { UndoController, actionDescription, parseUndoSeconds, DEFAULT_UNDO_SECONDS } from "./undo.js";
import { InteractionRenderGuard } from "./render-guard.js";
import { PendingActionStore } from "./pending-actions.js";
import { flyoutPointerInReach } from "./layout.js";
import { headerClockLabel, moveTooltip } from "./clock.js";
import { calendarEventAction, createOpenGuard, managerWindowMode, toggleManagerWindow, openInBrowser } from "./open.js";
import { PullRefreshGesture } from "./pull-refresh.js";
import { syncHeadline, syncDetail, shouldShowSyncStatus, persistSyncState } from "./sync-state.js";

const $ = (selector) => document.querySelector(selector);
const list = $("#event-list");
const notice = $("#notice");
const info = $("#info");
const accountLabel = $("#account-email");
const accountClock = $("#account-clock");
const count = $("#count");
const pullIndicator = $("#pull-indicator");
const connectPanel = $("#connect-panel");
const datePicker = $("#date-picker");
const timePicker = $("#time-picker");
const timeToggle = $("#time-toggle");
const calendarDialog = $("#calendar-dialog");
const menu = $("#menu");
const menuToggle = $("#menu-toggle");
const searchQueryInput = $("#search-query");
const lookbackDialog = $("#lookback-dialog");
const lookaheadDialog = $("#lookahead-dialog");
const presetsDialog = $("#presets-dialog");
const syncDialog = $("#sync-dialog");
const recentDismissalsDialog = $("#recent-dismissals-dialog");
const recentMovesDialog = $("#recent-moves-dialog");
const skinsDialog = $("#skins-dialog");
const undoTimeDialog = $("#undo-time-dialog");
const skinPresets = {
  Green: ["#79B590", "#397A51", "#1D422E", "#DDF5E4"],
  Blue: ["#79AEC9", "#346982", "#19394D", "#D6F0FF"],
  Purple: ["#AC90CD", "#735391", "#35264A", "#ECDEFF"],
  Rose: ["#CF8DAB", "#9C5275", "#4A2639", "#FFE0EE"]
};

let account;
let calendarZone;
let events = [];
let dismissals = [];
let moves = [];
let lookbackDays = 7;
let lookaheadDays = 0;
let windowPreset = null;
let syncState = { calendarAt: null, dismissalAt: null, pending: [], error: null, remoteNewer: false, conflictResolved: false };
let statusStorageError = null;
let darkMode = true;
let skinName = "Green";
let signedOut = false;
let loading = false;
let syncAttempted = false;
let refreshBusy = false;
let suppressNextClick = false;
let wheelResetTimer;
let dateTarget;
let openFlyoutRow;
let openFlyout;
let openFlyoutTrigger;
let searchActive = false;
let realEventsOnly = false;
let remoteSearch;
let remoteSearchRequest = 0;
let clockTimer;
let storageEstimateTimer;
let storageEstimateRequest = 0;
let storageEstimateMessage;
let storageEstimateNode;
const committing = new Set();
const pendingStores = new Map();
let retryingSaves = false;
let saveStatusRequest = 0;
const renderGuard = new InteractionRenderGuard(renderNow);

const undo = new UndoController(commitAction, () => {
  render();
}, undefined, undefined, undefined, persistAction);

function storeFor(accountId) {
  const key = accountId.toLowerCase();
  if (!pendingStores.has(key)) pendingStores.set(key, new PendingActionStore(chrome.storage.local, key));
  return pendingStores.get(key);
}

async function renderPendingSaves() {
  const request = ++saveStatusRequest;
  if (!account || signedOut) {
    $("#save-warning").textContent = "";
    $("#retry-saves").hidden = true;
    return;
  }
  try {
    const records = await storeFor(account).list();
    if (request !== saveStatusRequest) return;
    const failures = records.filter(record => record.error);
    $("#save-warning").textContent = failures.length
      ? ` · ${failures.length} unsaved action${failures.length === 1 ? "" : "s"}: ${failures[0].error}`
      : records.length ? ` · Saving ${records.length} action${records.length === 1 ? "" : "s"}…` : "";
    $("#retry-saves").hidden = records.length === 0;
    $("#retry-saves").textContent = `Retry unsaved actions (${records.length})`;
  } catch (error) { showError(`Could not read unsaved actions: ${error.message}`); }
}

async function persistAction(action) {
  try {
    await storeFor(action.account).save(action);
    void renderPendingSaves();
  } catch (error) {
    showError(`Could not save “${action.event.summary || "event"}” locally: ${error.message}. The event was not changed.`);
    throw error;
  }
}

async function retrySavedActions(manual = false) {
  if (retryingSaves || !account || signedOut) return;
  retryingSaves = true;
  try {
    const records = await storeFor(account).list();
    const retries = records.filter(record => manual || record.retryable);
    await Promise.all(retries.map(record => undo.retry(record.action)));
  } catch (error) { showError(`Could not retry saved actions: ${error.message}`); }
  finally { retryingSaves = false; void renderPendingSaves(); }
}

function currentVisibleEvents() {
  const visible = withoutDismissals(events, dismissals, calendarZone);
  const searched = searchActive && searchQueryInput.value.trim()
    ? visible.filter((event) => (event.summary || "").toLowerCase().includes(searchQueryInput.value.trim().toLowerCase()))
    : visible;
  return realEventsOnly ? searched.filter((event) => isEmphasized(event, account)) : searched;
}

function renderSync() {
  const status = { ...syncState, error: [syncState.error, statusStorageError &&
    `Could not save sync status in this browser: ${statusStorageError}`].filter(Boolean).join("; ") || null };
  const headline = syncHeadline(status);
  const ready = shouldShowSyncStatus(syncAttempted, loading, signedOut, account);
  $("#sync-warning").textContent = ready && headline !== "Synced just now" ? ` · ${headline}` : "";
  $("#sync-open").hidden = !ready;
  $("#sync-menu-label").textContent = headline === "Synced just now" ? "Synced just now" : "Sync issues";
  $("#sync-open").classList.toggle("has-issues", headline !== "Synced just now");
  $("#sync-detail").textContent = `${headline}\n${syncDetail(status)}`;
}

async function renderRecentDismissals() {
  const list = $("#recent-dismissals-list");
  const recent = recentDismissals(dismissals);
  list.replaceChildren();
  if (!recent.length) {
    list.textContent = "No dismissals recorded yet.";
    return;
  }
  const titleByKey = new Map(events.map((event) => [eventKey(event), event.summary || "(Untitled event)"]));
  const cached = await chrome.storage.local.get(`cachedEvents:${account.toLowerCase()}`).catch(() => ({}));
  for (const event of cached[`cachedEvents:${account.toLowerCase()}`]?.events || []) {
    titleByKey.set(eventKey(event), event.summary || "(Untitled event)");
  }
  for (const record of recent) {
    const row = document.createElement("div");
    row.className = "recent-dismissal";
    const title = document.createElement("span");
    title.textContent = record.title || titleByKey.get(dismissalKey(record.eventId, record.start)) ||
      "Title unavailable for older dismissal";
    const time = document.createElement("small");
    time.textContent = new Date(record.dismissed).toLocaleString();
    row.append(title, time);
    list.append(row);
    if (!record.title && !titleByKey.has(dismissalKey(record.eventId, record.start))) {
      try {
        const fetched = await dismissedEventTitle(account, record.eventId);
        if (fetched) title.textContent = fetched;
      } catch { /* Older or deleted events may no longer be readable from Calendar. */ }
    }
  }
}

function renderRecentMoves() {
  const list = $("#recent-moves-list");
  list.replaceChildren();
  if (!moves.length) {
    list.textContent = "No moves recorded yet.";
    return;
  }
  for (const record of moves) {
    const row = document.createElement("div");
    row.className = "recent-dismissal";
    const title = document.createElement("span");
    title.textContent = record.title;
    const time = document.createElement("small");
    time.textContent = `Moved to ${new Date(record.to).toLocaleString()} · ${new Date(record.moved).toLocaleString()}`;
    row.append(title, time);
    list.append(row);
  }
}

function renderWindowLabel() {
  $("#preset-label").textContent = windowPreset === "current" || (!windowPreset && lookbackDays === 7 && lookaheadDays === 0)
    ? "Current: 7 days back to today"
    : windowPreset ? WINDOW_PRESETS[windowPreset].label
    : `Custom: ${lookbackDays} days back, ${lookaheadDays} ahead`;
}

async function saveSyncState() {
  delete syncState.history;
  statusStorageError = await persistSyncState(chrome.storage.local, account, syncState);
  renderSync();
}
const openEventOnce = createOpenGuard(async (url) => {
  await undo.commit();
  await openInBrowser(chrome, url);
});

function showError(message) { notice.textContent = message; }
function showInfo(message) { info.textContent = message; }
function showPullProgress(distance, ready) {
  if (refreshBusy) return;
  pullIndicator.hidden = distance <= 0;
  pullIndicator.textContent = ready ? "Release to refresh" : "Pull down to refresh";
}
async function refreshEvents() {
  if (!account || signedOut) {
    showError("Connect Google Calendar before refreshing.");
    return;
  }
  if (refreshBusy || loading) return;
  refreshBusy = true;
  pullIndicator.hidden = false;
  pullIndicator.textContent = "Refreshing…";
  try {
    await undo.commit();
    await load();
  } catch (error) {
    showError(`Could not refresh Calendar: ${error.message}`);
  } finally {
    refreshBusy = false;
    pullIndicator.hidden = true;
  }
}
function showStorageEstimate(message, isError = false, expires = true) {
  clearTimeout(storageEstimateTimer);
  if (storageEstimateNode?.textContent === storageEstimateMessage) storageEstimateNode.textContent = "";
  storageEstimateNode = isError ? notice : info;
  storageEstimateMessage = message;
  storageEstimateNode.textContent = message;
  if (expires) {
    storageEstimateTimer = setTimeout(() => {
      if (storageEstimateNode?.textContent === storageEstimateMessage) storageEstimateNode.textContent = "";
      storageEstimateMessage = undefined;
      storageEstimateNode = undefined;
    }, 30_000);
  }
}
function eventKey(event) { return dismissalKey(event.id, eventStartMs(event, calendarZone)); }

function updateHeaderClock() {
  accountClock.textContent = account ? headerClockLabel(new Date()) : "";
}

function applySkin() {
  const root = document.documentElement;
  const preset = skinPresets[skinName] || skinPresets.Green;
  root.style.setProperty("--dot-color", preset[darkMode ? 0 : 1]);
  root.style.setProperty("--emphasized-bg", preset[darkMode ? 2 : 3]);
  root.style.setProperty("--dismiss-bg", preset[darkMode ? 2 : 3]);
}

function scheduleHeaderClock() {
  clearTimeout(clockTimer);
  updateHeaderClock();
  renderSync();
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

function openEventLink(event, kind = "view") {
  const action = calendarEventAction(event, kind);
  if (!action) {
    showError("Google Calendar did not provide a valid event link.");
    return;
  }
  void openEventOnce(action.url).catch((error) => showError(`Could not open event: ${error.message}`));
}

function closeMenu() {
  menu.hidden = true;
  menuToggle.setAttribute("aria-expanded", "false");
}

function showFlyout(row, flyout, trigger) {
  if (openFlyoutRow === row) return;
  if (openFlyoutRow) hideFlyout(openFlyoutRow);
  openFlyoutRow = row;
  openFlyout = flyout;
  openFlyoutTrigger = trigger;
  row.classList.add("flyout-open");
  trigger.setAttribute("aria-expanded", "true");
  const wide = window.matchMedia("(min-width: 640px)").matches;
  const orderKey = wide ? "wideOrder" : "compactOrder";
  flyout.replaceChildren(...Array.from(flyout.children).sort((a, b) =>
    Number(a.dataset[orderKey]) - Number(b.dataset[orderKey])));
  // Overlay the ribbon without changing the row or its title wrapping.
  const bounds = trigger.getBoundingClientRect();
  document.body.append(flyout);
  flyout.classList.add("active");
  flyout.style.left = `${Math.max(4, bounds.left - flyout.getBoundingClientRect().width - 8)}px`;
  flyout.style.top = `${bounds.top + bounds.height / 2}px`;
}

function hideFlyout(row) {
  if (openFlyoutRow !== row) return;
  const flyout = openFlyout;
  const trigger = openFlyoutTrigger;
  openFlyoutRow = undefined;
  openFlyout = undefined;
  openFlyoutTrigger = undefined;
  row.classList.remove("flyout-open");
  trigger?.setAttribute("aria-expanded", "false");
  flyout?.classList.remove("active");
  // State is cleared before reparenting because a focused button can fire focusout.
  if (flyout && row.isConnected) trigger.parentElement.append(flyout);
}

async function load(interactive = false) {
  if (loading || (signedOut && !interactive)) return;
  loading = true;
  renderSync();
  showError("");
  count.textContent = "Loading…";
  try {
    const calendar = await primaryCalendar(interactive);
    account = calendar.id;
    calendarZone = calendar.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localState = await chrome.storage.local.get(`syncState:${account.toLowerCase()}`);
    syncState = { ...syncState, ...(localState[`syncState:${account.toLowerCase()}`] || {}) };
    accountLabel.textContent = account;
    scheduleHeaderClock();
    connectPanel.hidden = true;
    if (interactive) {
      signedOut = false;
      await chrome.storage.local.set({ signedOut: false });
      showInfo("");
    }
    const recent = await recentEvents(account, lookbackDays, lookaheadDays, windowPreset);
    events = recent.events.filter((event) => {
      const start = eventStartMs(event, calendarZone);
      return Number.isFinite(start) && start >= recent.first && start < recent.lastExclusive;
    }).sort((a, b) => compareEvents(a, b));
    syncState.calendarAt = Date.now();
    syncState.error = null;
    await chrome.storage.local.set({ lastAccount: account });
    try { await chrome.storage.local.set({ [`cachedEvents:${account.toLowerCase()}`]: { events, zone: calendarZone } }); }
    catch (cacheError) { showError(`Could not update offline event cache: ${cacheError.message}`); }
    await saveSyncState();
    try {
      const localDismissals = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
      const localKeys = new Set((localDismissals[`dismissals:${account.toLowerCase()}`] || [])
        .map((record) => dismissalKey(record.eventId, record.start)));
      const hadPending = syncState.pending?.length > 0;
      dismissals = await syncDismissals(account);
      syncState.remoteNewer = dismissals.some((record) => !localKeys.has(dismissalKey(record.eventId, record.start)));
      syncState.conflictResolved = hadPending && syncState.remoteNewer;
      syncState.pending = [];
      syncState.dismissalAt = Date.now();
      await saveSyncState();
    } catch (error) {
      const saved = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
      dismissals = saved[`dismissals:${account.toLowerCase()}`] || [];
      showError(`Drive dismissal sync failed: ${error.message}. Local dismissals are still shown.`);
      syncState.error = error.message;
      await saveSyncState();
    }
    try {
      moves = await syncRecentMoves(account);
    } catch (error) {
      const savedMoves = await chrome.storage.local.get(`moves:${account.toLowerCase()}`);
      moves = savedMoves[`moves:${account.toLowerCase()}`] || [];
      const moveWarning = `Recent moves are saved in this browser, but Drive sync failed: ${error.message}`;
      showError([notice.textContent, moveWarning].filter(Boolean).join("\n"));
      syncState.error = [syncState.error, `Move history sync failed: ${error.message}`]
        .filter(Boolean).join("; ");
      await saveSyncState();
    }
    render();
  } catch (error) {
    showError(`Could not load Calendar: ${error.message}`);
    syncState.error = error.message;
    await saveSyncState();
    if (!account) connectPanel.hidden = false;
    render();
  } finally {
    loading = false;
    syncAttempted = true;
    renderSync();
    void retrySavedActions();
  }
}

function render() { renderGuard.request(); }

function renderNow() {
  const previousScroll = list.scrollTop;
  if (openFlyoutRow) hideFlyout(openFlyoutRow);
  list.replaceChildren();
  const filtered = currentVisibleEvents();
  count.textContent = `${filtered.length} event${filtered.length === 1 ? "" : "s"}`;
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = !account ? "Connect Google Calendar to load events."
      : searchActive && searchQueryInput.value.trim() ? "No loaded events match this search."
      : realEventsOnly ? "No real events in this range."
      : "No events in the selected lookback and lookahead range.";
    list.append(empty);
  } else {
    const firstFutureIndex = filtered.findIndex((event) => isFutureEvent(event));
    filtered.forEach((event, index) => {
      if (index === firstFutureIndex) {
        const divider = document.createElement("div");
        divider.className = "later-divider";
        divider.setAttribute("role", "separator");
        divider.setAttribute("aria-label", "Later events");
        divider.textContent = "Later";
        list.append(divider);
      }
      list.append(renderEvent(event));
    });
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
  const results = realEventsOnly
    ? remoteSearch.events.filter((event) => isEmphasized(event, account))
    : remoteSearch.events;
  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "search-heading";
    empty.textContent = realEventsOnly ? "No real Calendar events match this search." : "No Calendar events match this search.";
    list.append(empty);
  }
  for (const event of results) {
    const row = document.createElement("div");
    row.className = "search-result";
    if (isEmphasized(event, account)) row.classList.add("emphasized");
    const titleLine = document.createElement("div");
    titleLine.className = "title-line";
    if (isTwoDaysOld(event, calendarZone)) {
      const dot = document.createElement("span");
      dot.className = "old-dot";
      dot.setAttribute("aria-label", "At least two days old");
      titleLine.append(dot);
    }
    const title = document.createElement("a");
    title.className = "title";
    title.href = calendarEventAction(event)?.url || "#";
    title.textContent = event.summary || "(Untitled event)";
    title.title = title.textContent;
    title.addEventListener("click", (click) => { click.preventDefault(); openEventLink(event); });
    const date = document.createElement("small");
    date.textContent = event.start?.date
      ? `${event.start.date} · all day`
      : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start.dateTime));
    titleLine.append(title);
    row.append(titleLine, date);
    if (event.location) {
      const location = document.createElement("a");
      location.className = "location";
      location.textContent = event.location;
      location.href = locationHref(event.location);
      location.title = event.location;
      location.addEventListener("click", (click) => {
        click.preventDefault();
        void openInBrowser(chrome, location.href)
          .catch((error) => showError(`Could not open location: ${error.message}`));
      });
      row.append(location);
    }
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
  if (isEmphasized(event, account)) row.classList.add("emphasized");
  const action = undo.current?.event.id === event.id ? undo.current : null;
  const busy = committing.has(eventKey(event)) || [...undo.committingActions].some(action => action.event.id === event.id);
  if (action) row.classList.add("pending");
  if (busy) row.classList.add("busy");
  const top = document.createElement("div");
  top.className = "event-top";
  const details = document.createElement("div");
  details.className = "details";
  const title = document.createElement(action || busy ? "span" : "a");
  title.className = "title";
  title.textContent = event.summary || "(Untitled event)";
  title.title = title.textContent;
  if (!action && !busy) {
    title.href = calendarEventAction(event)?.url || "#";
    title.addEventListener("click", (click) => {
      click.preventDefault();
      openEventLink(event);
    });
  }
  const age = document.createElement("div");
  age.className = "age";
  age.textContent = action ? actionDescription(action)
    : busy ? "Committing action…" : eventAgeLabel(event, Date.now(), calendarZone);
  const titleLine = document.createElement("div");
  titleLine.className = "title-line";
  if (isTwoDaysOld(event, calendarZone)) {
    const dot = document.createElement("span");
    dot.className = "old-dot";
    dot.setAttribute("aria-label", "At least two days old");
    titleLine.append(dot);
  }
  titleLine.append(title);
  details.append(titleLine, age);
  if (!action && !busy && event.location) {
    const location = document.createElement("a");
    location.className = "location";
    location.textContent = event.location;
    location.title = event.location;
    location.href = locationHref(event.location);
    location.addEventListener("click", (click) => {
      click.preventDefault();
      void undo.commit().then(() => openInBrowser(chrome, location.href))
        .catch((error) => showError(`Could not open location: ${error.message}`));
    });
    details.append(location);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  let flyoutTrigger;
  if (action) {
    const undoTile = button("Undo",
      `Undo pending action for ${event.summary || "event"}`,
      () => { void undo.undo(); }, "tile undo");
    actions.append(undoTile);
  } else if (busy) {
    const saving = button("Saving", "Saving this event in the background", () => {}, "tile saving");
    saving.disabled = true;
    actions.append(saving);
  } else {
    if (isRecurring(event)) {
      actions.append(button("✎", "Edit recurring occurrence in Google Calendar", () => openEventLink(event, "edit"), "tile primary"));
      actions.append(button("✓", "Dismiss only this occurrence in this app", () => void stageAction(event, "dismiss"), "tile danger"));
    } else {
    flyoutTrigger = moveTile(event, "1D", { days: 1 }, "tile primary");
    flyoutTrigger.setAttribute("aria-haspopup", "true");
    flyoutTrigger.setAttribute("aria-expanded", "false");
    flyoutTrigger.addEventListener("pointerenter", () => showFlyout(row, flyout, flyoutTrigger));
    flyoutTrigger.addEventListener("focus", () => showFlyout(row, flyout, flyoutTrigger));
    flyoutTrigger.addEventListener("keydown", (key) => {
      if (key.key === "Tab" && !key.shiftKey || key.key === "ArrowDown") {
        key.preventDefault();
        showFlyout(row, flyout, flyoutTrigger);
        flyout.querySelector("button:not(:disabled)")?.focus();
      }
    });
    row.addEventListener("focusout", (event) => {
      if (!row.contains(event.relatedTarget) && !flyout.contains(event.relatedTarget)) hideFlyout(row);
    });
    actions.append(flyoutTrigger);
    }
  }
  top.append(details, actions);
  row.append(top);
  if (action || busy || isRecurring(event)) return row;
  const flyout = document.createElement("div");
  flyout.className = "flyout";
  const topRow = document.createElement("div");
  const bottomRow = document.createElement("div");
  topRow.className = bottomRow.className = "tile-row";
  const calendarTile = button("📅", "Choose a date", () => {
    void undo.commit();
    dateTarget = event;
    datePicker.value = "";
    const eventTime = new Date(event.start.dateTime || 0);
    timePicker.value = event.start.date ? "" : `${String(eventTime.getHours()).padStart(2, "0")}:${String(eventTime.getMinutes()).padStart(2, "0")}`;
    timePicker.hidden = true;
    timeToggle.hidden = !!event.start.date;
    timeToggle.setAttribute("aria-label", `Choose move time${event.start.date ? "" : `, initially ${eventTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}`);
    calendarDialog.showModal();
    try { datePicker.showPicker(); }
    catch { datePicker.focus(); }
  });
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
  topRow.append(calendarTile);
  topRow.append(button("✓", "Dismiss event in this app", () => void stageAction(event, "dismiss"), "tile danger"));
  for (const days of [2, 3, 4, 7]) {
    bottomRow.append(moveTile(event, `${days}D`, { days }));
    if (days === 4) bottomRow.append(button("✎", "Edit event in Google Calendar", () => openEventLink(event, "edit")));
  }
  // Preserve the compact 5×2 sequence; put Pencil before Calendar on wide screens.
  const wideOrder = [0, 1, 2, 4, 5, 6, 7, 8, 3, 9];
  [...topRow.children, ...bottomRow.children].forEach((tile, index) => {
    tile.dataset.compactOrder = index;
    tile.dataset.wideOrder = wideOrder[index];
    flyout.append(tile);
  });
  flyout.addEventListener("focusout", (event) => {
    if (!flyout.contains(event.relatedTarget) && !row.contains(event.relatedTarget)) hideFlyout(row);
  });
  flyout.addEventListener("keydown", (key) => {
    if (key.key === "Tab" && key.shiftKey && document.activeElement === flyout.querySelector("button:not(:disabled)")) {
      key.preventDefault();
      flyoutTrigger.focus();
    }
  });
  actions.append(flyout);
  return row;
}

async function stageAction(event, type, option) {
  if (undo.current?.event.id === event.id || [...undo.committingActions].some(action => action.event.id === event.id)) return;
  showError("");
  if (type === "move" && isRecurring(event)) {
    showError("Recurring events can only be dismissed or edited in Google Calendar.");
    return;
  }
  try {
    const stagedAtMs = Date.now();
    const destination = type === "move" ? shiftEvent(event, option, new Date(stagedAtMs)) : undefined;
    await undo.stage({ id: crypto.randomUUID(), account, event, type, option, stagedAtMs,
      destinationStart: destination?.start, destinationEnd: destination?.end });
  } catch (error) {
    showError(`Could not prepare action for “${event.summary || "(Untitled event)"}”: ${error.message}`);
  }
}

async function commitAction(action) {
  const { event } = action;
  const key = eventKey(event);
  let cacheWarning = "";
  let failed = false;
  let applied = false;
  let saveError;
  committing.add(key);
  render();
  try {
    if (action.type === "move") {
      const moved = await moveEvent(account, event.id, action.option, new Date(action.stagedAtMs), {
        start: action.destinationStart, end: action.destinationEnd, originalStart: event.start, originalEnd: event.end
      });
      applied = true;
      events = events.filter((item) => item.id !== event.id);
      const start = eventStartMs(moved, calendarZone);
      const bounds = displayWindow(Date.now(), lookbackDays, lookaheadDays, windowPreset);
      if (Number.isFinite(start) && start >= bounds.first && start < bounds.lastExclusive) {
        events.push(moved);
        events.sort((a, b) => compareEvents(a, b));
      }
      render();
      try { await chrome.storage.local.set({ [`cachedEvents:${account.toLowerCase()}`]: { events, zone: calendarZone } }); }
      catch (cacheError) { cacheWarning = `Move succeeded, but offline cache was not updated: ${cacheError.message}`; }
      if (eventStartMs(event, calendarZone) !== start) {
        try {
          moves = await saveRecentMove(account, {
            id: action.id, eventId: event.id, title: event.summary || "(Untitled event)",
            from: eventStartMs(event, calendarZone), to: start, moved: Date.now()
          });
          if (syncState.error?.startsWith("Move history sync failed:")) {
            syncState.error = null;
            try { await saveSyncState(); }
            catch (statusError) {
              const warning = `Event moved, but sync status could not be saved: ${statusError.message}`;
              cacheWarning = cacheWarning ? `${cacheWarning} ${warning}` : warning;
            }
          }
        } catch (historyError) {
          const storedMoves = await chrome.storage.local.get(`moves:${account.toLowerCase()}`).catch(() => ({}));
          moves = storedMoves[`moves:${account.toLowerCase()}`] || moves;
          const historyWarning = `Event moved, but recent move history could not sync: ${historyError.message}`;
          cacheWarning = cacheWarning ? `${cacheWarning} ${historyWarning}` : historyWarning;
          syncState.error = `Move history sync failed: ${historyError.message}`;
          try { await saveSyncState(); }
          catch { /* The move and its local history remain successful. */ }
        }
      }
    } else {
      dismissals = await saveDismissal(account, {
        eventId: event.id, start: eventStartMs(event, calendarZone), dismissed: Date.now(),
        title: event.summary || "(Untitled event)"
      });
      applied = true;
      syncState.pending = (syncState.pending || []).filter((item) => item !== key);
      syncState.dismissalAt = Date.now();
      if (!syncState.error?.startsWith("Move history sync failed:")) syncState.error = null;
      await saveSyncState();
    }
    showError(cacheWarning);
  } catch (error) {
    failed = true;
    saveError = error;
    if (action.type === "dismiss") {
      const stored = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
      dismissals = stored[`dismissals:${account.toLowerCase()}`] || dismissals;
      const savedLocally = dismissals.some((record) => dismissalKey(record.eventId, record.start) === key);
      if (savedLocally) applied = true;
      if (savedLocally) {
        syncState.pending = [...new Set([...(syncState.pending || []), key])];
        syncState.error = error.message;
        await saveSyncState();
      }
      showError(savedLocally
        ? `Dismissal of “${event.summary || "(Untitled event)"}” was saved locally, but Drive sync failed: ${error.message}`
        : `Could not dismiss “${event.summary || "(Untitled event)"}”: ${error.message}`);
    } else {
      showError(`Could not move “${event.summary || "(Untitled event)"}”: ${error.message}`);
    }
  } finally {
    try {
      if (applied) await storeFor(action.account).remove(action.id);
      else if (saveError) await storeFor(action.account).fail(action, saveError);
    } catch (error) { showError(`Could not update the local save queue: ${error.message}`); }
    void renderPendingSaves();
    committing.delete(key);
    render();
  }
  return !failed;
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
  windowPreset = null;
  renderWindowLabel();
  $("#lookback-label").textContent = `${days} days`;
  await chrome.storage.local.set({ lookbackDays: days, windowPreset: null });
  await load();
}

async function changeLookahead(days) {
  if (!Number.isInteger(days) || days < 0 || days > 36500) {
    showError("Choose 0–36500 days.");
    return;
  }
  await undo.commit();
  lookaheadDialog.close();
  lookaheadDays = days;
  windowPreset = null;
  renderWindowLabel();
  $("#lookahead-label").textContent = `${days} days`;
  await chrome.storage.local.set({ lookaheadDays: days, windowPreset: null });
  await load();
}

async function logout() {
  storageEstimateRequest++;
  clearTimeout(storageEstimateTimer);
  await undo.commit();
  try {
    await chrome.identity.clearAllCachedAuthTokens();
    await chrome.storage.local.set({ signedOut: true });
    signedOut = true;
    account = undefined;
    scheduleHeaderClock();
    events = [];
    dismissals = [];
    moves = [];
    remoteSearch = undefined;
    remoteSearchRequest++;
    accountLabel.textContent = "Not connected";
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
  void refreshEvents();
});
function updateWindowToggle(mode) {
  const label = mode === "normal" ? "Move back to extension window" : "Open in Chrome tab";
  $("#open-in-tab").title = label;
  $("#open-in-tab").setAttribute("aria-label", label);
}
void managerWindowMode(chrome).then(updateWindowToggle).catch(() => {});
$("#open-in-tab").addEventListener("click", async () => {
  const button = $("#open-in-tab");
  button.disabled = true;
  try { updateWindowToggle(await toggleManagerWindow(chrome)); }
  catch (error) { showError(`Could not move manager window: ${error.message}`); }
  finally { button.disabled = false; }
});
$("#retry-saves").addEventListener("click", () => { closeMenu(); void retrySavedActions(true); });
$("#header-refresh").addEventListener("click", () => { void refreshEvents(); });
// Repainting the list during a press detaches the target and Chrome drops its click.
document.addEventListener("pointerdown", (event) => {
  if (event.button === 0 && event.target.closest(".event button, .flyout button")) renderGuard.begin(event.pointerId);
}, true);
window.addEventListener("pointerup", (event) => renderGuard.end(event.pointerId), true);
window.addEventListener("pointercancel", (event) => renderGuard.end(event.pointerId), true);
window.addEventListener("blur", () => renderGuard.release());
const canPullRefresh = () => list.scrollTop <= 0 && !loading && !refreshBusy && !!account && !signedOut;
const pullGesture = new PullRefreshGesture(showPullProgress, () => { void refreshEvents(); });
list.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("button, input, textarea, select")) return;
  pullGesture.start(event.pointerId, event.clientY, canPullRefresh());
});
window.addEventListener("pointermove", (event) => {
  const distance = pullGesture.move(event.pointerId, event.clientY, canPullRefresh());
  if (distance > 8) {
    event.preventDefault();
    list.classList.add("pulling");
    suppressNextClick = true;
  }
});
window.addEventListener("pointerup", (event) => {
  pullGesture.end(event.pointerId, canPullRefresh());
  list.classList.remove("pulling");
  setTimeout(() => { suppressNextClick = false; }, 0);
});
window.addEventListener("pointercancel", () => {
  pullGesture.cancel();
  list.classList.remove("pulling");
  suppressNextClick = false;
});
window.addEventListener("blur", () => {
  pullGesture.cancel();
  list.classList.remove("pulling");
  suppressNextClick = false;
});
list.addEventListener("dragstart", (event) => {
  if (list.classList.contains("pulling")) event.preventDefault();
});
list.addEventListener("click", (event) => {
  if (!suppressNextClick) return;
  suppressNextClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
list.addEventListener("wheel", (event) => {
  clearTimeout(wheelResetTimer);
  if (!canPullRefresh() || event.deltaY >= 0) {
    pullGesture.wheel(event.deltaY, false);
    return;
  }
  event.preventDefault();
  pullGesture.wheel(event.deltaY, true);
  wheelResetTimer = setTimeout(() => pullGesture.cancelWheel(), 800);
}, { passive: false });
$("#real-events-toggle").addEventListener("click", () => {
  void undo.commit();
  realEventsOnly = !realEventsOnly;
  const toggle = $("#real-events-toggle");
  toggle.setAttribute("aria-pressed", String(realEventsOnly));
  toggle.title = realEventsOnly ? "Show all events" : "Show real events only";
  toggle.setAttribute("aria-label", toggle.title);
  render();
});
$("#logout").addEventListener("click", () => { closeMenu(); void logout(); });
$("#sync-open").addEventListener("click", () => { closeMenu(); syncDialog.showModal(); });
$("#sync-close").addEventListener("click", () => syncDialog.close());
$("#recent-dismissals-open").addEventListener("click", () => {
  closeMenu();
  recentDismissalsDialog.showModal();
  void renderRecentDismissals().catch((error) => {
    $("#recent-dismissals-list").textContent = `Could not load recent dismissals: ${error.message}`;
  });
});
$("#recent-dismissals-close").addEventListener("click", () => recentDismissalsDialog.close());
$("#recent-moves-open").addEventListener("click", () => {
  closeMenu();
  renderRecentMoves();
  recentMovesDialog.showModal();
});
$("#recent-moves-close").addEventListener("click", () => recentMovesDialog.close());
$("#presets-open").addEventListener("click", () => { closeMenu(); presetsDialog.showModal(); });
$("#presets-cancel").addEventListener("click", () => presetsDialog.close());
for (const [id, preset] of Object.entries(WINDOW_PRESETS)) {
  const choice = button(preset.label, preset.label, () => void (async () => {
    await undo.commit();
    windowPreset = id;
    lookbackDays = preset.back;
    lookaheadDays = preset.ahead;
    renderWindowLabel();
    $("#lookback-label").textContent = `${lookbackDays} days`;
    $("#lookahead-label").textContent = `${lookaheadDays} days`;
    await chrome.storage.local.set({ windowPreset: id, lookbackDays, lookaheadDays });
    presetsDialog.close();
    await load();
  })());
  $("#preset-choices").append(choice);
}
$("#lookback-open").addEventListener("click", () => {
  presetsDialog.close();
  void undo.commit();
  $("#custom-lookback").value = String(lookbackDays);
  lookbackDialog.showModal();
});
$("#lookahead-open").addEventListener("click", () => {
  presetsDialog.close();
  void undo.commit();
  $("#custom-lookahead").value = String(lookaheadDays);
  lookaheadDialog.showModal();
});
$("#estimate-storage").addEventListener("click", () => {
  closeMenu();
  const request = ++storageEstimateRequest;
  void (async () => {
    await undo.commit();
    if (!account) throw new Error("Reconnect Calendar before estimating storage.");
    showStorageEstimate("Counting events from the past year…", false, false);
    const result = await recentEvents(account, 365);
    const now = Date.now();
    const eventsInYear = result.events.filter((event) => {
      const start = eventStartMs(event, calendarZone);
      return Number.isFinite(start) && start >= result.first && start <= result.now;
    });
    const encoder = new TextEncoder();
    const bytes = eventsInYear.reduce((total, event) => total + encoder.encode(JSON.stringify({
      version: 2, eventId: event.id, start: eventStartMs(event, calendarZone), dismissed: now
    })).byteLength, 0);
    if (request === storageEstimateRequest) showStorageEstimate(`${eventsInYear.length} events in the past year. If every one were dismissed, their Drive record payloads would total ${bytes} bytes (${(bytes / 1024).toFixed(1)} KiB), plus Drive file metadata for each dismissal.`);
  })().catch((error) => {
    if (request === storageEstimateRequest) showStorageEstimate(`Could not estimate storage: ${error.message}`, true);
  });
});
$("#undo-time-open").addEventListener("click", () => {
  closeMenu();
  $("#undo-seconds").value = undo.undoSeconds;
  $("#undo-time-error").textContent = "";
  undoTimeDialog.showModal();
});
$("#undo-time-cancel").addEventListener("click", () => undoTimeDialog.close());
$("#undo-time-form").addEventListener("submit", async event => {
  event.preventDefault();
  const seconds = parseUndoSeconds($("#undo-seconds").value);
  if (seconds === null) {
    $("#undo-time-error").textContent = "Enter a whole number from 1 to 30.";
    $("#undo-seconds").focus();
    return;
  }
  try {
    await chrome.storage.local.set({ undoSeconds: seconds });
    undo.undoSeconds = seconds;
    $("#undo-time-label").textContent = `${seconds} seconds`;
    undoTimeDialog.close();
  } catch (error) { $("#undo-time-error").textContent = `Could not save Undo Time: ${error.message}`; }
});
$("#theme-toggle").addEventListener("click", () => {
  closeMenu();
  void undo.commit();
  darkMode = !darkMode;
  document.documentElement.classList.toggle("light", !darkMode);
  applySkin();
  $("#theme-toggle").textContent = `Dark mode: ${darkMode ? "On" : "Off"}`;
  void chrome.storage.local.set({ darkMode });
});
$("#skins-open").addEventListener("click", () => {
  closeMenu();
  void undo.commit();
  $("#skin-name").value = skinName;
  skinsDialog.showModal();
});
$("#skins-cancel").addEventListener("click", () => skinsDialog.close());
$("#skins-apply").addEventListener("click", () => {
  skinName = $("#skin-name").value;
  applySkin();
  skinsDialog.close();
  void chrome.storage.local.set({ skinName });
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
for (const choice of document.querySelectorAll("[data-ahead-days]")) {
  choice.addEventListener("click", () => void changeLookahead(Number(choice.dataset.aheadDays)));
}
$("#lookback-apply").addEventListener("click", () => void changeLookback(Number($("#custom-lookback").value)));
$("#lookback-cancel").addEventListener("click", () => lookbackDialog.close());
$("#lookahead-apply").addEventListener("click", () => void changeLookahead(Number($("#custom-lookahead").value)));
$("#lookahead-cancel").addEventListener("click", () => lookaheadDialog.close());
timeToggle.addEventListener("click", () => {
  timePicker.hidden = false;
  try { timePicker.showPicker(); }
  catch { timePicker.focus(); }
});
datePicker.addEventListener("change", () => {
  if (!datePicker.value || !dateTarget) return;
  const event = dateTarget;
  const date = datePicker.value;
  const time = timePicker.hidden ? "" : timePicker.value;
  calendarDialog.close();
  void stageAction(event, "move", time ? { date, time } : { date });
});
calendarDialog.addEventListener("close", () => { dateTarget = undefined; });
$("#connect").addEventListener("click", () => void load(true));
document.addEventListener("pointermove", (pointer) => {
  if (!openFlyoutRow || !openFlyout || !openFlyoutTrigger) return;
  if (!flyoutPointerInReach(pointer.clientX, pointer.clientY,
    openFlyoutTrigger.getBoundingClientRect(), openFlyout.getBoundingClientRect())) {
    hideFlyout(openFlyoutRow);
  }
});
document.addEventListener("pointerdown", (pointer) => {
  if (openFlyoutRow && !openFlyout?.contains(pointer.target) && !openFlyoutTrigger?.contains(pointer.target)) {
    hideFlyout(openFlyoutRow);
  }
});
document.addEventListener("keydown", (key) => {
  if (key.key === "Escape" && openFlyoutRow) {
    openFlyoutTrigger?.focus();
    hideFlyout(openFlyoutRow);
  }
});
list.addEventListener("scroll", () => { if (openFlyoutRow) hideFlyout(openFlyoutRow); });
window.addEventListener("resize", () => { if (openFlyoutRow) hideFlyout(openFlyoutRow); });
window.addEventListener("blur", () => { void undo.commit(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) void undo.commit(); });
window.addEventListener("focus", () => {
  updateHeaderClock();
  renderSync();
  if (account && !loading && !undo.current && committing.size === 0 && undo.committingActions.size === 0 && !lookbackDialog.open && !lookaheadDialog.open && !presetsDialog.open && !syncDialog.open && !undoTimeDialog.open && !recentDismissalsDialog.open && !recentMovesDialog.open && !calendarDialog.open && !dateTarget) void load();
});
window.addEventListener("online", () => {
  renderSync();
  void retrySavedActions().then(() => {
    if (account && !signedOut && !loading && !undo.current && committing.size === 0 && undo.committingActions.size === 0) void load();
  });
});
const saved = await chrome.storage.local.get(["lookbackDays", "lookaheadDays", "windowPreset", "darkMode", "signedOut", "skinName", "lastAccount", "undoSeconds"]);
if (saved.lastAccount) {
  const key = `syncState:${saved.lastAccount.toLowerCase()}`;
  const stored = (await chrome.storage.local.get(key))[key];
  if (stored && Object.hasOwn(stored, "history")) {
    const { history: _discarded, ...withoutHistory } = stored;
    await chrome.storage.local.set({ [key]: withoutHistory });
  }
}
undo.undoSeconds = parseUndoSeconds(saved.undoSeconds) ?? DEFAULT_UNDO_SECONDS;
$("#undo-time-label").textContent = `${undo.undoSeconds} seconds`;
lookbackDays = Number.isInteger(saved.lookbackDays) && saved.lookbackDays >= 1 && saved.lookbackDays <= 365 ? saved.lookbackDays : 7;
lookaheadDays = Number.isInteger(saved.lookaheadDays) && saved.lookaheadDays >= 0 && saved.lookaheadDays <= 36500 ? saved.lookaheadDays : 0;
windowPreset = WINDOW_PRESETS[saved.windowPreset] ? saved.windowPreset : null;
renderWindowLabel();
darkMode = saved.darkMode !== false;
skinName = skinPresets[saved.skinName] ? saved.skinName : "Green";
applySkin();
signedOut = saved.signedOut === true;
document.documentElement.classList.toggle("light", !darkMode);
$("#theme-toggle").textContent = `Dark mode: ${darkMode ? "On" : "Off"}`;
$("#lookback-label").textContent = `${lookbackDays} days`;
$("#lookahead-label").textContent = `${lookaheadDays} days`;
if (signedOut) {
  connectPanel.hidden = false;
  showInfo("Disconnected. Connect this Chrome profile to load your primary Calendar.");
  render();
} else {
  if (saved.lastAccount) {
    account = saved.lastAccount;
    const offlineCache = await chrome.storage.local.get([
      `cachedEvents:${account.toLowerCase()}`, `dismissals:${account.toLowerCase()}`,
      `moves:${account.toLowerCase()}`, `syncState:${account.toLowerCase()}`
    ]);
    const cached = offlineCache[`cachedEvents:${account.toLowerCase()}`];
    events = cached?.events || [];
    calendarZone = cached?.zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    dismissals = offlineCache[`dismissals:${account.toLowerCase()}`] || [];
    moves = offlineCache[`moves:${account.toLowerCase()}`] || [];
    syncState = { ...syncState, ...(offlineCache[`syncState:${account.toLowerCase()}`] || {}) };
    accountLabel.textContent = account;
    scheduleHeaderClock();
    render();
    renderSync();
  }
  void load();
}
