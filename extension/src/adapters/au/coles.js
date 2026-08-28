// Coles (AU) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'au.coles',
  name: 'Coles',
  country: 'AU',
  currency: 'AUD',
  homeUrl: 'https://www.coles.com.au',
  cartUrl: 'https://www.coles.com.au/shopping-trolley',
  searchUrlTemplate: 'https://www.coles.com.au/search/products?q={query}',
  matchPatterns: ['https://www.coles.com.au/*'],
  selectors: {
    productTile:
      'section[data-testid="product-tile"], [data-testid="product-tile"], article[class*="product"], [class*="product-tile"]',
    title:
      'h2.product__title, [data-testid="product-title"], .product__title, a[href*="/product/"]',
    price:
      '.price__value, [data-testid="product-pricing"] .price__value, [class*="price__value"], [class*="product-price"]',
    wasPrice:
      '.price__was, [data-testid="product-pricing"] .price__was, [class*="price__was"], del, s',
    promoBadge:
      '[data-testid="badge-label"], .badge__label, [class*="badge"][class*="special"], [class*="special"], [class*="promo"]',
    addToCartButton:
      '[data-testid="add-to-cart-button"], button[data-testid*="add" i], button[class*="add-to-cart"], button[aria-label*="Add" i]',
  },
  priceRegex: null,
});
