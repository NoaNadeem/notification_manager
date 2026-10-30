export const DEFAULT_UNDO_SECONDS = 2;
export const UNDO_MS = DEFAULT_UNDO_SECONDS * 1_000;

export function parseUndoSeconds(value) {
  const seconds = typeof value === "number" ? value
    : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 30 ? seconds : null;
}

export class UndoController {
  constructor(onCommit, onChange, schedule = (fn, ms) => globalThis.setTimeout(fn, ms), cancel = (id) => globalThis.clearTimeout(id), onUndo = () => {}, onQueue = async () => {}, onRevert = async () => {}) {
    this.onCommit = onCommit;
    this.onChange = onChange;
    this.schedule = schedule;
    this.cancel = cancel;
    this.onUndo = onUndo;
    this.onQueue = onQueue;
    this.onRevert = onRevert;
    this.latestAction = null;
    this.reverting = false;
    this.state = { kind: "Idle" };
    this.timer = null;
    this.undoSeconds = DEFAULT_UNDO_SECONDS;
    this.queue = Promise.resolve();
    this.committingActions = new Set();
  }

  get current() { return this.state.kind === "Pending" ? this.state.action : null; }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async stage(action) {
    if (this.reverting) throw new Error("Wait for Undo to finish before changing another event.");
    // Set up the new Undo immediately; only network saves join the serial queue.
    const timer = this.schedule(() => { if (this.current === action) void this.commit().catch(() => {}); }, (parseUndoSeconds(this.undoSeconds) ?? DEFAULT_UNDO_SECONDS) * 1_000);
    void this.commit().catch(() => {});
    this.state = { kind: "Pending", action };
    this.latestAction = action;
    this.timer = timer;
    try {
      this.onChange(action);
      if (this.undoSeconds === 0) void this.commit().catch(() => {});
    } catch (error) {
      this.cancel(timer);
      this.timer = null;
      this.state = { kind: "Idle" };
      throw error;
    }
  }

  async undo() {
    if (!this.current) return;
    const action = this.current;
    this.cancel(this.timer);
    this.timer = null;
    this.state = { kind: "Idle" };
    this.onChange(null);
    if (this.latestAction === action) this.latestAction = null;
    this.onUndo(action);
    this.onChange(null);
  }

  async undoLast() {
    const action = this.latestAction;
    if (!action || this.reverting) return;
    if (this.current === action) return this.undo();
    this.reverting = true;
    this.onChange(this.current);
    try {
      await this.queue.catch(() => {});
      await this.onRevert(action);
      if (this.latestAction === action) this.latestAction = null;
    } finally {
      this.reverting = false;
      this.onChange(this.current);
    }
  }

  commit() {
    if (!this.current) return this.queue;
    const action = this.current;
    this.cancel(this.timer);
    this.timer = null;
    this.state = { kind: "Committing", action };
    return this.saveInBackground(action);
  }

  retry(action) {
    if ([...this.committingActions].some(item => item.id === action.id)) return this.queue;
    return this.saveInBackground(action);
  }

  saveInBackground(action) {
    this.committingActions.add(action);
    // Start durable storage now, even if an earlier network save is blocked.
    const persisted = Promise.resolve().then(() => this.onQueue(action));
    persisted.catch(() => {});
    const result = this.enqueue(async () => {
      try {
        await persisted;
        const saved = await this.onCommit(action);
        // A completed save must never replace a newer event's Undo state.
        if (this.state.kind === "Committing" && this.state.action === action) {
          this.state = saved === false ? { kind: "Failed", action } : { kind: "Idle" };
        }
        return saved;
      } catch (error) {
        if (this.state.kind === "Committing" && this.state.action === action) {
          this.state = { kind: "Failed", action, error };
        }
        throw error;
      } finally {
        this.committingActions.delete(action);
        this.onChange(this.current);
      }
    });
    this.onChange(null);
    return result;
  }
}

export function actionDescription(action) {
  if (action.type === "dismiss") return "Dismissed";
  const start = action.destinationStart;
  const date = start?.date ? new Date(`${start.date}T12:00:00`)
    : start?.dateTime ? new Date(start.dateTime)
    : action.option.date ? new Date(`${action.option.date}T12:00:00`)
    : new Date((action.stagedAtMs ?? Date.now()) + (action.option.hours || 0) * 3_600_000 +
      (action.option.days || 0) * 86_400_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    weekday: "long", day: "numeric", month: "short", year: "numeric"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const day = Number(parts.day);
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th");
  const dateLabel = `${parts.weekday} ${day}${suffix} ${parts.month} ${parts.year}`;
  if (action.option.date) {
    if (!action.option.time) return `Moved to ${dateLabel}`;
    const time = new Date(`${action.option.date}T${action.option.time}:00`);
    const timeLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(time);
    return `Moved to ${dateLabel}, ${timeLabel}`;
  }
  if (action.option.days === 0) return `Moved to today, ${dateLabel}`;
  if (action.option.hours) return `Moved ${action.option.hours} ${action.option.hours === 1 ? "hour" : "hours"} later, to ${dateLabel}`;
  return `Moved ${action.option.days} ${action.option.days === 1 ? "day" : "days"} later, to ${dateLabel}`;
}
