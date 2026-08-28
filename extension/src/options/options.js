// Options page: country override, per-store enable/disable, backend URL,
// license status card. See docs/ARCHITECTURE.md "Storage keys" and the
// message protocol table.

import { ext } from '../common/compat.js';
import { getSettings, setSettings } from '../common/storage.js';
import { SUPPORTED_COUNTRIES, adaptersForCountry } from '../adapters/registry.js';
import { DEFAULT_BACKEND_URL, SUBSCRIPTION_PRICE_LABEL } from '../common/types.js';

/** @typedef {import('../common/types.js').Settings} Settings */
/** @typedef {import('../common/types.js').LicenseState} LicenseState */

const $ = (id) => document.getElementById(id);

/** @type {Settings} */
let settings;
/** Country shown when the select is on "Auto-detect". */
let autoCountry = 'AU';
let saveStatusTimer = null;

/**
 * Send a runtime message; never throws — always resolves to the protocol's
 * `{ok, ...}` response shape.
 * @param {{type: string}} message
 * @returns {Promise<{ok: boolean, error?: string, [key: string]: *}>}
 */
async function sendMessage(message) {
  try {
    const response = await ext.runtime.sendMessage(message);
    if (response && typeof response === 'object') return response;
    return { ok: false, error: 'No response from background' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Preview-only fallback for "Auto-detect": background/region.js is
// authoritative, but GET_REGION applies the saved override, so it cannot say
// what auto-detect would pick while an override is stored.
function localCountryGuess() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (tz.startsWith('Australia/')) return 'AU';
    if (tz === 'Europe/London') return 'GB';
    if (tz.startsWith('America/')) return 'US';
    const region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
    if (SUPPORTED_COUNTRIES.some((c) => c.code === region)) return region;
  } catch {
    // ignore — fall through to default
  }
  return 'AU';
}

function effectiveCountry() {
  return $('country').value || autoCountry;
}

function renderCountrySelect() {
  const select = $('country');
  select.textContent = '';
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = 'Auto-detect';
  select.appendChild(auto);
  for (const { code, name } of SUPPORTED_COUNTRIES) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = `${name} (${code})`;
    select.appendChild(option);
  }
  select.value = settings.countryOverride || '';
  if (select.selectedIndex === -1) select.value = '';
}

function renderStores() {
  const container = $('stores');
  container.textContent = '';
  const adapters = adaptersForCountry(effectiveCountry());
  if (adapters.length === 0) {
    const none = document.createElement('p');
    none.className = 'hint';
    none.textContent = 'No supported stores for this country yet.';
    container.appendChild(none);
    return;
  }
  for (const adapter of adapters) {
    const label = document.createElement('label');
    label.className = 'store';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.id = adapter.id;
    box.checked = !settings.disabledStores.includes(adapter.id);
    const name = document.createElement('span');
    name.textContent = adapter.name;
    label.append(box, name);
    container.appendChild(label);
  }
}

/**
 * @param {string} text
 * @param {boolean} [isError]
 */
function flashSaveStatus(text, isError = false) {
  const el = $('save-status');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.style.opacity = '1';
  clearTimeout(saveStatusTimer);
  saveStatusTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, 2500);
}

async function save() {
  const countryOverride = $('country').value || null;
  const shownIds = adaptersForCountry(effectiveCountry()).map((a) => a.id);
  const uncheckedIds = [...$('stores').querySelectorAll('input[type="checkbox"]')]
    .filter((box) => !box.checked)
    .map((box) => box.dataset.id);
  // Keep disabled ids belonging to countries not currently shown.
  const disabledStores = settings.disabledStores
    .filter((id) => !shownIds.includes(id))
    .concat(uncheckedIds);
  const backendUrl =
    ($('backend-url').value.trim() || DEFAULT_BACKEND_URL).replace(/\/+$/, '') ||
    DEFAULT_BACKEND_URL;

  const next = { ...settings, countryOverride, disabledStores, backendUrl };
  try {
    await setSettings(next);
    settings = next;
    $('backend-url').value = settings.backendUrl;
    flashSaveStatus('Saved');
  } catch (e) {
    flashSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

async function renderLicense() {
  const statusEl = $('license-status');
  const detailEl = $('license-detail');
  const emailEl = $('license-email');

  const res = await sendMessage({ type: 'GET_LICENSE' });
  if (!res.ok) {
    statusEl.textContent = 'Unavailable';
    statusEl.className = 'badge unknown';
    detailEl.textContent = res.error || 'Could not read license state';
    emailEl.textContent = '';
    return;
  }

  /** @type {LicenseState} */
  const license = res.license;
  const daysLeft = Number(res.daysLeft) || 0;
  const status = license && license.status ? license.status : 'trial';
  const labels = { trial: 'Trial', active: 'Active', expired: 'Expired' };
  statusEl.textContent = labels[status] || status;
  statusEl.className = `badge ${labels[status] ? status : 'unknown'}`;

  if (status === 'trial') {
    detailEl.textContent = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} of free trial left, then ${SUBSCRIPTION_PRICE_LABEL}`;
  } else if (status === 'active') {
    detailEl.textContent = `Subscription active (${SUBSCRIPTION_PRICE_LABEL})`;
  } else {
    detailEl.textContent = `Trial ended — subscribe for ${SUBSCRIPTION_PRICE_LABEL}`;
  }
  emailEl.textContent = license && license.email ? license.email : '';
}

async function openPaywall() {
  try {
    await ext.tabs.create({ url: ext.runtime.getURL('src/paywall/paywall.html') });
  } catch (e) {
    flashSaveStatus(
      `Could not open subscription page: ${e instanceof Error ? e.message : String(e)}`,
      true,
    );
  }
}

async function init() {
  settings = await getSettings();

  const region = await sendMessage({ type: 'GET_REGION' });
  autoCountry =
    settings.countryOverride === null && region.ok && region.country
      ? region.country
      : localCountryGuess();

  renderCountrySelect();
  renderStores();
  $('backend-url').value = settings.backendUrl;

  $('country').addEventListener('change', renderStores);
  $('save').addEventListener('click', save);
  $('manage-subscription').addEventListener('click', openPaywall);

  await renderLicense();
}

init().catch((e) => {
  flashSaveStatus(`Options failed to load: ${e instanceof Error ? e.message : String(e)}`, true);
});
