import test from "node:test";
import assert from "node:assert/strict";
import { PendingActionStore } from "./pending-actions.js";
function storageFixture(){const data={};return {data,storage:{get:async key=>structuredClone({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values))}};}
test("ten concurrent outbox saves survive storage and reopening without lost records",async()=>{
 const {storage}=storageFixture();const store=new PendingActionStore(storage,"fixture@example.invalid");
 await Promise.all(Array.from({length:10},(_,i)=>store.save({id:`action-${i}`,event:{id:`event-${i}`},stagedAtMs:123,destinationStart:{date:"2026-10-28"}})));
 const restored=await new PendingActionStore(storage,"FIXTURE@example.invalid").list();
 assert.equal(restored.length,10);assert.equal(new Set(restored.map(r=>r.action.id)).size,10);
 assert.equal(restored[0].action.stagedAtMs,123);
 await store.save(restored[0].action);assert.equal((await store.list()).length,10);
 await store.remove("action-0");assert.equal((await store.list()).length,9);
 assert.equal((await new PendingActionStore(storage,"other@example.invalid").list()).length,0);
});
test("network errors remain retryable while conflicts remain visible for review",async()=>{
 const {storage}=storageFixture();const store=new PendingActionStore(storage,"fixture@example.invalid");const action={id:"one"};
 await store.save(action);await store.fail(action,new TypeError("Failed to fetch"));
 assert.equal((await store.list())[0].retryable,true);
 await store.fail(action,Object.assign(new Error("Event changed"),{status:409}));
 assert.equal((await store.list())[0].retryable,false);assert.equal((await store.list())[0].error,"Event changed");
});
