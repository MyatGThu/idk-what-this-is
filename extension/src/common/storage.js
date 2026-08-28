// Typed helpers over storage.local. See docs/ARCHITECTURE.md "Storage keys".

import { ext } from './compat.js';
import { defaultSettings } from './types.js';

/** @typedef {import('./types.js').GroceryItem} GroceryItem */
/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').LicenseState} LicenseState */
/** @typedef {import('./types.js').ScanState} ScanState */

const KEY_GROCERY_LIST = 'groceryList';
const KEY_SETTINGS = 'settings';
const KEY_LICENSE = 'license';
const KEY_LAST_SCAN = 'lastScan';

/** @param {string} key */
async function read(key) {
  const result = await ext.storage.local.get(key);
  return result ? result[key] : undefined;
}

/** @param {string} key @param {*} value */
async function write(key, value) {
  await ext.storage.local.set({ [key]: value });
}

// Objects merge recursively; arrays and scalars from `override` win wholesale.
function deepMerge(base, override) {
  if (override === undefined || override === null) return base;
  if (
    Array.isArray(base) ||
    Array.isArray(override) ||
    typeof base !== 'object' ||
    base === null ||
    typeof override !== 'object'
  ) {
    return override;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = deepMerge(base[key], value);
  }
  return out;
}

/** @returns {Promise<GroceryItem[]>} */
export async function getGroceryList() {
  return (await read(KEY_GROCERY_LIST)) ?? [];
}

/** @param {GroceryItem[]} items */
export async function setGroceryList(items) {
  await write(KEY_GROCERY_LIST, items);
}

/**
 * Stored settings deep-merged over defaults, so new settings keys added in
 * later versions pick up their default without a migration.
 * @returns {Promise<Settings>}
 */
export async function getSettings() {
  return deepMerge(defaultSettings(), (await read(KEY_SETTINGS)) ?? {});
}

/** @param {Settings} settings */
export async function setSettings(settings) {
  await write(KEY_SETTINGS, settings);
}

/** @returns {Promise<LicenseState|null>} */
export async function getLicense() {
  return (await read(KEY_LICENSE)) ?? null;
}

/** @param {LicenseState} license */
export async function setLicense(license) {
  await write(KEY_LICENSE, license);
}

/** @returns {Promise<ScanState|null>} */
export async function getLastScan() {
  return (await read(KEY_LAST_SCAN)) ?? null;
}

/** @param {ScanState} scan */
export async function setLastScan(scan) {
  await write(KEY_LAST_SCAN, scan);
}

/**
 * Invoke `cb(newValue)` whenever `key` changes in storage.local.
 * Safe no-op outside an extension context (e.g. under Node).
 * @param {string} key
 * @param {(newValue: *) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onChanged(key, cb) {
  const event = ext.storage.onChanged;
  if (!event || typeof event.addListener !== 'function') return () => {};
  const listener = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes, key)) cb(changes[key].newValue);
  };
  event.addListener(listener);
  return () => event.removeListener(listener);
}
