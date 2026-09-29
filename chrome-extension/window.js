import { ageLabel, dismissalKey, eventStartMs, locationHref } from "./model.js";
import { primaryCalendar, recentEvents, moveEvent, syncDismissals, saveDismissal } from "./google.js";

const list = document.querySelector("#event-list");
const notice = document.querySelector("#notice");
const accountLabel = document.querySelector("#account");
const count = document.querySelector("#count");
const connectPanel = document.querySelector("#connect-panel");
const lookback = document.querySelector("#lookback");
const datePicker = document.querySelector("#date-picker");

let account;
let calendarZone;
let events = [];
let dismissals = [];
let loading = false;
let dateTarget;
let openFlyoutRow;

function showFlyout(row) {
  if (openFlyoutRow && openFlyoutRow !== row) openFlyoutRow.classList.remove("flyout-open");
  openFlyoutRow = row;
  row.classList.add("flyout-open");
}

function hideFlyout(row) {
  row.classList.remove("flyout-open");
  if (openFlyoutRow === row) openFlyoutRow = undefined;
}

const button = (label, title, action, className = "tile") => {
  const element = document.createElement("button");
  element.className = className;
  element.textContent = label;
  element.title = title;
  element.setAttribute("aria-label", title);
  element.addEventListener("click", action);
  return element;
};

function showError(message) { notice.textContent = message; }

async function load(interactive = false) {
  if (loading) return;
  loading = true;
  showError("");
  count.textContent = "Loading…";
  try {
    const calendar = await primaryCalendar(interactive);
    account = calendar.id;
    calendarZone = calendar.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    accountLabel.textContent = account;
    connectPanel.hidden = true;
    const recent = await recentEvents(account, Number(lookback.value));
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
  openFlyoutRow = undefined;
  list.replaceChildren();
  const dismissed = new Set(dismissals.map((record) => dismissalKey(record.eventId, record.start)));
  const visible = events.filter((event) => !dismissed.has(dismissalKey(event.id, eventStartMs(event, calendarZone))));
  count.textContent = `${visible.length} event${visible.length === 1 ? "" : "s"}`;
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No past events in this period.";
    list.append(empty);
    return;
  }
  for (const event of visible) list.append(renderEvent(event));
}

function renderEvent(event) {
  const row = document.createElement("article");
  row.className = "event";
  const top = document.createElement("div");
  top.className = "event-top";
  const details = document.createElement("div");
  details.className = "details";
  const title = document.createElement("a");
  title.className = "title";
  title.textContent = event.summary || "(Untitled event)";
  title.href = event.htmlLink || "#";
  title.addEventListener("click", (click) => {
    click.preventDefault();
    if (event.htmlLink) void chrome.tabs.create({ url: event.htmlLink });
    else showError("Google Calendar did not provide a link for this event.");
  });
  const age = document.createElement("div");
  age.className = "age";
  age.textContent = ageLabel(eventStartMs(event, calendarZone));
  details.append(title, age);
  if (event.location) {
    const location = document.createElement("a");
    location.className = "location";
    location.textContent = event.location;
    location.title = event.location;
    location.href = locationHref(event.location);
    location.addEventListener("click", (click) => {
      click.preventDefault();
      void chrome.tabs.create({ url: location.href });
    });
    details.append(location);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(button("1D", "Move to 24 hours from now", () => void applyMove(event, { days: 1 }, row), "tile primary"));
  const more = button("⋯", "More move and dismiss options", () => showFlyout(row), "tile more");
  more.setAttribute("aria-haspopup", "true");
  more.addEventListener("pointerenter", () => showFlyout(row));
  more.addEventListener("focus", () => showFlyout(row));
  row.addEventListener("pointerleave", () => hideFlyout(row));
  row.addEventListener("focusout", (event) => {
    if (!row.contains(event.relatedTarget)) hideFlyout(row);
  });
  actions.append(more);
  top.append(details, actions);
  row.append(top);
  const flyout = document.createElement("div");
  flyout.className = "flyout";
  const topRow = document.createElement("div");
  const bottomRow = document.createElement("div");
  topRow.className = bottomRow.className = "tile-row";
  const allDay = !!event.start.date;
  if (allDay) {
    topRow.append(button("0D", "Move to today", () => void applyMove(event, { days: 0 }, row)));
    for (let i = 0; i < 2; i++) { const spacer = button("", "Unavailable for all-day events", () => {}); spacer.disabled = true; topRow.append(spacer); }
  } else {
    for (const hours of [1, 4, 8]) topRow.append(button(`${hours}H`, `Move to ${hours} hour${hours === 1 ? "" : "s"} from now`, () => void applyMove(event, { hours }, row)));
  }
  topRow.append(button("Cal", "Choose a date", () => {
    dateTarget = { event, row };
    datePicker.value = "";
    if (datePicker.showPicker) datePicker.showPicker();
    else datePicker.click();
  }));
  topRow.append(button("✓", "Dismiss event", () => void applyDismiss(event, row), "tile danger"));
  for (const days of [2, 3, 4, 7]) bottomRow.append(button(`${days}D`, `Move to ${days} days from now`, () => void applyMove(event, { days }, row)));
  bottomRow.append(button("↗", "Open event in Google Calendar", () => { if (event.htmlLink) void chrome.tabs.create({ url: event.htmlLink }); }));
  flyout.append(topRow, bottomRow);
  row.append(flyout);
  return row;
}

async function applyMove(event, option, row) {
  row.classList.add("busy");
  showError("");
  try {
    const moved = await moveEvent(account, event.id, option);
    const movedStart = eventStartMs(moved, calendarZone);
    events = events.filter((item) => item !== event);
    if (Number.isFinite(movedStart) && movedStart <= Date.now() &&
        movedStart >= Date.now() - Number(lookback.value) * 86_400_000) {
      events.push(moved);
      events.sort((a, b) => eventStartMs(b, calendarZone) - eventStartMs(a, calendarZone));
    }
    render();
  } catch (error) {
    showError(`Could not move “${event.summary || "(Untitled event)"}”: ${error.message}`);
    row.classList.remove("busy");
  }
}

async function applyDismiss(event, row) {
  row.classList.add("busy");
  showError("");
  try {
    dismissals = await saveDismissal(account, {
      eventId: event.id, start: eventStartMs(event, calendarZone), dismissed: Date.now()
    });
    render();
  } catch (error) {
    // The local save may have succeeded even if Drive failed. Reflect its actual state.
    const stored = await chrome.storage.local.get(`dismissals:${account.toLowerCase()}`);
    dismissals = stored[`dismissals:${account.toLowerCase()}`] || dismissals;
    showError(`Dismissal sync failed for “${event.summary || "(Untitled event)"}”: ${error.message}`);
    render();
  }
}

datePicker.addEventListener("change", () => {
  if (datePicker.value && dateTarget) void applyMove(dateTarget.event, { date: datePicker.value }, dateTarget.row);
  dateTarget = undefined;
});
document.querySelector("#refresh").addEventListener("click", () => void load());
document.querySelector("#connect").addEventListener("click", () => void load(true));
lookback.addEventListener("change", async () => {
  await chrome.storage.local.set({ lookbackDays: Number(lookback.value) });
  void load();
});

const saved = await chrome.storage.local.get("lookbackDays");
lookback.value = String(saved.lookbackDays || 7);
void load();
