import { readTasks, taskNoteUrl } from "./tasks.js";
import { eventAgeLabel, isFutureEvent, dismissalKey, eventStartMs, locationHref, isTwoDaysOld, isEmphasized, isRecurring, compareEvents, compareSearchEvents, displayWindow, WINDOW_PRESETS, recentDismissals, shiftEvent, withoutDismissals } from "./model.js";
import { primaryCalendar, recentEvents, moveEvent, syncDismissals, saveDismissal, searchPrimaryCalendar, dismissedEventTitle, syncRecentMoves, saveRecentMove, googleRequest, completeTask } from "./google.js";
import { UndoController, actionDescription, parseUndoSeconds, DEFAULT_UNDO_SECONDS } from "./undo.js";
import { InteractionRenderGuard } from "./render-guard.js";
import { PendingActionStore } from "./pending-actions.js";
import { headerClockLabel, moveTooltip } from "./clock.js";
import { calendarEventAction, createOpenGuard, managerWindowMode, toggleManagerWindow, openWithBackgroundSave } from "./open.js";
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
let renderedItemLimit = 100;
let moreItemsObserver;
let lastUndoLoadedAccount;
let lastUndoWrite = Promise.resolve();
const renderGuard = new InteractionRenderGuard(renderNow);

const undo = new UndoController(commitAction, () => {
  rememberLastUndo();
  render();
}, undefined, undefined, undefined, persistAction, revertAction);

function rememberLastUndo() {
  if (!account || lastUndoLoadedAccount !== account.toLowerCase()) return;
  const key = `lastUndo:${account.toLowerCase()}`;
  const snapshot = undo.latestAction ? structuredClone(undo.latestAction) : null;
  lastUndoWrite = lastUndoWrite.then(() => chrome.storage.local.set({ [key]: snapshot }))
    .catch(error => showError(`Could not remember header Undo: ${error.message}`));
}

async function restoreLastUndo() {
  const selected = account.toLowerCase();
  if (lastUndoLoadedAccount === selected) return;
  await lastUndoWrite;
  const key = `lastUndo:${selected}`;
  const saved = await chrome.storage.local.get(key);
  undo.latestAction = saved[key] || null;
  lastUndoLoadedAccount = selected;
}

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
    if (undo.reverting) return;
    const retries = records.filter(record => manual || record.retryable);
    await Promise.all(retries.map(record => undo.retry(record.action)));
  } catch (error) { showError(`Could not retry saved actions: ${error.message}`); }
  finally { retryingSaves = false; void renderPendingSaves(); }
}

function currentVisibleEvents() {
  const hidden = new Set([...undo.committingActions].map(action => action.event.id));
  const visible = withoutDismissals(events, dismissals, calendarZone).filter(event => !hidden.has(event.id));
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
const openLink = (url) => openWithBackgroundSave(chrome, url, () => undo.commit(),
  (error) => showError(`Could not save pending action: ${error.message}`));
const openEventOnce = createOpenGuard(openLink);

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

async function load(interactive = false) {
  if (loading || (signedOut && !interactive)) return;
  loading = true;
  renderSync();
  showError("");
  count.textContent = "Loading…";
  try {
    const calendar = await primaryCalendar(interactive);
    account = calendar.id;
    await restoreLastUndo();
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
    let taskWarning = "";
    let tasks = [];
    try { tasks = await readTasks(googleRequest); }
    catch (error) { taskWarning = `Events loaded, but Tasks could not load: ${error.message}. Enable Google Tasks API and reconnect to grant Tasks access.`; showError(taskWarning); }
    events = [...recent.events, ...tasks].filter((event) => {
      if (event.task?.due === null) return true;
      const start = eventStartMs(event, calendarZone);
      return Number.isFinite(start) && start >= recent.first && start < recent.lastExclusive;
    }).sort((a, b) => compareEvents(a, b));
    syncState.calendarAt = Date.now();
    syncState.error = taskWarning || null;
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
  const latest = undo.latestAction;
  $("#header-undo").disabled = !latest || undo.reverting;
  $("#header-undo").title = latest ? `Undo: ${latest.event.summary || "event"}` : "Undo last action";
  $("#header-undo").setAttribute("aria-label", $("#header-undo").title);
  const previousScroll = list.scrollTop;
  moreItemsObserver?.disconnect();
  moreItemsObserver = null;
  list.replaceChildren();
  const filtered = currentVisibleEvents();
  count.textContent = `${filtered.length} item${filtered.length === 1 ? "" : "s"}`;
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
    filtered.slice(0, renderedItemLimit).forEach((event, index) => {
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
  if (filtered.length > renderedItemLimit) {
    appendMoreItems();
  }
  if (searchActive) renderSearchFooter();
  list.scrollTop = previousScroll;
}

function appendMoreItems() {
  const more = button("Show next 100", "Show the next 100 events and tasks", () => { renderedItemLimit += 100; render(); }, "search-calendar");
  more.classList.add("load-more-items");
  list.append(more);
  moreItemsObserver ||= new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting && entry.target.isConnected)) { moreItemsObserver.disconnect(); renderedItemLimit += 100; render(); }
  }, {root:list, rootMargin:"0px 0px 200px 0px"});
  moreItemsObserver.observe(more);
}

