import test from 'node:test';
import assert from 'node:assert/strict';
import {clearDismissedPriority,restoreDismissedPriority,moveEvent} from './google.js';
import {setTaskCompleted,moveTask,taskAsEvent} from './tasks.js';

test('task dismissal clears priority atomically, is retry-safe, and Undo restores it without touching dates/notes',async()=>{
 for(const title of ['Synthetic.','Synthetic ★','Synthetic (pri)']){
  let task={id:'fixture',title,status:'needsAction',due:'2026-11-11T00:00:00Z',notes:'Keep notes',etag:'fixture'};
  const writes=[];const request=async(_url,options)=>{if(!options)return structuredClone(task);const patch=JSON.parse(options.body);writes.push(patch);Object.assign(task,patch);return structuredClone(task);};
  const id=taskAsEvent(task,'list').id;
  await setTaskCompleted(id,true,request);
  assert.deepEqual(writes[0],{status:'completed',title:'Synthetic'});
  await setTaskCompleted(id,true,request);assert.equal(writes.length,1);
  await setTaskCompleted(id,false,request,title);
  assert.deepEqual(writes[1],{status:'needsAction',completed:null,title});
  assert.equal(task.title,title);assert.equal(task.due,'2026-11-11T00:00:00Z');assert.equal(task.notes,'Keep notes');
  await moveTask(id,{days:1},new Date('2026-11-11T12:00:00Z'),null,request);
  assert.equal(task.title,title);assert.deepEqual(Object.keys(writes.at(-1)),['due']);
  await setTaskCompleted(id,true,request);task.title='Edited elsewhere';
  await setTaskCompleted(id,false,request,title);assert.equal(task.title,'Edited elsewhere');assert.equal(Object.hasOwn(writes.at(-1),'title'),false);
 }
});
test('event dismissal clears only eligible priority titles and its Undo restores the marker; moves retain it',async()=>{
 let current={id:'fixture',summary:'Synthetic.',etag:'fixture',start:{dateTime:'2026-11-11T12:00:00Z'},end:{dateTime:'2026-11-11T12:15:00Z'}};
 const original=structuredClone(current),writes=[];
 const request=async(_url,options)=>{if(!options)return structuredClone(current);const body=JSON.parse(options.body);writes.push(body);Object.assign(current,body);return structuredClone(current);};
 assert.equal(await clearDismissedPriority('fixture@example.invalid',original,request),true);
 assert.deepEqual(writes[0],{summary:'Synthetic'});
 const restored=await restoreDismissedPriority('fixture@example.invalid',original,request);
 assert.equal(restored.summary,'Synthetic.');assert.equal(current.summary,'Synthetic.');
 await moveEvent('fixture@example.invalid','fixture',{days:1},new Date('2026-11-11T12:00:00Z'),null,request);
 assert.equal(current.summary,'Synthetic.');
 let calls=0;const blocked=async()=>{calls++;throw Error('No request expected');};
 assert.equal(await clearDismissedPriority('fixture@example.invalid',{...original,summary:'Plain'},blocked),false);
 assert.equal(await clearDismissedPriority('fixture@example.invalid',{...original,attendees:[{email:'guest@example.invalid'}]},blocked),false);assert.equal(calls,0);
 current={...original,attendees:[{email:'guest@example.invalid'}]};const before=writes.length;
 assert.equal(await clearDismissedPriority('fixture@example.invalid',original,request),false);assert.equal(writes.length,before);
 current={...original,summary:'Edited elsewhere'};
 assert.equal(await clearDismissedPriority('fixture@example.invalid',original,request),false);assert.equal(writes.length,before);
});
