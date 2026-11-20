import test from 'node:test';
import assert from 'node:assert/strict';
import {headerClockLabel, displayContextKey} from './clock.js';
import {eventAgeLabel, isFutureEvent, eventStartMs, compareEvents, compareSearchEvents, displayWindow, nextDayPreviewWindow, itemsInWindow, withoutDismissals} from './model.js';
import {recentEvents} from './google.js';

const now = Date.parse('2026-11-20T17:00:00Z'); // LA Nov 20 09:00; Shanghai Nov 21 01:00.
const calendarZone = 'America/Los_Angeles';
const allDay = {id:'all-day',summary:'Sample all-day',start:{date:'2026-11-21'},end:{date:'2026-11-22'}};
const dueTask = {...allDay,id:'task:sample:due',task:{due:'2026-11-21'}};
const timed = {id:'timed',start:{dateTime:'2026-11-20T18:00:00Z'},end:{dateTime:'2026-11-20T18:15:00Z'}};
const withZone = (zone, run) => {
 const previous = process.env.TZ;
 process.env.TZ = zone;
 try { return run(); } finally { if(previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
};

test('labels, ordering and review/preview boundaries agree on each device date', () => {
 const originals = structuredClone([allDay,dueTask,timed]);
 for(const zone of ['America/Los_Angeles','Asia/Shanghai']) withZone(zone, () => {
  const china = zone === 'Asia/Shanghai';
  assert.match(headerClockLabel(new Date(now)),china ? /Nov 21st, 1:00 a.m./ : /Nov 20th, 9:00 a.m./);
  assert.equal(displayContextKey(new Date(now)),`${zone}/2026-11-${china ? '21':'20'}`);
  assert.equal(eventAgeLabel(timed,now),china ? 'At 2:00 am' : 'At 10:00 am');
  for(const item of [allDay,dueTask]) {
   assert.equal(eventAgeLabel(item,now),china ? 'Today' : 'Sat Nov 21st');
   assert.equal(isFutureEvent(item,now),!china);
  }
  const bounds = displayWindow(now,7,0);
  assert.deepEqual(itemsInWindow([allDay,dueTask,timed],bounds).map(e=>e.id),china ? ['all-day','task:sample:due','timed'] : ['timed']);
  assert.deepEqual(itemsInWindow([allDay,dueTask],nextDayPreviewWindow(bounds.lastExclusive)).map(e=>e.id),china ? [] : ['all-day','task:sample:due']);
  assert.deepEqual([timed,allDay].sort(compareEvents).map(e=>e.id),china ? ['all-day','timed'] : ['timed','all-day']);
  assert.deepEqual([timed,allDay].sort(compareSearchEvents).map(e=>e.id),['all-day','timed']);
 });
 assert.deepEqual([allDay,dueTask,timed],originals,'Display must not modify event dates/times');
});

test('switching device zones keeps existing all-day dismissal identity stable', () => {
 const start = eventStartMs(allDay,calendarZone);
 const records = [{eventId:allDay.id,start,dismissed:now}];
 for(const zone of ['America/Los_Angeles','Asia/Shanghai']) withZone(zone, () => {
  assert.equal(eventStartMs(allDay,calendarZone),start);
  assert.deepEqual(withoutDismissals([allDay,timed],records,calendarZone),[timed]);
 });
});

test('display context changes at midnight or timezone change, not each minute or DST offset', () => {
 assert.notEqual(displayContextKey(new Date(now),'America/Los_Angeles'),displayContextKey(new Date(now),'Asia/Shanghai'));
 assert.equal(displayContextKey(new Date('2027-03-14T09:59:00Z'),calendarZone),displayContextKey(new Date('2027-03-14T10:01:00Z'),calendarZone));
 assert.notEqual(displayContextKey(new Date('2026-11-21T07:59:00Z'),calendarZone),displayContextKey(new Date('2026-11-21T08:00:00Z'),calendarZone));
});

test('Calendar query margin retrieves a date-only row across opposite timezone boundaries', async t => {
 t.mock.timers.enable({apis:['Date'],now});
 const previous = process.env.TZ;
 process.env.TZ = 'Etc/GMT+12';
 try {
  const item={id:'calendar-ahead',start:{date:'2026-11-19'},end:{date:'2026-11-20'}};
  const calendarStart=eventStartMs(item,'Pacific/Kiritimati');
  const calendarEnd=eventStartMs({start:item.end},'Pacific/Kiritimati');
  const calls=[];
  const result=await recentEvents('synthetic@example.invalid',1,0,'daily',async raw=>{
   const url=new URL(raw); calls.push(url);
   const lower=Date.parse(url.searchParams.get('timeMin')),upper=Date.parse(url.searchParams.get('timeMax'));
   return {items: calendarEnd>lower && calendarStart<upper ? [item] : []};
  },true);
  assert.ok(calendarEnd<=result.first,'Without the margin Google would exclude this all-day date');
  assert.deepEqual(itemsInWindow(result.events,{first:result.first,lastExclusive:result.lastExclusive}),[item]);
  assert.equal(calls.length,1);
  assert.equal(Date.parse(calls[0].searchParams.get('timeMin')),result.first-36*3600000);
  assert.equal(Date.parse(calls[0].searchParams.get('timeMax')),result.previewLastExclusive+36*3600000);
 } finally { if(previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
