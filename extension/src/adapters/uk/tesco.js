// Tesco (GB) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'gb.tesco',
  name: 'Tesco',
  country: 'GB',
  currency: 'GBP',
  homeUrl: 'https://www.tesco.com',
  cartUrl: 'https://www.tesco.com/groceries/en-GB/trolley',
  searchUrlTemplate: 'https://www.tesco.com/groceries/en-GB/search?query={query}',
  matchPatterns: ['https://www.tesco.com/*'],
  selectors: {
    productTile:
      'li.product-list--list-item, [data-auto="product-tile"], li[class*="product-list--list-item"], [class*="product-tile"]',
    title:
      '[data-auto="product-tile--title"], .product-details--wrapper h3 a, a[href*="/groceries/en-GB/products/"], [class*="product-title"]',
    price:
      '[data-auto="price-value"], .price-per-sellable-unit .value, p[class*="price__text"], [class*="price"] .value',
    wasPrice:
      '[data-auto="price-was"], .price-was, [class*="was-price"], del, s',
    promoBadge:
      '.offer-text, [data-auto="offer-text"], [class*="promotions"], [class*="clubcard" i], [class*="special-offer" i]',
    addToCartButton:
      '[data-auto="add-button"], button[data-auto*="add" i], button[class*="add-control"], button[aria-label*="Add" i]',
  },
  priceRegex: null,
});
