import { shiftEvent } from "./model.js";

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function parts(date, options, zone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, ...options
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function ordinal(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
}

function dateLabel(date, zone) {
  const value = parts(date, { weekday: "short", month: "short", day: "numeric" }, zone);
  const month = value.month === "Sep" ? "Sept" : value.month;
  return `${value.weekday} ${month} ${value.day}${ordinal(Number(value.day))}`;
}

function timeLabel(date, zone) {
  const value = parts(date, { hour: "numeric", minute: "2-digit", hour12: true }, zone);
  const period = value.dayPeriod.toLowerCase() === "am" ? "a.m." : "p.m.";
  return `${value.hour}:${value.minute} ${period}`;
}

function zoneLabels(date, zone) {
  const short = parts(date, { timeZoneName: "short" }, zone).timeZoneName;
  const long = parts(date, { timeZoneName: "long" }, zone).timeZoneName;
  return `${short} (${long})`;
}

export function headerClockLabel(now = new Date(), zone = localZone()) {
  return `${dateLabel(now, zone)}, ${timeLabel(now, zone)} ${zoneLabels(now, zone)}`;
}

export function moveTooltip(event, option, now = new Date(), zone = localZone()) {
  const moved = shiftEvent(event, option, now);
  const start = moved.start.date
    ? new Date(`${moved.start.date}T12:00:00`)
    : new Date(moved.start.dateTime);
  const date = dateLabel(start, zone);
  if (!option.hours) return `Move to ${date}`;
  return `Move to ${date}, ${timeLabel(start, zone)} ${zoneLabels(start, zone)}`;
}
