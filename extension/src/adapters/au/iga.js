// IGA Shop (AU) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'au.iga',
  name: 'IGA',
  country: 'AU',
  currency: 'AUD',
  homeUrl: 'https://www.igashop.com.au',
  cartUrl: 'https://www.igashop.com.au/checkout/cart',
  searchUrlTemplate: 'https://www.igashop.com.au/search?q={query}',
  matchPatterns: ['https://www.igashop.com.au/*'],
  selectors: {
    productTile:
      '[data-testid="product-card"], [data-testid*="product-tile"], article[class*="product-card"], li[class*="product"], [class*="product-tile"]',
    title:
      '[data-testid="product-card-title"], [data-testid="product-title"], a[href*="/product/"], h3 a, [class*="product-title"]',
    price:
      '[data-testid="product-card-price"], [data-testid="price"], [class*="product-price"], [class*="price"] span, .price',
    wasPrice:
      '[data-testid="was-price"], [class*="was-price"], [class*="price-was"], del, s',
    promoBadge:
      '[data-testid="product-card-promo"], [class*="promo-tag"], [class*="special"], [class*="badge"], [class*="offer"]',
    addToCartButton:
      '[data-testid="add-to-cart"], button[data-testid*="add" i], button[class*="add-to-cart"], button[aria-label*="Add" i]',
  },
  priceRegex: null,
});
