import test from 'node:test';
import assert from 'node:assert/strict';
import {readTasks,taskAsEvent,taskReference,taskNote,taskNoteUrl,moveTask} from './tasks.js';
import {shiftEvent,eventStartMs,eventAgeLabel,mergeDismissals,withoutDismissals,compareEvents,isEmphasized} from './model.js';
import {calendarEventAction} from './open.js';

test('tasks load all lists/pages, omit finished tasks, and have collision-free event IDs', async()=>{
 const calls=[];
 const items=await readTasks(async raw=>{
  const url=new URL(raw);calls.push(url);
  assert.equal(url.origin,'https://tasks.googleapis.com');
  if(url.pathname.endsWith('/users/@me/lists')) return url.searchParams.has('pageToken')?{items:[{id:'second'}]}:{items:[{id:'first'}],nextPageToken:'lists-next'};
  assert.equal(url.searchParams.get('showCompleted'),'false');
  if(url.pathname.includes('/second/'))return {items:[{id:'same-id',title:'Other list',status:'needsAction'}]};
  return url.searchParams.has('pageToken')?{items:[{id:'done',status:'completed'},{id:'deleted',deleted:true}]}:{items:[{id:'same-id',title:'First',status:'needsAction',due:'2026-10-30T00:00:00Z'}],nextPageToken:'tasks-next'};
 });
 assert.equal(items.length,2);assert.notEqual(items[0].id,items[1].id);
 assert.deepEqual(taskReference(items[1].id),{listId:'second',id:'same-id'});
 assert.equal(calls.length,5);
});

test('first description line uses plain text safely and only web URLs become links',()=>{
 assert.equal(taskNote('\n  Plain note\nhttps://later.example'), 'Plain note');
 assert.equal(taskNoteUrl('Plain note'),null);
 assert.equal(taskNoteUrl('javascript:alert(1)'),null);
 assert.equal(taskNoteUrl('https://example.invalid/page, extra'),'https://example.invalid/page');
 const event=taskAsEvent({id:'x',notes:'\nhttps://example.invalid\nMore text',webViewLink:'https://tasks.google.com/task/x'},'list');
 assert.equal(event.location,'https://example.invalid');
 assert.equal(calendarEventAction(event,'edit').url,'https://tasks.google.com/task/x');
 assert.equal(calendarEventAction({...event,htmlLink:'https://evil.invalid/task/x'}),null);
});

test('undated tasks retain stable dismissal keys, sort last, and can be given a date',()=>{
 const task=taskAsEvent({id:'undated'},'list');const dated=taskAsEvent({id:'dated',due:'2026-10-30T00:00:00Z'},'list');
 assert.equal(eventAgeLabel(task), 'No due date');assert.equal(eventStartMs(task),0);
 assert.ok(compareEvents(task,dated)>0);
 const dismissed=mergeDismissals([],[{eventId:task.id,start:0,dismissed:Date.now()}]);
 assert.equal(dismissed.length,1);assert.deepEqual(withoutDismissals([task],dismissed),[task]); // Google completion, not local logs, controls task visibility.
 const destination=shiftEvent(task,{days:1},new Date('2026-10-30T12:00:00Z'));
 assert.equal(destination.start.date,'2026-10-31');
});

test('task date moves PATCH only due and Undo can restore no due date; stale tasks are not overwritten',async()=>{
 const original={id:'x',title:'Keep title',notes:'Keep notes',status:'needsAction',etag:'task-etag'};
 let current={...original};const writes=[];
 const request=async(_url,options)=>{if(!options)return current;writes.push(options);const body=JSON.parse(options.body);current={...current,...body};return current;};
 const id=taskAsEvent(original,'list').id;
 const moved=await moveTask(id,{days:1},new Date(),{start:{date:'2026-10-31'},originalTaskDue:null},request);
 assert.equal(moved.task.due,'2026-10-31');assert.deepEqual(JSON.parse(writes[0].body),{due:'2026-10-31T00:00:00.000Z'});
 assert.equal(writes[0].method,'PATCH');assert.equal(writes[0].headers['If-Match'],'task-etag');
 const restored=await moveTask(id,{},new Date(),{taskDue:null,originalTaskDue:'2026-10-31'},request);
 assert.equal(restored.task.due,null);assert.deepEqual(JSON.parse(writes[1].body),{due:null});
 assert.equal(current.notes,'Keep notes');
 await moveTask(id,{date:'2026-12-15'},new Date(),null,request);
 assert.equal(current.due,'2026-12-15T00:00:00.000Z');
 current={...current,due:'2026-11-05T00:00:00Z'};
 await assert.rejects(moveTask(id,{days:1},new Date(),{start:{date:'2026-10-31'},originalTaskDue:null},request),/changed after/);
 assert.equal(writes.length,3);
 await assert.rejects(moveTask(id,{hours:4},new Date(),null,request),/dates only/);
 current={...current,status:'completed'};
 await assert.rejects(moveTask(id,{days:1},new Date(),null,request),/completed or deleted/);
});

test('task dismissal completes it remotely and Undo reopens it without changing date or notes',async()=>{
 const {setTaskCompleted}=await import('./tasks.js');
 let task={id:'fixture',status:'needsAction',due:'2026-10-30T00:00:00Z',notes:'Keep notes',etag:'version'};
 const patches=[];const request=async(_url,options)=>{if(!options)return task;const patch=JSON.parse(options.body);patches.push(patch);task={...task,...patch};return task;};
 const id=taskAsEvent(task,'list').id;
 await setTaskCompleted(id,true,request);assert.deepEqual(patches[0],{status:'completed'});
 await setTaskCompleted(id,false,request);assert.deepEqual(patches[1],{status:'needsAction',completed:null});
 assert.equal(task.due,'2026-10-30T00:00:00Z');assert.equal(task.notes,'Keep notes');
 await setTaskCompleted(id,false,request);assert.equal(patches.length,2);
});


test('dated and undated Tasks use the short-event background even with all-day date adapters',()=>{
 const dated=taskAsEvent({id:'dated',due:'2026-10-31T00:00:00Z'},'list');
 const undated=taskAsEvent({id:'undated'},'list');
 assert.equal(isEmphasized(dated),false);
 assert.equal(isEmphasized(undated),false);
 assert.equal(isEmphasized({...dated,task:undefined}),true);
});
