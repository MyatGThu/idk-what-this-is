// Target (US) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'us.target',
  name: 'Target',
  country: 'US',
  currency: 'USD',
  homeUrl: 'https://www.target.com',
  cartUrl: 'https://www.target.com/cart',
  searchUrlTemplate: 'https://www.target.com/s?searchTerm={query}',
  matchPatterns: ['https://www.target.com/*'],
  selectors: {
    productTile:
      '[data-test="@web/site-top-of-funnel/ProductCardWrapper"], [data-test="product-card"], div[class*="ProductCard"], [class*="product-tile"]',
    title:
      '[data-test="product-title"], a[data-test="product-title"], [class*="ProductCardTitle"], a[href*="/p/"]',
    price:
      '[data-test="current-price"], [data-test="product-price"], [class*="CurrentPrice"], [class*="price"]',
    wasPrice:
      '[data-test="comparison-price"], [class*="ComparisonPrice"], [class*="reg-price" i], del, s',
    promoBadge:
      '[data-test="sale-message"], [data-test="product-badge"], [class*="SaleBadge"], [class*="deal" i], [class*="promo" i]',
    addToCartButton:
      'button[id*="addToCartButton"], button[data-test*="AddToCart" i], button[aria-label*="Add to cart" i], button[class*="AddToCart"]',
  },
  priceRegex: null,
});
