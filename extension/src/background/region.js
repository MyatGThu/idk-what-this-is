// Country detection + store roster lookup.
// See docs/ARCHITECTURE.md "Country detection": settings.countryOverride wins,
// then timezone heuristic, then navigator.language region subtag, then 'AU'.

import { getSettings } from '../common/storage.js';
import { adaptersForCountry } from '../adapters/registry.js';

/** @typedef {import('../common/types.js').StoreAdapter} StoreAdapter */
/** @typedef {import('../common/types.js').Settings} Settings */

const SUPPORTED = new Set(['AU', 'US', 'GB']);

// Well-known fixed US zones; the multi-zone US states are matched by prefix below.
const US_ZONES = new Set([
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Detroit',
  'America/Boise',
  'America/Juneau',
  'America/Menominee',
  'America/Metlakatla',
  'America/Nome',
  'America/Sitka',
  'America/Yakutat',
  'America/Adak',
  'America/Indianapolis',
  'Pacific/Honolulu',
]);

const US_ZONE_PREFIXES = ['America/Indiana/', 'America/Kentucky/', 'America/North_Dakota/'];

/**
 * Normalize a country-ish string to a supported code, or null.
 * 'UK' is accepted as an alias for GB.
 * @param {*} value
 * @returns {'AU'|'US'|'GB'|null}
 */
function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const cc = value.trim().toUpperCase();
  if (cc === 'UK') return 'GB';
  return SUPPORTED.has(cc) ? /** @type {'AU'|'US'|'GB'} */ (cc) : null;
}

/**
 * @param {string|null} tz IANA timezone id.
 * @returns {'AU'|'US'|'GB'|null}
 */
function countryFromTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return null;
  if (tz.startsWith('Australia/')) return 'AU';
  if (US_ZONES.has(tz)) return 'US';
  if (US_ZONE_PREFIXES.some((prefix) => tz.startsWith(prefix))) return 'US';
  if (tz === 'Europe/London') return 'GB';
  return null;
}

/**
 * Region subtag of a BCP 47 language tag, when it is a supported country.
 * @param {*} lang e.g. 'en-AU', 'en-GB', 'zh-Hans-US'.
 * @returns {'AU'|'US'|'GB'|null}
 */
function countryFromLanguage(lang) {
  if (typeof lang !== 'string') return null;
  const subtags = lang.split('-');
  for (let i = 1; i < subtags.length; i++) {
    const cc = normalizeCountry(subtags[i]);
    if (cc) return cc;
  }
  return null;
}

/**
 * Detect the user's country for the supported store set.
 * @returns {Promise<'AU'|'US'|'GB'>}
 */
export async function detectCountry() {
  /** @type {Settings} */
  const settings = await getSettings();
  const override = normalizeCountry(settings && settings.countryOverride);
  if (override) return override;

  let tz = null;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    tz = null;
  }
  const fromTz = countryFromTimeZone(tz);
  if (fromTz) return fromTz;

  const fromLang = countryFromLanguage(typeof navigator !== 'undefined' ? navigator.language : null);
  if (fromLang) return fromLang;

  return 'AU';
}

/**
 * Country plus its enabled store adapters (roster minus settings.disabledStores).
 * @returns {Promise<{country: 'AU'|'US'|'GB', stores: StoreAdapter[]}>}
 */
export async function getRegion() {
  const settings = await getSettings();
  const country = await detectCountry();
  const disabled = new Set(
    settings && Array.isArray(settings.disabledStores) ? settings.disabledStores : [],
  );
  const roster = adaptersForCountry(country);
  const stores = (Array.isArray(roster) ? roster : []).filter((a) => a && !disabled.has(a.id));
  return { country, stores };
}
