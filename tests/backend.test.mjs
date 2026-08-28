// Unit tests for backend/server.js (no network, no Stripe).
// Run: node --test tests/backend.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createStore,
  issueLicense,
  getLicense,
  licenseLookup,
  verifyStripeSignature,
} from '../backend/server.js';

function tmpDataFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdh-backend-test-'));
  return path.join(dir, 'licenses.json');
}

test('issueLicense/getLicense round-trip persists to DATA_FILE', () => {
  const dataFile = tmpDataFile();
  const store = createStore(dataFile);

  const issued = issueLicense(store, 'shopper@example.com', 'pending');
  assert.match(issued.token, /^[0-9a-f-]{36}$/);
  assert.equal(issued.email, 'shopper@example.com');
  assert.equal(issued.status, 'pending');
  assert.ok(Number.isFinite(issued.createdAt));

  // Same store instance.
  assert.deepEqual(getLicense(store, issued.token), issued);

  // Reload from disk: the record must survive the file round-trip.
  const reloaded = createStore(dataFile);
  assert.deepEqual(getLicense(reloaded, issued.token), issued);
});

test('issueLicense supports an in-memory store (dataFile null)', () => {
  const store = createStore(null);
  const issued = issueLicense(store, 'dev@example.com', 'active');
  assert.equal(getLicense(store, issued.token).status, 'active');
});

test('getLicense returns null for unknown or malicious tokens', () => {
  const store = createStore(null);
  assert.equal(getLicense(store, crypto.randomUUID()), null);
  assert.equal(getLicense(store, ''), null);
  assert.equal(getLicense(store, '__proto__'), null);
});

test('licenseLookup maps unknown tokens to ok:true + status unknown', () => {
  const store = createStore(null);
  assert.deepEqual(licenseLookup(store, 'nope-never-issued'), {
    ok: true,
    status: 'unknown',
    email: null,
  });

  const issued = issueLicense(store, 'a@b.co', 'active');
  assert.deepEqual(licenseLookup(store, issued.token), {
    ok: true,
    status: 'active',
    email: 'a@b.co',
  });
});

// ---------------------------------------------------------------------------
// Stripe webhook signatures

const SECRET = 'whsec_test_secret';

function signedHeader(secret, rawBody, tSeconds) {
  const v1 = crypto.createHmac('sha256', secret).update(`${tSeconds}.${rawBody}`).digest('hex');
  return `t=${tSeconds},v1=${v1}`;
}

test('verifyStripeSignature accepts a freshly signed payload', () => {
  const now = Date.now();
  const body = JSON.stringify({ type: 'checkout.session.completed' });
  const header = signedHeader(SECRET, body, Math.floor(now / 1000));
  assert.equal(verifyStripeSignature(SECRET, header, body, now), true);
});

test('verifyStripeSignature accepts when one of several v1 entries matches', () => {
  const now = Date.now();
  const body = '{"id":"evt_1"}';
  const t = Math.floor(now / 1000);
  const good = signedHeader(SECRET, body, t);
  const header = `t=${t},v1=${'0'.repeat(64)},${good.split(',')[1]}`;
  assert.equal(verifyStripeSignature(SECRET, header, body, now), true);
});

test('verifyStripeSignature rejects the wrong secret', () => {
  const now = Date.now();
  const body = '{"id":"evt_2"}';
  const header = signedHeader('whsec_other_secret', body, Math.floor(now / 1000));
  assert.equal(verifyStripeSignature(SECRET, header, body, now), false);
});

test('verifyStripeSignature rejects a tampered body', () => {
  const now = Date.now();
  const header = signedHeader(SECRET, '{"amount":1}', Math.floor(now / 1000));
  assert.equal(verifyStripeSignature(SECRET, header, '{"amount":9999}', now), false);
});

test('verifyStripeSignature rejects a stale timestamp (> 5 minutes)', () => {
  const now = 1_700_000_000_000; // fixed whole-second clock; nowMs is injectable
  const body = '{"id":"evt_3"}';
  const staleT = Math.floor(now / 1000) - 6 * 60;
  const header = signedHeader(SECRET, body, staleT);
  assert.equal(verifyStripeSignature(SECRET, header, body, now), false);

  // Exactly at the tolerance boundary is still accepted.
  const edgeT = Math.floor(now / 1000) - 5 * 60;
  assert.equal(verifyStripeSignature(SECRET, signedHeader(SECRET, body, edgeT), body, now), true);
});

test('verifyStripeSignature rejects malformed or missing headers', () => {
  const body = '{}';
  assert.equal(verifyStripeSignature(SECRET, '', body), false);
  assert.equal(verifyStripeSignature(SECRET, undefined, body), false);
  assert.equal(verifyStripeSignature(SECRET, 'not-a-signature', body), false);
  assert.equal(verifyStripeSignature(SECRET, 'v1=deadbeef', body), false); // no t=
  assert.equal(verifyStripeSignature(SECRET, `t=${Math.floor(Date.now() / 1000)}`, body), false); // no v1=
  assert.equal(verifyStripeSignature('', signedHeader(SECRET, body, Math.floor(Date.now() / 1000)), body), false);
});