function renderSearchFooter() {
  const searchButton = button("Search Calendar & Tasks", "Search all Calendar events and Tasks", () => void searchCalendar(), "search-calendar");
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
  heading.textContent = "Calendar & Tasks results · read only";
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
  for (const event of results.slice(0, renderedItemLimit)) {
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
    date.textContent = event.task?.due === null ? "No due date" : event.start?.date
      ? `${event.start.date} · all day`
      : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start.dateTime));
    titleLine.append(title);
    row.append(titleLine, date);
    if (event.location) {
      const location = document.createElement("a");
      location.className = "location";
      location.textContent = event.location;
      location.href = event.task ? taskNoteUrl(event.location) || "" : locationHref(event.location);
      location.title = event.location;
      if (!event.task || taskNoteUrl(event.location)) location.addEventListener("click", (click) => {
        click.preventDefault();
        void openLink(location.href)
          .catch((error) => showError(`Could not open location: ${error.message}`));
      });
      if (event.task && !taskNoteUrl(event.location)) location.removeAttribute("href");
      row.append(location);
    }
    list.append(row);
  }
  if (results.length > renderedItemLimit) appendMoreItems();
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
  const pending = undo.current?.event.id === event.id ? undo.current : null;
  if (pending) row.classList.add("pending");
  if (isEmphasized(event, account)) row.classList.add("emphasized");
  const top = document.createElement("div");
  top.className = "event-top";
  const details = document.createElement("div");
  details.className = "details";
  const title = document.createElement(pending ? "span" : "a");
  title.className = "title";
  title.textContent = event.summary || "(Untitled event)";
  title.title = title.textContent;
  title.href = calendarEventAction(event)?.url || "#";
  title.addEventListener("click", (click) => {
    click.preventDefault();
    openEventLink(event);
  });
  const age = document.createElement("div");
  age.className = "age";
  age.textContent = pending ? actionDescription(pending) : eventAgeLabel(event, Date.now(), calendarZone);
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
  if (event.location) {
    const location = document.createElement("a");
    location.className = "location";
    location.textContent = event.location;
    location.title = event.location;
    location.href = event.task ? taskNoteUrl(event.location) || "" : locationHref(event.location);
    if (!event.task || taskNoteUrl(event.location)) location.addEventListener("click", (click) => {
      click.preventDefault();
      void openLink(location.href)
        .catch((error) => showError(`Could not open location: ${error.message}`));
    });
    if (event.task && !taskNoteUrl(event.location)) location.removeAttribute("href");
    details.append(location);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", `Actions for ${event.summary || "event"}`);
  top.append(details, actions);
  row.append(top);
  if (pending) {
    actions.append(button("Undo", `Undo pending action for ${event.summary || "event"}`,
      () => { void undo.undo(); }, "tile undo"));
    return row;
  }
  if (isRecurring(event)) {
    actions.append(button("✓", "Dismiss only this occurrence in this app", () => void stageAction(event, "dismiss"), "tile danger"),
      button("✎", "Edit recurring occurrence in Google Calendar", () => openEventLink(event, "edit"), "tile primary"));
    return row;
  }
  const calendarTile = button("📅", "Choose a date", () => {
    void undo.commit();
    dateTarget = event;
    datePicker.value = "";
    const eventTime = new Date(event.start.dateTime || 0);
    timePicker.value = event.start.date ? "" : `${String(eventTime.getHours()).padStart(2, "0")}:${String(eventTime.getMinutes()).padStart(2, "0")}`;
    timePicker.hidden = true;
    timeToggle.hidden = !!event.start.date || !!event.task;
    timeToggle.setAttribute("aria-label", `Choose move time${event.start.date ? "" : `, initially ${eventTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}`);
    calendarDialog.showModal();
    try { datePicker.showPicker(); }
    catch { datePicker.focus(); }
  });
  const fourHours = moveTile(event, "4H", { hours: 4 });
  if (event.start.date || event.task) {
    fourHours.disabled = true;
    fourHours.title = "Hour moves are unavailable for all-day events";
  }
  actions.append(
    button("✓", "Dismiss event in this app", () => void stageAction(event, "dismiss"), "tile danger"),
    button("✎", "Edit event in Google Calendar", () => openEventLink(event, "edit")),
    calendarTile,
    fourHours,
    ...[7, 3, 2, 1].map(days => moveTile(event, `${days}D`, { days }))
  );
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

async function revertAction(action) {
  if (!account || account.toLowerCase() !== action.account.toLowerCase()) throw new Error("Reconnect the account that performed this action.");
  // Prevent the durable outbox from reapplying the action after it has been undone.
  await storeFor(action.account).remove(action.id);
  if (action.type === "move") {
    const restored = await moveEvent(action.account, action.event.id, {}, new Date(), {
      start: action.event.start, end: action.event.end,
      originalStart: action.destinationStart, originalEnd: action.destinationEnd,
      ...(action.event.task ? {taskDue:action.event.task.due, originalTaskDue:action.destinationStart.date} : {})
    });
    events = events.filter(event => event.id !== restored.id);
    events.push(restored);
    events.sort(compareEvents);
  } else {
    if (action.event.task) await completeTask(action.event.id, false);
    const previous = dismissals.find(record => record.eventId === action.event.id && record.start === eventStartMs(action.event, calendarZone));
    try {
      dismissals = await saveDismissal(action.account, {
        eventId: action.event.id, start: eventStartMs(action.event, calendarZone),
        dismissed: Math.max(Date.now(), (previous?.dismissed || 0) + 1),
        title: action.event.summary || "(Untitled event)", restored: true
      });
    } finally {
      const key = `dismissals:${action.account.toLowerCase()}`;
      const stored = await chrome.storage.local.get(key);
      dismissals = stored[key] || dismissals;
      if (!events.some(event => event.id === action.event.id)) events.push(action.event);
      events.sort(compareEvents);
    }
  }
  await chrome.storage.local.set({ [`cachedEvents:${action.account.toLowerCase()}`]: { events, zone: calendarZone } });
  showError("");
  void renderPendingSaves();
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
        start: action.destinationStart, end: action.destinationEnd, originalStart: event.start, originalEnd: event.end, ...(event.task ? {originalTaskDue:event.task.due} : {})
      });
      applied = true;
      events = events.filter((item) => item.id !== event.id);
      const start = eventStartMs(moved, calendarZone);
      const bounds = displayWindow(Date.now(), lookbackDays, lookaheadDays, windowPreset);
      if (moved.task?.due === null || (Number.isFinite(start) && start >= bounds.first && start < bounds.lastExclusive)) {
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
      if (event.task) {
        if (account?.toLowerCase() !== action.account.toLowerCase()) throw new Error("Reconnect the account that performed this action.");
        await completeTask(event.id, true);
        applied = true;
        events = events.filter(item => item.id !== event.id);
        await chrome.storage.local.set({ [`cachedEvents:${action.account.toLowerCase()}`]: {events, zone:calendarZone} });
      }
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
    const tasks = await readTasks(googleRequest);
    results.events.push(...tasks.filter(task => `${task.summary} ${task.location || ""}`.toLowerCase().includes(query.toLowerCase())));
    results.events.sort((a,b) => compareSearchEvents(a,b));
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
$("#header-undo").addEventListener("click", () => { void undo.undoLast().catch(error => showError(`Could not undo: ${error.message}`)); });
$("#header-refresh").addEventListener("click", () => { void refreshEvents(); });
// Repainting the list during a press detaches the target and Chrome drops its click.
document.addEventListener("pointerdown", (event) => {
  if (event.button === 0 && event.target.closest(".event button")) renderGuard.begin(event.pointerId);
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
    $("#undo-time-error").textContent = "Enter a whole number from 0 to 30.";
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
    await restoreLastUndo();
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
