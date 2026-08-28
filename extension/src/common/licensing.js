// Trial clock + subscription state machine + licensing-backend client.
// evaluate() and daysLeft() are pure; the rest touches storage/network.

import { TRIAL_DAYS, freshLicense } from './types.js';
import { getLicense, setLicense, getSettings } from './storage.js';

/** @typedef {import('./types.js').LicenseState} LicenseState */

const DAY_MS = 864e5;
const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
// A token counts as 'active' only while its last successful backend
// verification is this recent (12h re-check cadence + offline grace). Without
// a recency bound, a canceled subscription would stay active forever whenever
// the backend is unreachable.
export const ACTIVE_GRACE_MS = 72 * 60 * 60 * 1000;
const LICENSE_FETCH_TIMEOUT_MS = 5000;
const CHECKOUT_FETCH_TIMEOUT_MS = 10000;

function trialDaysOf(license) {
  return Number.isFinite(license.trialDays) ? license.trialDays : TRIAL_DAYS;
}

/**
 * Effective status. PURE.
 * @param {LicenseState|null} license
 * @param {number} [now]
 * @returns {'active'|'trial'|'expired'}
 */
export function evaluate(license, now = Date.now()) {
  if (!license) return 'expired';
  if (
    license.token &&
    license.status === 'active' &&
    Number.isFinite(license.lastCheckedAt) &&
    now - license.lastCheckedAt <= ACTIVE_GRACE_MS
  ) {
    return 'active';
  }
  if (now < license.installDate + trialDaysOf(license) * DAY_MS) return 'trial';
  return 'expired';
}

/**
 * Whole trial days remaining (ceil), 0 when active-by-token or expired. PURE.
 * @param {LicenseState|null} license
 * @param {number} [now]
 * @returns {number}
 */
export function daysLeft(license, now = Date.now()) {
  if (!license) return 0;
  if (evaluate(license, now) === 'active') return 0;
  const remainingMs = license.installDate + trialDaysOf(license) * DAY_MS - now;
  return remainingMs > 0 ? Math.ceil(remainingMs / DAY_MS) : 0;
}

/**
 * Read the stored license, creating and persisting a fresh trial when missing.
 * @param {number} [now]
 * @returns {Promise<LicenseState>}
 */
export async function ensureLicense(now = Date.now()) {
  let license = await getLicense();
  if (!license) {
    license = freshLicense(now);
    await setLicense(license);
  }
  return license;
}

function backendBase(settings) {
  return String(settings.backendUrl || '').replace(/\/+$/, '');
}

/**
 * GET/POST JSON with a timeout. Returns the parsed body, or null on network
 * failure / timeout / unparseable body (callers treat null as "unreachable").
 */
async function fetchJson(url, { method = 'GET', body, timeoutMs = LICENSE_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLicenseRecord(token, timeoutMs = LICENSE_FETCH_TIMEOUT_MS) {
  const settings = await getSettings();
  const data = await fetchJson(
    `${backendBase(settings)}/api/license/${encodeURIComponent(token)}`,
    { timeoutMs },
  );
  if (!data || typeof data.status !== 'string') return null;
  return data;
}

/**
 * Re-evaluate (and, at most every 12h, re-verify against the backend) the
 * stored license, persisting the result. Network failure keeps the current
 * status (grace).
 * @returns {Promise<{license: LicenseState, status: 'active'|'trial'|'expired', daysLeft: number}>}
 */
export async function refreshStatus() {
  const now = Date.now();
  const license = await ensureLicense(now);

  if (
    license.token &&
    (license.lastCheckedAt === null || now - license.lastCheckedAt > RECHECK_INTERVAL_MS)
  ) {
    const record = await fetchLicenseRecord(license.token);
    if (record) {
      if (record.status === 'active') {
        license.lastCheckedAt = now;
        license.status = 'active';
        if (record.email) license.email = record.email;
      } else if (record.status === 'pending') {
        // Payment not confirmed yet: leave lastCheckedAt unset so the next
        // refresh re-verifies immediately instead of waiting out the 12h gate.
        license.status = evaluate({ ...license, token: null }, now);
      } else {
        // canceled / unknown: keep the token, fall back to the trial clock.
        license.lastCheckedAt = now;
        license.status = evaluate({ ...license, token: null }, now);
      }
    }
  }

  const status = evaluate(license, now);
  license.status = status;
  await setLicense(license);
  return { license, status, daysLeft: daysLeft(license, now) };
}

/**
 * Start a Stripe Checkout session for `email`. When the backend runs in
 * offline dev mode and returns a devToken, the token is activated immediately.
 * In Stripe mode the backend also returns the pending license `token`; it is
 * persisted (without granting anything — evaluate() requires a verified
 * 'active' status) so a later refreshStatus()/ACTIVATE_LICENSE can flip the
 * license on once the Stripe webhook confirms payment.
 * Throws with the backend's error message on failure.
 * @param {string} email
 * @returns {Promise<{url: string, token: string|null, devToken?: string}>}
 */
export async function startCheckout(email) {
  const settings = await getSettings();
  const data = await fetchJson(`${backendBase(settings)}/api/checkout`, {
    method: 'POST',
    body: { email },
    timeoutMs: CHECKOUT_FETCH_TIMEOUT_MS,
  });
  if (!data) throw new Error('Could not reach the license server');
  if (data.ok === false || (!data.url && !data.devToken)) {
    throw new Error(data.error || 'Checkout failed');
  }
  if (data.devToken) {
    await activate(data.devToken);
    return { url: data.url || '', token: data.devToken, devToken: data.devToken };
  }
  const pendingToken = typeof data.token === 'string' && data.token !== '' ? data.token : null;
  if (pendingToken) {
    const now = Date.now();
    const license = await ensureLicense(now);
    // Never downgrade a currently verified subscription to a pending token.
    if (evaluate(license, now) !== 'active') {
      license.token = pendingToken;
      license.email = email;
      license.lastCheckedAt = null; // next refreshStatus() verifies immediately
      await setLicense(license);
    }
  }
  return { url: data.url, token: pendingToken };
}

/**
 * Verify `token` against the backend and persist it when active.
 * @param {string} token
 * @returns {Promise<LicenseState>}
 */
export async function activate(token) {
  const now = Date.now();
  const record = await fetchLicenseRecord(token);
  if (!record) throw new Error('Could not reach the license server');
  if (record.status !== 'active') throw new Error('Token is not active');

  const license = (await getLicense()) || freshLicense(now);
  license.token = token;
  license.status = 'active';
  license.email = record.email || license.email || null;
  license.lastCheckedAt = now;
  await setLicense(license);
  return license;
}
