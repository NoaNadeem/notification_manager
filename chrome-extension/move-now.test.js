import test from 'node:test';
import assert from 'node:assert/strict';
import {canMoveToNow,shiftEvent,dayMoveOption} from './model.js';
import {moveEvent} from './google.js';
const now=new Date('2026-11-14T18:20:30Z'), account='fixture@example.invalid';
const event={id:'synthetic',summary:'Synthetic',start:{dateTime:'2026-11-10T15:00:00Z'},end:{dateTime:'2026-11-10T15:15:00Z'},etag:'"a"'};
test('Move to now selects purple-dot personal items only',()=>{
 assert.ok(canMoveToNow(event,account,undefined,+now));
 for(const patch of [{summary:'Priority.'},{recurrence:['RRULE:FREQ=DAILY']},{attendees:[{email:'other@example.invalid'}]}, {attendees:[{email:'room@example.invalid',resource:true}]},{attendeesOmitted:true},{organizer:{email:'other@example.invalid'}},{end:{dateTime:'2026-11-10T16:00:00Z'}},{start:{dateTime:now.toISOString()}},{start:{date:'2026-11-10'},end:{date:'2026-11-11'}}]) assert.equal(canMoveToNow({...event,...patch},account,undefined,+now),false,JSON.stringify(patch));
 assert.ok(canMoveToNow({...event,task:{due:'2026-11-10'}},account,undefined,+now));
 assert.equal(canMoveToNow({...event,task:{due:null}},account,undefined,+now),false);
});
test('now bypasses 6am preference, preserves duration and fresh shared events get zero writes',async()=>{
 const option={hours:0,personalOnly:true};
 assert.deepEqual(dayMoveOption(event,option,now,true,account),option);
 const moved=shiftEvent(event,option,now);
 assert.equal(Date.parse(moved.start.dateTime),+now);assert.equal(Date.parse(moved.end.dateTime)-+now,900000);
 let writes=0;
 const request=async(_url,body)=>{if(body){writes++;assert.equal(body.headers['If-Match'],'"a"');return JSON.parse(body.body);}return event;};
 const saved=await moveEvent(account,event.id,option,now,null,request);assert.equal(saved.start.dateTime,now.toISOString());assert.equal(writes,1);
 writes=0;
 await assert.rejects(moveEvent(account,event.id,option,now,null,async(_url,body)=>{if(body)writes++;return {...event,attendees:[{email:'other@example.invalid'}]};}),/personal/);assert.equal(writes,0);
});
