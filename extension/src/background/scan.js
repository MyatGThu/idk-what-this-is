// Scan engine + cart filler, per docs/ARCHITECTURE.md "Scan flow per store" /
// "Cart flow per store".
//
// Hard rules honored here:
// - Cart filling stops at the cart: the only navigation after adding items is
//   opening the store's cart page for the USER to review. No checkout, ever.
// - Only user-approved items reach ADD_PRODUCTS, and only for the named store.

import { ext, waitForTabComplete, navigateAndWait } from '../common/compat.js';
import { getGroceryList, getSettings, getLastScan, setLastScan } from '../common/storage.js';
import { bestMatches } from '../common/matching.js';
import { getAdapter, searchUrl } from '../adapters/registry.js';
import { getRegion } from './region.js';

/** @typedef {import('../common/types.js').GroceryItem} GroceryItem */
/** @typedef {import('../common/types.js').Product} Product */
/** @typedef {import('../common/types.js').StoreAdapter} StoreAdapter */
/** @typedef {import('../common/types.js').ScanState} ScanState */
/** @typedef {import('../common/types.js').Settings} Settings */

const MAX_SCAN_ITEMS = 30; // cap: first 30 grocery items per scan
const SETTLE_DELAY_MS = 2500; // SPA render settle after tab reports 'complete'
const QUERY_DELAY_MS = 800; // polite minimum between queries on one store
const MAX_QUANTITY = 10;
// A persisted scan still marked running after this long is orphaned (service
// worker died mid-scan) and gets reconciled by getScanStatus().
const MAX_SCAN_AGE_MS = 20 * 60 * 1000;
// ADD_TO_CART only acts on reasonably fresh results; store discounts change.
const MAX_CART_SCAN_AGE_MS = 6 * 60 * 60 * 1000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {{scanId: string}|null} */
let activeScan = null;

/**
 * Start a scan across all enabled stores for the current region.
 * Returns immediately with the scanId; progress is polled via getScanStatus().
 * Refuses concurrent scans by returning the running scan's id.
 * @returns {Promise<{ok: true, scanId: string}|{ok: false, error: string}>}
 */
