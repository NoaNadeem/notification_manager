function sameTime(a, b) {
  if (a?.date || b?.date) return a?.date === b?.date;
  return Number.isFinite(Date.parse(a?.dateTime)) && Date.parse(a.dateTime) === Date.parse(b?.dateTime);
}

export function savedMoveState(current, destination) {
  if (sameTime(current.start, destination.start) && sameTime(current.end, destination.end)) return "applied";
  if (sameTime(current.start, destination.originalStart) && (!destination.originalEnd || sameTime(current.end, destination.originalEnd))) return "ready";
  const error = new Error("This event changed after the move was queued. Review it before trying another move.");
  error.status = 409;
  throw error;
}
