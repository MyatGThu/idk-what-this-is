// Background entry point (loaded as a module by both manifests):
// install hook, message router, daily license re-check.
// Imports nothing from popup/options; content scripts are reached only via
// tabs.sendMessage inside scan.js.

import { ext } from '../common/compat.js';
import { getLicense } from '../common/storage.js';
import * as licensing from '../common/licensing.js';
import { getRegion } from './region.js';
import { startScan, getScanStatus, addToCart } from './scan.js';

/** @typedef {import('../common/types.js').LicenseState} LicenseState */

const LICENSE_ALARM = 'gdh-license-recheck';

/** @param {*} e @returns {string} */
function errorMessage(e) {
  return String((e && e.message) || e);
}

/**
 * Effective license snapshot. Tries the backend via refreshStatus(); a network
 * failure degrades to the locally stored license evaluated by the trial clock.
 * @returns {Promise<{license: LicenseState, status: 'trial'|'active'|'expired', daysLeft: number}>}
 */
async function licenseSnapshot() {
  let refreshed = null;
  try {
    refreshed = await licensing.refreshStatus();
  } catch {
    refreshed = null;
  }
  if (refreshed && typeof refreshed === 'object' && typeof refreshed.status === 'string') {
    const license = refreshed.license || (await getLicense());
    const daysLeft = Number.isFinite(refreshed.daysLeft)
      ? refreshed.daysLeft
      : licensing.daysLeft(license);
    return { license, status: refreshed.status, daysLeft };
  }
  const license = await getLicense();
  return { license, status: licensing.evaluate(license), daysLeft: licensing.daysLeft(license) };
}

function expiredResponse() {
  return { ok: false, code: 'LICENSE_EXPIRED', error: 'Free trial ended' };
}

/**
 * Firefox MV3 does not grant host permissions automatically; without them the
 * content scripts never inject and every store would silently report 'error'.
 * Returns the origin patterns still missing ([] when all granted or the
 * permissions API is unavailable, e.g. Chrome granted at install).
 * @param {Array<{matchPatterns: string[]}>} stores
 * @returns {Promise<string[]>}
 */
async function missingOrigins(stores) {
  if (!ext.permissions || typeof ext.permissions.contains !== 'function') return [];
  const origins = [...new Set(stores.flatMap((s) => s.matchPatterns || []))];
  if (origins.length === 0) return [];
  try {
    const granted = await ext.permissions.contains({ origins });
    return granted ? [] : origins;
  } catch {
    return [];
  }
}

// One handler per protocol message type (docs/ARCHITECTURE.md, popup/options -> background).
const handlers = {
  async GET_REGION() {
    const { country, stores } = await getRegion();
    return { ok: true, country, stores };
  },

  async START_SCAN() {
    const { status } = await licenseSnapshot();
    if (status === 'expired') return expiredResponse();
    const { stores } = await getRegion();
    const origins = await missingOrigins(stores);
    if (origins.length > 0) {
      return {
        ok: false,
        code: 'NO_HOST_ACCESS',
        origins,
        error: 'The browser has not granted access to the store sites yet.',
      };
    }
    return startScan();
  },

  async GET_SCAN_STATUS() {
    return getScanStatus();
  },

  async ADD_TO_CART(msg) {
    const { status } = await licenseSnapshot();
    if (status === 'expired') return expiredResponse();
    if (!msg || typeof msg.storeId !== 'string' || !Array.isArray(msg.items)) {
      return { ok: false, error: 'ADD_TO_CART requires storeId and items.' };
    }
    return addToCart(msg.storeId, msg.items);
  },

  async GET_LICENSE() {
    const { license, status, daysLeft } = await licenseSnapshot();
    return { ok: true, license, status, daysLeft };
  },

  async START_CHECKOUT(msg) {
    const email = msg && typeof msg.email === 'string' ? msg.email.trim() : '';
    if (!email) return { ok: false, error: 'An email address is required to start checkout.' };
    const result = await licensing.startCheckout(email);
    const url = typeof result === 'string' ? result : result && result.url;
    const devToken = result && typeof result === 'object' ? result.devToken : undefined;
    // Dev mode (no Stripe key on the backend): the license was just activated
    // locally — that is a success even though there is no checkout URL.
    if (devToken) return { ok: true, url: url || '', devToken };
    if (!url) return { ok: false, error: 'Checkout could not be started. Try again later.' };
    const token = result && typeof result === 'object' ? result.token : undefined;
    return { ok: true, url, token: token || null };
  },

  async ACTIVATE_LICENSE(msg) {
    const token = msg && typeof msg.token === 'string' ? msg.token.trim() : '';
    if (!token) return { ok: false, error: 'A license token is required.' };
    const result = await licensing.activate(token);
    const license = result && result.license ? result.license : result;
    if (!license) return { ok: false, error: 'License activation failed.' };
    return { ok: true, license };
  },
};

/** @param {*} msg @returns {Promise<{ok: boolean}>} */
async function handle(msg) {
  const type = msg && msg.type;
  const handler =
    typeof type === 'string' && Object.prototype.hasOwnProperty.call(handlers, type)
      ? handlers[type]
      : null;
  if (!handler) return { ok: false, error: `Unknown message type: ${String(type)}` };
  return handler(msg);
}

if (ext.runtime.onInstalled) {
  ext.runtime.onInstalled.addListener(() => {
    Promise.resolve(licensing.ensureLicense()).catch(() => {});
  });
}

if (ext.runtime.onMessage) {
  // Callback + `return true` is the one async-response pattern that works on
  // both Chrome and Firefox MV3; never return a promise from the listener.
  ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: errorMessage(e) }));
    return true;
  });
}

if (ext.alarms && typeof ext.alarms.create === 'function' && ext.alarms.onAlarm) {
  // Create the alarm only when absent: alarms.create with an existing name
  // REPLACES it, and this top-level code runs on every worker startup — an
  // unconditional create would reschedule the "daily" check 5 minutes after
  // each wake, i.e. a perpetual ~5-minute wake loop.
  (async () => {
    try {
      const existing =
        typeof ext.alarms.get === 'function' ? await ext.alarms.get(LICENSE_ALARM) : null;
      if (!existing) {
        await ext.alarms.create(LICENSE_ALARM, { delayInMinutes: 5, periodInMinutes: 24 * 60 });
      }
    } catch {
      // Alarms are an optimization; the message-path refreshStatus() suffices.
    }
  })();
  ext.alarms.onAlarm.addListener((alarm) => {
    if (alarm && alarm.name === LICENSE_ALARM) {
      Promise.resolve(licensing.refreshStatus()).catch(() => {});
    }
  });
}
