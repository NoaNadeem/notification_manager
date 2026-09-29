export function flyoutPlacement(rowTop, rowBottom, flyoutHeight, listTop, listBottom) {
  if (rowBottom + flyoutHeight + 8 <= listBottom) return "below";
  if (rowTop - flyoutHeight >= listTop + 8) return "above";
  return "scroll";
}
