import test from 'node:test';
import assert from 'node:assert/strict';
import { requestAccess, REQUEST_ACCESS_MAILTO, SUPPORT_EMAIL } from './request-access.js';

test('access request addresses support and asks for an account without filling private data', () => {
  const url = new URL(REQUEST_ACCESS_MAILTO);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, 'noagoesplaces@gmail.com');
  assert.equal(url.searchParams.get('subject'), 'Notification Manager access request');
  assert.match(url.searchParams.get('body'), /Google account email to approve: \[enter your Google account email\]/);
  assert.doesNotMatch(url.href, /noamaan|token|calendar\.google/);
});

test('manual fallback is shown before launch and survives a silent missing email handler', async () => {
  const messages = [], calls = [];
  let finish;
  const pending = requestAccess(url => {
    assert.match(messages[0], /If no email draft opens/);
    calls.push(url);
    return new Promise(resolve => { finish = resolve; });
  }, text => messages.push(text));
  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes(SUPPORT_EMAIL));
  finish(); await pending;
  assert.deepEqual(calls, [REQUEST_ACCESS_MAILTO]);
  assert.equal(messages.length, 1);
  assert.doesNotMatch(messages[0], /sent|successfully/i);
});

test('synchronous and asynchronous launch errors preserve explicit manual instructions', async () => {
  for (const openMail of [() => { throw Error('Blocked'); }, async () => { throw Error('No handler'); }]) {
    const messages = [];
    await requestAccess(openMail, text => messages.push(text));
    assert.equal(messages.length, 2);
    assert.match(messages[1], /Could not open your email app/);
    assert.ok(messages[1].includes(SUPPORT_EMAIL));
    assert.match(messages[1], /Google account email/);
  }
});
