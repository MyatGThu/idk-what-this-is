// Woolworths (AU) store adapter. Selectors are best-effort fallback chains;
// see docs/STORES.md for maintenance notes.

/** @typedef {import('../../common/types.js').StoreAdapter} StoreAdapter */

export default /** @type {StoreAdapter} */ ({
  id: 'au.woolworths',
  name: 'Woolworths',
  country: 'AU',
  currency: 'AUD',
  homeUrl: 'https://www.woolworths.com.au',
  cartUrl: 'https://www.woolworths.com.au/shop/cart',
  searchUrlTemplate: 'https://www.woolworths.com.au/shop/search/products?searchTerm={query}',
  matchPatterns: ['https://www.woolworths.com.au/*'],
  selectors: {
    productTile:
      'wc-product-tile, shared-product-tile, [data-testid="product-tile"], section[class*="product-tile"], [class*="product-tile"]',
    title:
      '.title a, [class*="product-title"] a, a[href*="/shop/productdetails/"], [data-testid="product-title"], .shelfProductTile-descriptionLink',
    price:
      '.product-tile-price .primary, [class*="price"] .primary, [data-testid="product-price"], .price-dollars, [class*="product-price"]',
    wasPrice:
      '.product-tile-price .was-price, [class*="was-price"], .price--was, del, s',
    promoBadge:
      '.product-tile-label, [class*="roundel"], [class*="tile-badge"], img[alt*="Special" i], [class*="special"], [class*="promo"]',
    addToCartButton:
      '.cartControls-addButton, button[class*="add-to-cart"], [data-testid="add-to-cart-button"], button[aria-label*="Add to cart" i]',
  },
  priceRegex: null,
});
