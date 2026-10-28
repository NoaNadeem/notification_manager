// Account-scoped durable outbox. Serial storage updates prevent rapid clicks
// from overwriting each other's records before their network saves start.
export class PendingActionStore {
  constructor(storage, account) {
    this.storage = storage;
    this.key = `pendingActions:${account.toLowerCase()}`;
    this.queue = Promise.resolve();
  }
  update(change) {
    const result = this.queue.then(async () => {
      const records = (await this.storage.get(this.key))[this.key] || [];
      const next = change(records);
      await this.storage.set({ [this.key]: next });
      return next;
    });
    this.queue = result.catch(() => {});
    return result;
  }
  async list() {
    await this.queue;
    return (await this.storage.get(this.key))[this.key] || [];
  }
  save(action) {
    return this.update(records => records.some(record => record.action.id === action.id)
      ? records : [...records, { action, error: null, retryable: true }]);
  }
  remove(id) { return this.update(records => records.filter(record => record.action.id !== id)); }
  fail(action, error) {
    const status = error.status;
    const retryable = status == null || [401, 408, 429].includes(status) || status >= 500;
    return this.update(records => records.map(record => record.action.id === action.id
      ? { ...record, error: error.message, retryable } : record));
  }
}
