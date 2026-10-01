export function flyoutPointerInReach(x, y, trigger, flyout, margin = 24) {
  return x >= Math.min(trigger.left, flyout.left) - margin &&
    x <= Math.max(trigger.right, flyout.right) + margin &&
    y >= Math.min(trigger.top, flyout.top) - margin &&
    y <= Math.max(trigger.bottom, flyout.bottom) + margin;
}

export function flyoutAboveRowTop(rowTop, flyoutHeight) {
  return Math.max(4, rowTop - flyoutHeight);
}
