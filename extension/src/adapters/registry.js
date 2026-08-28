// Store adapter registry: every known adapter plus roster/search helpers.
// Adapters are plain serializable objects (see types.js StoreAdapter).

import woolworths from './au/woolworths.js';
import coles from './au/coles.js';
import iga from './au/iga.js';
import walmart from './us/walmart.js';
import kroger from './us/kroger.js';
import target from './us/target.js';
import tesco from './uk/tesco.js';
import sainsburys from './uk/sainsburys.js';

/** @typedef {import('../common/types.js').StoreAdapter} StoreAdapter */

/** @type {ReadonlyArray<StoreAdapter>} */
export const ADAPTERS = Object.freeze([
  woolworths,
  coles,
  iga,
  walmart,
  kroger,
  target,
  tesco,
  sainsburys,
]);

export const SUPPORTED_COUNTRIES = Object.freeze([
  { code: 'AU', name: 'Australia' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
]);

/**
 * @param {string} country ISO 3166-1 alpha-2, case-insensitive.
 * @returns {StoreAdapter[]}
 */
export function adaptersForCountry(country) {
  const cc = String(country || '').toUpperCase();
  return ADAPTERS.filter((a) => a.country === cc);
}

/**
 * @param {string} id Adapter id, e.g. "au.coles".
 * @returns {StoreAdapter|null}
 */
export function getAdapter(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}

/**
 * Expand an adapter's searchUrlTemplate for a query.
 * @param {StoreAdapter} adapter
 * @param {string} query
 * @returns {string}
 */
export function searchUrl(adapter, query) {
  return adapter.searchUrlTemplate.replace('{query}', encodeURIComponent(query));
}