export async function startScan() {
  // Reserve the lock synchronously, before any await, so two rapid
  // START_SCAN messages cannot both pass the guard (TOCTOU).
  if (activeScan) return { ok: true, scanId: activeScan.scanId };
  const scanId = crypto.randomUUID();
  activeScan = { scanId };
  try {
    const [list, settings, region] = await Promise.all([
      getGroceryList(),
      getSettings(),
      getRegion(),
    ]);
    const items = (Array.isArray(list) ? list : [])
      .filter((it) => it && typeof it.name === 'string' && it.name.trim() !== '')
      .slice(0, MAX_SCAN_ITEMS);
    if (items.length === 0) {
      activeScan = null;
      return { ok: false, error: 'Your grocery list is empty — add items before scanning.' };
    }
    const { country, stores } = region;
    if (stores.length === 0) {
      activeScan = null;
      return { ok: false, error: `No enabled stores for ${country}. Check the options page.` };
    }

    /** @type {ScanState} */
    const scan = {
      scanId,
      startedAt: Date.now(),
      region: country,
      done: false,
      storeStatus: Object.fromEntries(stores.map((s) => [s.id, 'pending'])),
      matches: [],
    };
    await setLastScan(scan);

    // Stores run in parallel; each scanStore() catches its own failures.
    Promise.all(stores.map((store) => scanStore(scan, store, items, settings)))
      .catch(() => {})
      .then(async () => {
        scan.done = true;
        try {
          await setLastScan(scan);
        } catch {
          // Storage failure at the very end must not leave activeScan stuck.
        }
        if (activeScan && activeScan.scanId === scanId) activeScan = null;
      });

    return { ok: true, scanId };
  } catch (e) {
    activeScan = null;
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/**
 * Scan one store in its own inactive tab: navigate to each item's search page
 * sequentially, collect SCAN_PAGE products, then merge bestMatches() into the
 * shared ScanState. Never throws; failures mark storeStatus 'error'.
 * @param {ScanState} scan
 * @param {StoreAdapter} adapter
 * @param {GroceryItem[]} items
 * @param {Settings} settings
 */
async function scanStore(scan, adapter, items, settings) {
  let tabId = null;
  try {
    scan.storeStatus[adapter.id] = 'scanning';
    await setLastScan(scan);

    const tab = await ext.tabs.create({ url: searchUrl(adapter, items[0].name), active: false });
    tabId = tab.id;

    /** @type {Product[]} */
    const products = [];
    let succeeded = 0;
    for (let i = 0; i < items.length; i++) {
      try {
        if (i > 0) {
          await delay(QUERY_DELAY_MS);
          await navigateAndWait(tabId, searchUrl(adapter, items[i].name));
        } else {
          await waitForTabComplete(tabId);
        }
        await delay(SETTLE_DELAY_MS);
        const res = await ext.tabs.sendMessage(tabId, {
          type: 'SCAN_PAGE',
          adapter,
          query: items[i].name,
        });
        if (res && res.ok && Array.isArray(res.products)) {
          products.push(...res.products);
          succeeded += 1;
        }
      } catch {
        // A single blocked/broken page must not sink the whole store.
      }
    }

    const storeMatches = bestMatches(items, products, {
      discountOnly: !settings || settings.discountOnly !== false,
    });
    scan.matches = scan.matches
      .filter((m) => !(m && m.product && m.product.storeId === adapter.id))
      .concat(Array.isArray(storeMatches) ? storeMatches : []);
    scan.storeStatus[adapter.id] = succeeded > 0 ? 'done' : 'error';
  } catch {
    scan.storeStatus[adapter.id] = 'error';
  } finally {
    try {
      await setLastScan(scan);
    } catch {
      // Best effort; the final startScan() persist will retry.
    }
    if (tabId != null) {
      try {
        await ext.tabs.remove(tabId);
      } catch {
        // Tab was already closed (e.g. by the user).
      }
    }
  }
}

/**
 * @returns {Promise<{ok: true, scan: ScanState|null}|{ok: false, error: string}>}
 */
export async function getScanStatus() {
  try {
    const scan = await getLastScan();
    // Reconcile a scan orphaned by a service-worker/browser shutdown: the
    // in-memory promise chain died, so nothing would ever mark it done and
    // the popup would poll "Scanning…" forever.
    if (scan && !scan.done) {
      const orphaned = !activeScan || activeScan.scanId !== scan.scanId;
      const tooOld = Date.now() - scan.startedAt > MAX_SCAN_AGE_MS;
      if (orphaned || tooOld) {
        const statuses = scan.storeStatus || {};
        for (const id of Object.keys(statuses)) {
          if (statuses[id] === 'pending' || statuses[id] === 'scanning') statuses[id] = 'error';
        }
        scan.done = true;
        await setLastScan(scan);
      }
    }
    return { ok: true, scan: scan || null };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** @param {*} q @returns {number} */
function clampQuantity(q) {
  const n = Math.floor(Number(q));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_QUANTITY);
}

/**
 * Add the user's approved products to one store's cart, then open that store's
 * cart page in an ACTIVE tab for the user to review. Never touches checkout.
 * @param {string} storeId
 * @param {Array<{product: Product, quantity: number}>} items
 * @returns {Promise<{ok: true, added: number, failed: number}|{ok: false, error: string}>}
 */
export async function addToCart(storeId, items) {
  try {
    const adapter = getAdapter(storeId);
    if (!adapter) return { ok: false, error: `Unknown store: ${String(storeId)}` };

    // Results go stale: prices, tiles, and stock all move. Refuse to act on an
    // old scan rather than risk adding the wrong (no-longer-discounted) items.
    const lastScan = await getLastScan();
    if (!lastScan || Date.now() - lastScan.startedAt > MAX_CART_SCAN_AGE_MS) {
      return {
        ok: false,
        code: 'SCAN_STALE',
        error: 'These results are stale — run a fresh scan before adding to cart.',
      };
    }

    // Only user-approved products, and only ones belonging to this store.
    const approved = (Array.isArray(items) ? items : [])
      .filter(
        (it) =>
          it &&
          it.product &&
          it.product.storeId === storeId &&
          typeof it.product.query === 'string' &&
          it.product.query !== '',
      )
      .map((it) => ({ product: it.product, quantity: clampQuantity(it.quantity) }));
    if (approved.length === 0) {
      return { ok: false, error: 'No approved items to add for this store.' };
    }

    /** @type {Map<string, Array<{product: Product, quantity: number}>>} */
    const groups = new Map();
    for (const it of approved) {
      const group = groups.get(it.product.query);
      if (group) group.push(it);
      else groups.set(it.product.query, [it]);
    }

    let added = 0;
    let failed = 0;
    let tabId = null;
    try {
      for (const [query, group] of groups) {
        try {
          if (tabId == null) {
            const tab = await ext.tabs.create({ url: searchUrl(adapter, query), active: false });
            tabId = tab.id;
            await waitForTabComplete(tabId);
          } else {
            await delay(QUERY_DELAY_MS);
            await navigateAndWait(tabId, searchUrl(adapter, query));
          }
          await delay(SETTLE_DELAY_MS);
          const res = await ext.tabs.sendMessage(tabId, {
            type: 'ADD_PRODUCTS',
            adapter,
            items: group,
          });
          if (res && res.ok) {
            added += Number(res.added) || 0;
            failed += Number(res.failed) || 0;
          } else {
            failed += group.length;
          }
        } catch {
          failed += group.length;
        }
      }
    } finally {
      if (tabId != null) {
        try {
          await ext.tabs.remove(tabId);
        } catch {
          // Tab already gone.
        }
      }
    }

    // Hand over to the user: cart review and checkout are always human actions.
    try {
      await ext.tabs.create({ url: adapter.cartUrl, active: true });
    } catch {
      // Cart page failing to open does not undo the additions.
    }

    return { ok: true, added, failed };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
