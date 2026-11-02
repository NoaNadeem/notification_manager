import test from 'node:test';
import assert from 'node:assert/strict';
import {dayMoveOption, shiftEvent} from './model.js';
import {moveTooltip} from './clock.js';
import {actionDescription} from './undo.js';
process.env.TZ = 'America/Los_Angeles';
const event = {start:{dateTime:'2026-10-20T16:00:00Z'}, end:{dateTime:'2026-10-20T16:15:00Z'}};

test('day buttons resolve to local 6am across DST, preserving duration and queued destination', () => {
  for (const stamp of ['2026-10-31T23:30:00-07:00','2027-03-13T23:30:00-08:00']) {
    const now = new Date(stamp);
    for (const days of [1,2,3,4,7]) {
      const option = dayMoveOption(event,{days},now);
      const moved = shiftEvent(event,option,now);
      const expected = new Date(now); expected.setDate(expected.getDate()+days); expected.setHours(6,0,0,0);
      assert.equal(Date.parse(moved.start.dateTime),expected.getTime());
      assert.equal(Date.parse(moved.end.dateTime)-expected.getTime(),15*60*1000);
      assert.deepEqual(shiftEvent(event,option,new Date('2028-01-01')),moved);
      assert.match(moveTooltip(event,option,now),/6:00 a.m./);
      assert.match(actionDescription({type:'move',option,destinationStart:moved.start}),/6:00 AM/);
    }
  }
});
test('24-hour opt-out remains elapsed time; other event/action types retain behavior', () => {
  const now = new Date('2026-10-31T23:30:00-07:00');
  const option = {days:1};
  assert.equal(dayMoveOption(event,option,now,false),option);
  assert.equal(Date.parse(shiftEvent(event,option,now).start.dateTime)-now.getTime(),86400000);
  for (const original of [ {...event,attendees:[{email:'other@example.com'}]},
    {...event,end:{dateTime:'2026-10-20T17:00:00Z'}},
    {...event,task:{due:null}}, {start:{date:'2026-10-20'},end:{date:'2026-10-21'}}]) {
    assert.equal(dayMoveOption(original,option,now),option);
  }
  for (const choice of [{hours:4},{days:0},{date:'2026-11-05'},{date:'2026-11-05',time:'10:00'}]) {
    assert.equal(dayMoveOption(event,choice,now),choice);
  }
});
