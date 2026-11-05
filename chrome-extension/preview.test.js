import test from 'node:test';
import assert from 'node:assert/strict';
import {displayWindow,nextDayPreviewWindow,itemsInWindow} from './model.js';
import {recentEvents} from './google.js';
process.env.TZ='America/Los_Angeles';

test('preview is exactly the day after lookahead, including 23/25-hour local days',()=>{
 for(const [stamp,hours] of [['2026-10-31T12:00:00-07:00',25],['2027-03-13T12:00:00-08:00',23]]){
  const review=displayWindow(Date.parse(stamp),7,0);
  const preview=nextDayPreviewWindow(review.lastExclusive);
  assert.equal(preview.first,review.lastExclusive);
  assert.equal(preview.lastExclusive-preview.first,hours*3600000);
  const event=ms=>({start:{dateTime:new Date(ms).toISOString()}});
  const rows=[event(preview.first-1),event(preview.first),event(preview.lastExclusive-1),event(preview.lastExclusive),{task:{due:null}}];
  assert.deepEqual(itemsInWindow(rows,preview),rows.slice(1,3));
 }
 const review=displayWindow(Date.parse('2026-11-04T12:00:00-08:00'),7,4);
 assert.equal(new Date(nextDayPreviewWindow(review.lastExclusive).first).getDate(),9);
});
test('preview fetch extends timeMax one local day and keeps review boundaries separate across pages',async()=>{
 const calls=[];
 const request=async raw=>{const url=new URL(raw);calls.push(url);return calls.length===1?{items:[{id:'fixture'}],nextPageToken:'next'}:{items:[]};};
 const fetched=await recentEvents('fixture@example.invalid',7,2,null,request,true);
 assert.equal(fetched.previewLastExclusive,nextDayPreviewWindow(fetched.lastExclusive).lastExclusive);
 assert.equal(calls.length,2);
 assert.equal(Date.parse(calls[0].searchParams.get('timeMax')),fetched.previewLastExclusive);
 assert.equal(calls[1].searchParams.get('pageToken'),'next');
 assert.equal(Date.parse(calls[1].searchParams.get('timeMax')),fetched.previewLastExclusive);
});
