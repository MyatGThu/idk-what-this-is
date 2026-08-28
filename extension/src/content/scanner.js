// Content script: scans the current store search page for product tiles.
// No ES imports allowed here — self-contained; the StoreAdapter descriptor
// arrives in the SCAN_PAGE message (see docs/ARCHITECTURE.md).

(() => {
  'use strict';

  if (window.__gdhScannerLoaded) return;
  window.__gdhScannerLoaded = true;

  const api = typeof browser !== 'undefined' ? browser : chrome;

  const MAX_TILES = 40;
  const DEFAULT_PRICE_RE = /([0-9]+(?:[.,][0-9]{2}))/;

  /** @param {Element|null} el */
  const textOf = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /**
   * @param {Element} tile
   * @param {string} selector
   * @param {RegExp} priceRe
   * @returns {number|null}
   */
  function extractPrice(tile, selector, priceRe) {
    const text = textOf(tile.querySelector(selector));
    if (!text) return null;
    const m = priceRe.exec(text);
    if (!m || !m[1]) return null;
    const value = parseFloat(m[1].replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  /** Same formula as types.js discountPct (not importable here). */
  function pctOff(price, wasPrice) {
    if (!Number.isFinite(price) || !Number.isFinite(wasPrice) || wasPrice <= 0 || price >= wasPrice) {
      return null;
    }
    return Math.round(((wasPrice - price) / wasPrice) * 100);
  }

  /**
   * @param {Element} tile
   * @param {string} titleSelector
   * @returns {string}
   */
  function productUrl(tile, titleSelector) {
    const titleEl = tile.querySelector(titleSelector);
    let anchor = null;
    if (titleEl) {
      anchor = titleEl.closest('a[href]') || titleEl.querySelector('a[href]');
    }
    if (!anchor) anchor = tile.querySelector('a[href]');
    const href = anchor && anchor.getAttribute('href');
    if (!href) return '';
    try {
      return new URL(href, location.href).href;
    } catch {
      return '';
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'SCAN_PAGE') return false;
    try {
      const adapter = msg.adapter;
      const query = String(msg.query || '');
      const sel = adapter && adapter.selectors;
      if (!sel || !sel.productTile) {
        sendResponse({ ok: false, error: 'SCAN_PAGE: adapter selectors missing' });
        return true;
      }
      const priceRe = adapter.priceRegex ? new RegExp(adapter.priceRegex) : DEFAULT_PRICE_RE;

      const tiles = Array.from(document.querySelectorAll(sel.productTile)).slice(0, MAX_TILES);
      const products = [];
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        const title = textOf(tile.querySelector(sel.title));
        if (!title) continue;

        const price = extractPrice(tile, sel.price, priceRe);
        const wasPrice = extractPrice(tile, sel.wasPrice, priceRe);
        const promoText = textOf(tile.querySelector(sel.promoBadge));
        const onSpecial =
          promoText !== '' || (wasPrice !== null && price !== null && wasPrice > price);

        products.push({
          storeId: adapter.id,
          title,
          url: productUrl(tile, sel.title),
          price,
          wasPrice,
          discountPct: pctOff(price, wasPrice),
          onSpecial,
          tileIndex: i,
          query,
        });
      }
      sendResponse({ ok: true, products });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
    return true;
  });
})();
