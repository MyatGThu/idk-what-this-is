// Sainsbury's (GB) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'gb.sainsburys',
  name: "Sainsbury's",
  country: 'GB',
  currency: 'GBP',
  homeUrl: 'https://www.sainsburys.co.uk',
  cartUrl: 'https://www.sainsburys.co.uk/gol-ui/trolley',
  searchUrlTemplate: 'https://www.sainsburys.co.uk/gol-ui/SearchResults/{query}',
  matchPatterns: ['https://www.sainsburys.co.uk/*'],
  selectors: {
    productTile:
      'li.pt-grid-item, article[class*="pt "], [data-testid="product-tile"], [class*="product-tile"]',
    title:
      'a.pt__link, [data-testid="product-tile-description"] a, .pt__info__description a, [class*="product-title"] a',
    price:
      '[data-testid="pt-retail-price"], .pt__cost__retail-price, [class*="retail-price"], [class*="pt__cost"]',
    wasPrice:
      '[data-testid="pt-was-price"], .pt__cost__was-price, [class*="was-price"], del, s',
    promoBadge:
      '.promotion-message, [data-testid="promotion-message"], .pt__promotions a, [class*="promotion"], [class*="nectar" i]',
    addToCartButton:
      '[data-testid="add-button"], .pt__trolley-button button, button[data-testid*="add" i], button[aria-label*="Add" i]',
  },
  priceRegex: null,
});
