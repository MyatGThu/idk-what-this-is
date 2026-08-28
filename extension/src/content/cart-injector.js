// Content script: clicks add-to-cart on tiles matching user-approved products.
// No ES imports allowed here — self-contained; the StoreAdapter descriptor
// arrives in the ADD_PRODUCTS message (see docs/ARCHITECTURE.md).
//
// SAFETY: this script clicks only add-to-cart buttons inside the located tile.
// It never navigates, never submits forms, and refuses any button whose text
// or aria-label looks like checkout/payment. Checkout is always a human action.

(() => {
  'use strict';

  if (window.__gdhCartInjectorLoaded) return;
  window.__gdhCartInjectorLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const MAX_CLICKS = 10;
  const CLICK_GAP_MS = 400;
  const FORBIDDEN_BUTTON_RE = /check\s*out|checkout|pay|place order|purchase/i;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  /**
   * Locate the tile for a product: exact normalized title match first,
   * recorded tileIndex as fallback — but ONLY when the tile at that index
   * still shows the same product. A reordered/refreshed results page must
   * yield "not found" (failed), never a click on something the user did not
   * approve.
   * @param {Element[]} tiles
   * @param {string} titleSelector
   * @param {{title: string, tileIndex: number}} product
   * @returns {Element|null}
   */
  function findTile(tiles, titleSelector, product) {
    const wanted = normalize(product.title);
    if (!wanted) return null;
    for (const tile of tiles) {
      const titleEl = tile.querySelector(titleSelector);
      if (titleEl && normalize(titleEl.textContent) === wanted) return tile;
    }
    const byIndex = tiles[product.tileIndex];
    if (!byIndex) return null;
    const actual = normalize(textOfTitle(byIndex, titleSelector));
    if (!actual) return null;
    if (actual === wanted || actual.includes(wanted) || wanted.includes(actual)) return byIndex;
    return null;
  }

  /** @param {Element} tile @param {string} titleSelector */
  function textOfTitle(tile, titleSelector) {
    const el = tile.querySelector(titleSelector);
    return el && el.textContent ? el.textContent : '';
  }

  /** @param {Element} button */
  function looksLikeCheckout(button) {
    const label = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`;
    return FORBIDDEN_BUTTON_RE.test(label);
  }

  /**
   * @param {*} msg ADD_PRODUCTS payload {adapter, items:[{product, quantity}]}
   * @returns {Promise<{ok: boolean, added?: number, failed?: number, error?: string}>}
   */
  async function addProducts(msg) {
    const adapter = msg.adapter;
    const sel = adapter && adapter.selectors;
    if (!sel || !sel.productTile || !sel.addToCartButton) {
      return { ok: false, error: 'ADD_PRODUCTS: adapter selectors missing' };
    }
    const items = Array.isArray(msg.items) ? msg.items : [];
    const tiles = Array.from(document.querySelectorAll(sel.productTile));

    let added = 0;
    let failed = 0;

    for (const item of items) {
      const product = item && item.product;
      if (!product) {
        failed++;
        continue;
      }
      const tile = findTile(tiles, sel.title, product);
      if (!tile) {
        failed++;
        continue;
      }
      const quantity = Number(item.quantity);
      const clicks = Math.min(Number.isFinite(quantity) && quantity >= 1 ? quantity : 1, MAX_CLICKS);
      let dispatched = 0;
      for (let i = 0; i < clicks; i++) {
        if (i > 0) await sleep(CLICK_GAP_MS);
        // Re-locate and re-vet the button before EVERY click: SPAs re-render
        // tile controls between clicks (add button -> stepper/mini-cart CTA),
        // and a stale or morphed control must stop the item, not get clicked.
        const button = tile.querySelector(sel.addToCartButton);
        if (!button || !button.isConnected || !tile.contains(button) || looksLikeCheckout(button)) {
          break;
        }
        try {
          button.click();
          dispatched++;
        } catch {
          break;
        }
      }
      if (dispatched > 0) added++;
      else failed++;
    }
    return { ok: true, added, failed };
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'ADD_PRODUCTS') return false;
    addProducts(msg).then(
      (response) => sendResponse(response),
      (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }),
    );
    return true;
  });
})();
