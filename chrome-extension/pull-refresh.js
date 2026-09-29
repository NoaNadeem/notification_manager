export class PullRefreshGesture {
  constructor(onProgress, onRefresh, now = () => Date.now(), threshold = 70) {
    this.onProgress = onProgress;
    this.onRefresh = onRefresh;
    this.now = now;
    this.threshold = threshold;
    this.pointerId = null;
    this.startY = 0;
    this.distance = 0;
    this.wheelDistance = 0;
    this.wheelAt = 0;
    this.wheelTriggered = false;
  }

  start(pointerId, y, allowed) {
    if (!allowed) return;
    this.pointerId = pointerId;
    this.startY = y;
    this.distance = 0;
  }

  move(pointerId, y, allowed) {
    if (this.pointerId !== pointerId) return 0;
    if (!allowed) { this.cancel(); return 0; }
    this.distance = Math.max(0, y - this.startY);
    this.onProgress(this.distance, this.distance >= this.threshold);
    return this.distance;
  }

  end(pointerId, allowed) {
    if (this.pointerId !== pointerId) return false;
    const triggered = allowed && this.distance >= this.threshold;
    this.cancel();
    if (triggered) this.onRefresh();
    return triggered;
  }

  cancel() {
    this.pointerId = null;
    this.distance = 0;
    this.onProgress(0, false);
  }

  wheel(deltaY, allowed) {
    const time = this.now();
    if (!allowed || deltaY >= 0 || time - this.wheelAt > 800) {
      this.cancelWheel();
    }
    this.wheelAt = time;
    if (!allowed || deltaY >= 0 || this.wheelTriggered) return false;
    this.wheelDistance += -deltaY;
    this.onProgress(this.wheelDistance, this.wheelDistance >= this.threshold);
    if (this.wheelDistance < this.threshold) return false;
    this.wheelTriggered = true;
    this.onProgress(0, false);
    this.onRefresh();
    return true;
  }

  cancelWheel() {
    this.wheelDistance = 0;
    this.wheelTriggered = false;
    this.onProgress(0, false);
  }
}
