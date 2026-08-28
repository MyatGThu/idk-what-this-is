import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, daysLeft, ACTIVE_GRACE_MS } from '../extension/src/common/licensing.js';
import { freshLicense, TRIAL_DAYS } from '../extension/src/common/types.js';

const DAY = 864e5;
const T0 = 1700000000000; // arbitrary fixed install time

/** Active-token license verified against the backend at `checkedAt`. */
const activeLicense = (checkedAt) => ({
  ...freshLicense(T0),
  token: 'tok_1',
  status: 'active',
  lastCheckedAt: checkedAt,
});

describe('evaluate', () => {
  test('fresh install is in trial', () => {
    assert.equal(evaluate(freshLicense(T0), T0), 'trial');
  });

  test('day 13 is still trial', () => {
    assert.equal(evaluate(freshLicense(T0), T0 + 13 * DAY), 'trial');
  });

  test('trial ends exactly at installDate + trialDays', () => {
    assert.equal(evaluate(freshLicense(T0), T0 + TRIAL_DAYS * DAY - 1), 'trial');
    assert.equal(evaluate(freshLicense(T0), T0 + TRIAL_DAYS * DAY), 'expired');
  });

  test('day 15 without a token is expired', () => {
    assert.equal(evaluate(freshLicense(T0), T0 + 15 * DAY), 'expired');
  });

  test('a recently verified active token is active, even long after the trial', () => {
    const now = T0 + 100 * DAY;
    assert.equal(evaluate(activeLicense(now - 60 * 60 * 1000), now), 'active');
  });

  test('active status needs a recent verification: grace window boundary', () => {
    const now = T0 + 100 * DAY;
    assert.equal(evaluate(activeLicense(now - ACTIVE_GRACE_MS), now), 'active');
    assert.equal(evaluate(activeLicense(now - ACTIVE_GRACE_MS - 1), now), 'expired');
  });

  test('an active token never verified (lastCheckedAt null) falls back to the trial clock', () => {
    const license = { ...freshLicense(T0), token: 'tok_1', status: 'active' };
    assert.equal(evaluate(license, T0 + 2 * DAY), 'trial');
    assert.equal(evaluate(license, T0 + 100 * DAY), 'expired');
  });

  test('a stale verification inside the trial window degrades to trial, not expired', () => {
    const now = T0 + 2 * DAY;
    assert.equal(evaluate(activeLicense(now - ACTIVE_GRACE_MS - 1), now), 'trial');
  });

  test('a canceled token falls back to the trial clock (expired after it)', () => {
    const license = { ...freshLicense(T0), token: 'tok_1', status: 'canceled' };
    assert.equal(evaluate(license, T0 + 15 * DAY), 'expired');
    assert.equal(evaluate(license, T0 + 2 * DAY), 'trial');
  });

  test('missing license is expired', () => {
    assert.equal(evaluate(null, T0), 'expired');
  });
});

describe('daysLeft', () => {
  test('fresh install has the full trial left', () => {
    assert.equal(daysLeft(freshLicense(T0), T0), TRIAL_DAYS);
    assert.equal(TRIAL_DAYS, 14);
  });

  test('partial days round up', () => {
    assert.equal(daysLeft(freshLicense(T0), T0 + 13 * DAY), 1);
    assert.equal(daysLeft(freshLicense(T0), T0 + 13.5 * DAY), 1);
    assert.equal(daysLeft(freshLicense(T0), T0 + 0.5 * DAY), 14);
  });

  test('0 when expired', () => {
    assert.equal(daysLeft(freshLicense(T0), T0 + 15 * DAY), 0);
    assert.equal(daysLeft(freshLicense(T0), T0 + 100 * DAY), 0);
  });

  test('0 when active by verified token, even inside the trial window', () => {
    assert.equal(daysLeft(activeLicense(T0), T0), 0);
    assert.equal(daysLeft(activeLicense(T0 + 100 * DAY), T0 + 100 * DAY), 0);
  });

  test('an unverified active token still shows trial days (evaluate treats it as trial)', () => {
    const license = { ...freshLicense(T0), token: 'tok_1', status: 'active' };
    assert.equal(daysLeft(license, T0), TRIAL_DAYS);
  });

  test('canceled token with an expired trial has 0 days left', () => {
    const license = { ...freshLicense(T0), token: 'tok_1', status: 'canceled' };
    assert.equal(daysLeft(license, T0 + 15 * DAY), 0);
  });

  test('never negative, always an integer', () => {
    for (const offset of [0, 1, 13.9 * DAY, 14 * DAY, 500 * DAY]) {
      const left = daysLeft(freshLicense(T0), T0 + offset);
      assert.ok(Number.isInteger(left) && left >= 0, `offset ${offset} gave ${left}`);
    }
  });
});
