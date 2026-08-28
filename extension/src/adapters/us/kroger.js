// Kroger (US) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'us.kroger',
  name: 'Kroger',
  country: 'US',
  currency: 'USD',
  homeUrl: 'https://www.kroger.com',
  cartUrl: 'https://www.kroger.com/cart',
  searchUrlTemplate: 'https://www.kroger.com/search?query={query}',
  matchPatterns: ['https://www.kroger.com/*'],
  selectors: {
    productTile:
      '[data-testid="product-card"], .ProductCard, [class*="ProductCard"], [data-qa="product-card"], [class*="product-tile"]',
    title:
      '[data-testid="product-title"], [data-qa="cart-page-item-description"], [class*="ProductDescription"], h3 a, a[href*="/p/"]',
    price:
      '[data-testid="product-price"], .kds-Price, [data-qa="cart-page-item-price"], [class*="ProductPrice"], [class*="price"]',
    wasPrice:
      '.kds-Price--original, [data-testid="was-price"], [class*="original-price" i], del, s',
    promoBadge:
      '[data-testid="product-card-promo"], .kds-Tag, [class*="PromoTag"], [class*="sale" i], [class*="promo" i]',
    addToCartButton:
      'button[data-testid*="add-to-cart" i], [data-qa="add-to-cart"], button[class*="AddToCart"], button[aria-label*="Add" i]',
  },
  priceRegex: null,
});
