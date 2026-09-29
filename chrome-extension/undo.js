export const UNDO_MS = 30_000;

export class UndoController {
  constructor(onCommit, onChange, schedule = (fn, ms) => globalThis.setTimeout(fn, ms), cancel = (id) => globalThis.clearTimeout(id), onUndo = () => {}) {
    this.onCommit = onCommit;
    this.onChange = onChange;
    this.schedule = schedule;
    this.cancel = cancel;
    this.onUndo = onUndo;
    this.current = null;
    this.timer = null;
    this.queue = Promise.resolve();
  }

  enqueue(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  stage(action) {
    return this.enqueue(async () => {
      await this.commitCurrent();
      // A failed timer setup must not leave an Undo row that can never commit.
      const timer = this.schedule(() => { void this.commit(); }, UNDO_MS);
      this.current = action;
      this.timer = timer;
      try {
        this.onChange(action);
      } catch (error) {
        this.cancel(timer);
        this.timer = null;
        this.current = null;
        throw error;
      }
    });
  }

  undo() {
    return this.enqueue(() => {
      if (!this.current) return;
      const action = this.current;
      this.cancel(this.timer);
      this.timer = null;
      this.current = null;
      this.onChange(null);
      this.onUndo(action);
    });
  }

  commit() { return this.enqueue(() => this.commitCurrent()); }

  async commitCurrent() {
    if (!this.current) return;
    const action = this.current;
    this.cancel(this.timer);
    this.timer = null;
    this.current = null;
    this.onChange(null);
    await this.onCommit(action);
  }
}

export function actionDescription(action) {
  if (action.type === "dismiss") return "Dismissed";
  if (action.option.date) {
    const date = new Date(`${action.option.date}T12:00:00`);
    return `Moved to ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date)}`;
  }
  if (action.option.days === 0) return "Moved to today";
  if (action.option.hours) return `Moved ${action.option.hours} ${action.option.hours === 1 ? "hour" : "hours"} later`;
  return `Moved ${action.option.days} ${action.option.days === 1 ? "day" : "days"} later`;
}
