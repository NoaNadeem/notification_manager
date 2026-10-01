export function flyoutScrollDelta(rowTop, flyoutHeight, listBottom) {
  return Math.max(0, rowTop + flyoutHeight + 8 - listBottom);
}
