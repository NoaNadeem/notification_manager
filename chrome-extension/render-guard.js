// Keep a pressed button connected until the browser has delivered its click.
// Google responses can request a list repaint between pointerdown and pointerup.
export class InteractionRenderGuard {
  constructor(render, schedule = (fn) => globalThis.setTimeout(fn, 0), cancel = (id) => globalThis.clearTimeout(id)) {
    this.render = render;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pointers = new Set();
    this.releaseTimer = null;
    this.pending = false;
  }

  request() {
    if (this.pointers.size || this.releaseTimer !== null) {
      this.pending = true;
      return;
    }
    this.render();
  }

  begin(pointerId) {
    if (this.releaseTimer !== null) this.cancel(this.releaseTimer);
    this.releaseTimer = null;
    this.pointers.add(pointerId);
  }

  end(pointerId) {
    if (!this.pointers.delete(pointerId) || this.pointers.size) return;
    this.release();
  }

  release() {
    this.pointers.clear();
    if (this.releaseTimer !== null) this.cancel(this.releaseTimer);
    // pointerup precedes click. Wait through the click and its microtasks.
    this.releaseTimer = this.schedule(() => {
      this.releaseTimer = null;
      if (!this.pending) return;
      this.pending = false;
      this.render();
    });
  }
}
