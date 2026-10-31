import test from 'node:test';
import assert from 'node:assert/strict';
import {reconnectGoogleAccess} from './authorization.js';

test('reconnect clears stale tokens before explicitly requesting consent',async()=>{
 const calls=[];let finishClear;
 const identity={clearAllCachedAuthTokens:()=>new Promise(resolve=>{finishClear=()=>{calls.push('cleared');resolve();};})};
 const result=reconnectGoogleAccess(identity,async interactive=>{calls.push(['connect',interactive]);return 'connected';});
 assert.deepEqual(calls,[]);finishClear();
 assert.equal(await result,'connected');
 assert.deepEqual(calls,['cleared',['connect',true]]);
});
test('failed token clearing does not silently claim reconnection succeeded',async()=>{
 let called=false;
 await assert.rejects(reconnectGoogleAccess({clearAllCachedAuthTokens:async()=>{throw Error('Auth unavailable');}},async()=>{called=true;}),/Auth unavailable/);
 assert.equal(called,false);
});

test('only authorization failures trigger consent, not connectivity or API configuration errors',async()=>{
 const {needsGoogleConsent}=await import('./authorization.js');
 for(const message of ['OAuth2 not granted or revoked.','Request had insufficient authentication scopes.','Tasks authorization required']) assert.equal(needsGoogleConsent(Error(message)),true);
 assert.equal(needsGoogleConsent({reason:'ACCESS_TOKEN_SCOPE_INSUFFICIENT',message:'Forbidden'}),true);
 assert.equal(needsGoogleConsent({reason:'SERVICE_DISABLED',status:403,message:'API disabled'}),false);
 for(const message of ['Network offline','Google Tasks API has not been used in this project before or is disabled','Quota exceeded']) assert.equal(needsGoogleConsent(Error(message)),false);
});
