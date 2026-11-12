import test from 'node:test';
import assert from 'node:assert/strict';
import {isPriority,priorityTitle,compareEvents,compareSearchEvents} from './model.js';
import {setPriority} from './google.js';

test('priority markers toggle idempotently and priority precedes all dates and undated tasks',()=>{
 assert.equal(priorityTitle('Event',true),'Event.');
 assert.equal(priorityTitle('Event (PRI)',true),'Event.');
 assert.equal(priorityTitle('Event (pri) (PRI)',false),'Event');
 assert.equal(isPriority({summary:'Event (PRI)'}),true);
 const rows=[{summary:'Old',start:{dateTime:'2020-01-01T12:00:00Z'}},{summary:'Future (pri)',start:{dateTime:'2030-01-01T12:00:00Z'}},{summary:'Undated (pri)',task:{due:null}},{summary:'Earlier (pri)',start:{dateTime:'2029-01-01T12:00:00Z'}}];
 assert.deepEqual([...rows].sort(compareEvents).map(e=>e.summary),['Earlier (pri)','Future (pri)','Undated (pri)','Old']);
 assert.equal([...rows].sort(compareSearchEvents).at(-1).summary,'Old');
});
test('priority writes only summary or task title, using ETag; stale titles never overwritten',async()=>{
 for(const [id,field] of [['event','summary'],['task:list:task','title']]){
  const event={id,summary:'Synthetic'};let current={[field]:'Synthetic',etag:'original'};const calls=[];
  const request=async(url,options)=>{calls.push({url,options});if(!options)return current;Object.assign(current,JSON.parse(options.body));return current;};
  const updated=await setPriority('fixture@example.invalid',event,true,request);
  assert.equal(updated.summary,'Synthetic.');
  assert.deepEqual(JSON.parse(calls[1].options.body),{[field]:'Synthetic.'});
  assert.equal(calls[1].options.method,'PATCH');assert.equal(calls[1].options.headers['If-Match'],'original');
  assert.ok(calls[0].url.includes(id==='event'?'/events/event':'/lists/list/tasks/task'));
  calls.length=0;await setPriority('fixture@example.invalid',event,true,request);assert.equal(calls.length,1);
  await setPriority('fixture@example.invalid',updated,false,request);assert.equal(current[field],'Synthetic');
  current[field]='Someone edited this';calls.length=0;
  await assert.rejects(setPriority('fixture@example.invalid',event,true,request),/changed elsewhere/);assert.equal(calls.length,1);
 }
});


test('trailing period is idempotent and shared events are blocked at the fresh API boundary',async()=>{
 const {canChangePriority}=await import('./model.js');
 const mine='fixture@example.invalid';
 assert.equal(priorityTitle('Event ★',true),'Event.');
 assert.equal(priorityTitle('Event ★ ★',false),'Event');
 assert.equal(priorityTitle('Event (pri) ★',false),'Event');
 assert.equal(isPriority({summary:'Event ★'}),true);
 assert.equal(isPriority({summary:'★ inside title'}),false);
 assert.equal(isPriority({summary:'Event.'}),true);
 assert.equal(isPriority({summary:'Event.   '}),true);
 assert.equal(isPriority({summary:'Dr. Example'}),false);
 assert.equal(priorityTitle('Event.',true),'Event.');
 assert.equal(priorityTitle('Event...',false),'Event');
 assert.equal(priorityTitle('Event (pri) ★',true),'Event.');
 assert.equal(canChangePriority({attendees:[{email:mine}]},mine),true);
 assert.equal(canChangePriority({attendees:[{email:'alias@example.invalid',self:true}]},mine),true);
 for(const extra of [{attendees:[{email:'guest@example.invalid'}]}, {attendees:[{email:'room@example.invalid',resource:true}]}, {attendees:[{}]}, {attendeesOmitted:true}, {organizer:{email:'other@example.invalid'}}]){
  assert.equal(canChangePriority(extra,mine),false);
  for(const enabled of [true,false]){
   let writes=0;
   const request=async(_url,options)=>{if(options)writes++;return {...extra,summary:'Synthetic',etag:'fixture'};};
   await assert.rejects(setPriority(mine,{id:'fixture',summary:'Synthetic'},enabled,request),/without other invitees/);
   assert.equal(writes,0);
  }
 }
});
