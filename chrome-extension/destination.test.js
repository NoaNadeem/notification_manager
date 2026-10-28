import test from "node:test";
import assert from "node:assert/strict";
import { savedMoveState } from "./destination.js";
const originalStart = {dateTime:"2026-10-27T12:00:00Z"};
const destination = {originalStart,start:{dateTime:"2026-10-28T12:00:00Z"},end:{dateTime:"2026-10-28T12:15:00Z"}};
test("a queued move retries its saved destination and recognizes a previously successful response",()=>{
 assert.equal(savedMoveState({start:originalStart},destination),"ready");
 assert.equal(savedMoveState({start:{dateTime:"2026-10-28T05:00:00-07:00"},end:destination.end},destination),"applied");
});
test("retry refuses to overwrite an event moved elsewhere after the click",()=>{
 assert.throws(()=>savedMoveState({start:{dateTime:"2026-11-01T12:00:00Z"}},destination),{status:409});
});
test("all-day retry recognizes the original and the saved date span",()=>{
 const target={originalStart:{date:"2026-10-27"},start:{date:"2026-10-28"},end:{date:"2026-10-30"}};
 assert.equal(savedMoveState({start:target.originalStart},target),"ready");
 assert.equal(savedMoveState({start:target.start,end:target.end},target),"applied");
});
