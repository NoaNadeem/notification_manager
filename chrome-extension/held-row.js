export function withHeldEvent(events, held, index) {
  if (!held) return events;
  const result = events.filter((event) => event.id !== held.id);
  result.splice(Math.max(0, Math.min(index, result.length)), 0, held);
  return result;
}
