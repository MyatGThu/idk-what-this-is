# Store adapters

Each supported store is described by a **StoreAdapter**: a plain serializable
object (no functions) defined in `extension/src/adapters/<cc>/<slug>.js` and
registered in `extension/src/adapters/registry.js`. The canonical shape is the
`StoreAdapter` typedef in `extension/src/common/types.js`.

## Current adapters

| id              | Store       | Country | Search URL pattern                                                    |
|-----------------|-------------|---------|-----------------------------------------------------------------------|
| `au.woolworths` | Woolworths  | AU      | `https://www.woolworths.com.au/shop/search/products?searchTerm={query}` |
| `au.coles`      | Coles       | AU      | `https://www.coles.com.au/search/products?q={query}`                  |
| `au.iga`        | IGA         | AU      | `https://www.igashop.com.au/search?q={query}`                         |
| `us.walmart`    | Walmart     | US      | `https://www.walmart.com/search?q={query}`                            |
| `us.kroger`     | Kroger      | US      | `https://www.kroger.com/search?query={query}`                         |
| `us.target`     | Target      | US      | `https://www.target.com/s?searchTerm={query}`                         |
| `gb.tesco`      | Tesco       | GB      | `https://www.tesco.com/groceries/en-GB/search?query={query}`          |
| `gb.sainsburys` | Sainsbury's | GB      | `https://www.sainsburys.co.uk/gol-ui/SearchResults/{query}`           |

Notes:

- `{query}` is a literal placeholder; `searchUrl(adapter, query)` in
  `registry.js` substitutes the URL-encoded search term.
- The UK adapters live under `extension/src/adapters/uk/` but use `gb.` ids —
  adapter ids are `<cc>.<slug>` with the ISO 3166-1 alpha-2 country code, and
  the United Kingdom's code is `GB`.

## How selectors are structured

Every adapter carries a `selectors` object with six CSS selectors:

`productTile`, `title`, `price`, `wasPrice`, `promoBadge`, `addToCartButton`

Each one is a **comma-separated fallback list**, ordered from the most specific
selector the store currently uses down to generic patterns
(e.g. `[class*="product-tile"]`, `del, s` for struck-through prices). CSS
treats a comma list as "any of these", so the content scripts pick the first
element that matches inside the tile. That makes adapters tolerant of small
markup changes — a redesign has to invalidate the whole chain to break a field.

Two ways selectors are used:

- `content/scanner.js` finds all `productTile` matches on a search page and
  reads the other selectors *within each tile* to build `Product` objects.
- `content/cart-injector.js` re-finds a tile (exact title match first,
  `tileIndex` fallback) and clicks its `addToCartButton` — and nothing else.

`priceRegex` (usually `null`) can override price extraction with a custom
regex containing one capture group, for stores with unusual price markup.

## Fixing a broken adapter

Symptoms: a store's scan reports zero products (while the site clearly has
results), prices come back `null`, or "Add selected to cart" fails for one
store only.

1. **Open the store's search page** in a normal tab using the adapter's
   `searchUrlTemplate` with a common term (e.g. "milk").
2. **Inspect a product tile** with DevTools. Find the outermost repeated
   element per product — that is `productTile`. Verify in the console:
   `document.querySelectorAll('<candidate>').length` should roughly equal the
   number of visible products.
3. **Check each inner selector** against one tile:
   `tile.querySelector('<title selector>')` and so on for `price`, `wasPrice`,
   `promoBadge`, `addToCartButton`. Discount signals are usually a badge
   element or a struck-through "was" price.
4. **Update the adapter file** — *prepend* the new, specific selector to the
   fallback chain rather than replacing it; the old entries keep older page
   variants (A/B tests, regional versions) working.
5. **Re-run the tests** (`npm test` — the registry tests validate adapter
   shape), rebuild (`npm run build`), reload the extension, and re-scan.

## Adding a store

Checklist — all four steps are required:

1. **Adapter file**: `extension/src/adapters/<cc>/<slug>.js` default-exporting
   a `StoreAdapter` (id `<cc>.<slug>`, correct `country`/`currency`, `homeUrl`,
   `cartUrl`, `searchUrlTemplate` with `{query}`, `matchPatterns`, the six
   selectors, `priceRegex`).
2. **Registry**: import it in `extension/src/adapters/registry.js` and add it
   to `ADAPTERS`. If it introduces a new country, add that country to
   `SUPPORTED_COUNTRIES` (and teach `background/region.js` to detect it).
3. **BOTH manifests**: add the store's host pattern to `host_permissions` *and*
   to the `content_scripts` `matches` array in `extension/manifest.chrome.json`
   **and** `extension/manifest.firefox.json`. Without both, the content scripts
   never run on that store.
4. **Docs**: add a row to the table above; note any store-specific quirks.

Then `npm test` and `npm run build`.

## Terms-of-service caveat

Scanning search pages and clicking add-to-cart buttons is automated interaction
with a retailer's site and may conflict with that retailer's terms of service
or robots policy. Review each store's terms before enabling it for real use,
and prefer official APIs/affiliate programs for anything commercial (see
"Caveats & compliance" in the root README).
