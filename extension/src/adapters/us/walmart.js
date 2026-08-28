// Walmart (US) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'us.walmart',
  name: 'Walmart',
  country: 'US',
  currency: 'USD',
  homeUrl: 'https://www.walmart.com',
  cartUrl: 'https://www.walmart.com/cart',
  searchUrlTemplate: 'https://www.walmart.com/search?q={query}',
  matchPatterns: ['https://www.walmart.com/*'],
  selectors: {
    productTile:
      'div[data-item-id], [data-testid="item-stack"] > div, [data-testid="list-view"] section, [class*="product-tile"]',
    title:
      '[data-automation-id="product-title"], span[data-automation-id="product-title"], a[link-identifier] span, [class*="product-title"]',
    price:
      '[data-automation-id="product-price"] [aria-hidden="true"], [data-automation-id="product-price"], [itemprop="price"], [class*="price-main"]',
    wasPrice:
      '[data-automation-id="strikethrough-price"], .strike, [class*="strikethrough"], del, s',
    promoBadge:
      '[data-automation-id="flag"], [data-testid="tag-leading-badge"], [class*="rollback" i], [class*="badge"], [class*="deal" i]',
    addToCartButton:
      '[data-automation-id="add-to-cart"], button[data-automation-id*="atc" i], button[aria-label*="Add to cart" i], button[class*="add-to-cart"]',
  },
  priceRegex: null,
});
