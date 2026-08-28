// Canonical data shapes for Grocery Discount Hunter.
// This file is documentation-as-code: it exports factory/validator helpers and
// JSDoc typedefs that every other module codes against. See docs/ARCHITECTURE.md.

/**
 * @typedef {Object} GroceryItem
 * @property {string} id            Stable unique id (e.g. crypto.randomUUID()).
 * @property {string} name          What the user wants, e.g. "full cream milk 2L".
 * @property {number} quantity      How many to add to the cart (>= 1).
 * @property {number|null} maxPrice Optional per-unit price ceiling; null = no cap.
 * @property {string} notes         Free text ("any brand", "lactose free"...).
 */

/**
 * @typedef {Object} Product
 * @property {string} storeId       Adapter id, e.g. "au.woolworths".
 * @property {string} title         Product title as shown on the store page.
 * @property {string} url           Absolute product URL ('' when unavailable).
 * @property {number|null} price    Current price in the store's currency.
 * @property {number|null} wasPrice Pre-discount price when the store shows one.
 * @property {number|null} discountPct  Rounded percent off, when computable.
 * @property {boolean} onSpecial    True when the tile carries a promo/discount signal.
 * @property {number} tileIndex     Index of the tile in the scanned page, used by
 *                                  cart-injector to find the same tile again.
 * @property {string} query         The search term that produced this product;
 *                                  cart-injector re-opens this search to find the tile.
 */

/**
 * @typedef {Object} DiscountMatch
 * @property {string} listItemId
 * @property {string} listItemName
 * @property {Product} product
 * @property {number} score         Match confidence 0..1 (see matching.js).
 */

/**
 * @typedef {Object} StoreAdapter
 * Plain serializable descriptor (no functions) so it can cross messaging.
 * @property {string} id                '<cc>.<slug>', e.g. "au.coles".
 * @property {string} name
 * @property {string} country           ISO 3166-1 alpha-2, upper case.
 * @property {string} currency          ISO 4217, e.g. "AUD".
 * @property {string} homeUrl
 * @property {string} cartUrl
 * @property {string} searchUrlTemplate Contains the literal '{query}' placeholder.
 * @property {string[]} matchPatterns   Host match patterns for content scripts.
 * @property {StoreSelectors} selectors
 * @property {string|null} priceRegex   Optional price-extraction override (source
 *                                      of a RegExp with one capture group).
 */

/**
 * @typedef {Object} StoreSelectors
 * @property {string} productTile
 * @property {string} title
 * @property {string} price
 * @property {string} wasPrice
 * @property {string} promoBadge
 * @property {string} addToCartButton
 */

/**
 * @typedef {Object} LicenseState
 * @property {number} installDate       Epoch ms.
 * @property {number} trialDays         14.
 * @property {'trial'|'active'|'expired'} status  Last evaluated status.
 * @property {string|null} token        License token issued by the backend.
 * @property {string|null} email
 * @property {number|null} lastCheckedAt Epoch ms of last backend verification.
 */

/**
 * @typedef {Object} ScanState
 * @property {string} scanId
 * @property {number} startedAt
 * @property {string} region            Country code the scan ran for.
 * @property {boolean} done
 * @property {Object<string,'pending'|'scanning'|'done'|'error'>} storeStatus
 * @property {DiscountMatch[]} matches
 */

/**
 * @typedef {Object} Settings
 * @property {string|null} countryOverride
 * @property {string[]} disabledStores
 * @property {string} backendUrl        Licensing backend origin, no trailing slash.
 * @property {boolean} discountOnly     Always true in v1: only discounted matches
 *                                      are surfaced/added.
 */

export const TRIAL_DAYS = 14;
export const SUBSCRIPTION_PRICE_LABEL = '$6.99 / month';
export const DEFAULT_BACKEND_URL = 'http://localhost:8787';

/** @returns {Settings} */
export function defaultSettings() {
  return {
    countryOverride: null,
    disabledStores: [],
    backendUrl: DEFAULT_BACKEND_URL,
    discountOnly: true,
  };
}

/** @param {number} now @returns {LicenseState} */
export function freshLicense(now) {
  return {
    installDate: now,
    trialDays: TRIAL_DAYS,
    status: 'trial',
    token: null,
    email: null,
    lastCheckedAt: null,
  };
}

/**
 * @param {Partial<GroceryItem>} raw
 * @param {string} id
 * @returns {GroceryItem}
 */
export function normalizeGroceryItem(raw, id) {
  const quantity = Number(raw.quantity);
  const maxPrice = raw.maxPrice === null || raw.maxPrice === undefined || raw.maxPrice === ''
    ? null
    : Number(raw.maxPrice);
  return {
    id: raw.id || id,
    name: String(raw.name || '').trim(),
    quantity: Number.isFinite(quantity) && quantity >= 1 ? Math.floor(quantity) : 1,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : null,
    notes: String(raw.notes || '').trim(),
  };
}

/** True when a product tile shows an actual discount signal. */
export function isDiscounted(product) {
  if (!product) return false;
  if (product.onSpecial) return true;
  return product.wasPrice !== null && product.price !== null && product.wasPrice > product.price;
}

/** Percent off, rounded, or null when not computable. */
export function discountPct(price, wasPrice) {
  if (!Number.isFinite(price) || !Number.isFinite(wasPrice) || wasPrice <= 0 || price >= wasPrice) {
    return null;
  }
  return Math.round(((wasPrice - price) / wasPrice) * 100);
}
