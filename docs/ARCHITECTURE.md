# Grocery Discount Hunter — Architecture

A cross-browser (Manifest V3) WebExtension that:

1. Detects the user's country (timezone/locale heuristic + manual override).
2. Knows the well-known online grocery stores for that country.
3. Takes the user's grocery list (typed or pasted "grocery sheet").
4. Scans each store's search pages for those items and finds the ones **on discount**.
5. On the user's request, adds **only the user's requested items** (the discounted
   matches they tick) to the store's cart, then stops — **checkout is always a human
   action; the extension never places an order or touches payment on a store site.**
6. Free for 14 days from install, then requires an A$6.99/month (AUD) subscription
   (Stripe Checkout via the bundled licensing backend in `backend/`).

## Repository layout

```
extension/
  manifest.chrome.json     MV3 manifest for Chromium browsers (Chrome, Edge, Brave, Opera)
  manifest.firefox.json    MV3 manifest for Firefox (event-page background, gecko settings)
  src/
    common/
      compat.js            Browser API shim: exports `ext` (promise-based, chrome+firefox)
      types.js             JSDoc typedefs shared by every module (the data contract)
      storage.js           Typed helpers over storage.local (see "Storage keys")
      matching.js          Grocery-list item <-> product title matching + list parsing
      licensing.js         Trial clock + subscription state machine + backend client
    background/
      service-worker.js    Entry point: message router, install hook, orchestration
      region.js            Country detection (timezone/locale) + store roster lookup
      scan.js              Scan engine: opens store search tabs, collects products,
                           computes DiscountMatches, persists lastScan
    adapters/
      registry.js          All store adapters, keyed by id; roster helpers by country
      au/woolworths.js  au/coles.js  au/iga.js
      us/walmart.js     us/kroger.js  us/target.js
      uk/tesco.js       uk/sainsburys.js
    content/
      scanner.js           Content script: reads product tiles on a search page using
                           the adapter's selectors, reports Product[] to background
      cart-injector.js     Content script: on command, clicks add-to-cart for the
                           specific approved products only; never navigates to checkout
    popup/
      popup.html/css/js    Grocery list manager, "Scan stores", results with per-item
                           checkboxes, "Add selected to cart", trial banner
    options/
      options.html/js      Country override, enable/disable stores, account/license
    paywall/
      paywall.html/js      Shown when trial expired and no active subscription;
                           starts Stripe Checkout via backend, accepts license token
build/
  build.js                 Zero-dependency Node script: assembles dist/chrome and
                           dist/firefox (copies src, picks manifest), optional zips
backend/
  server.js                Zero-dependency Node licensing server (Stripe via REST):
                           POST /api/checkout, POST /api/webhook, GET /api/license/:token
  README.md                Deploy + Stripe setup instructions
docs/
  ARCHITECTURE.md          This file
  STORES.md                Per-store adapter notes, selector maintenance, ToS caveats
  BROWSERS.md              Per-browser install/build notes incl. Safari conversion
```

## Hard rules (apply to every module)

- **Never automate checkout.** The extension may add items to a cart and open the
  cart page. It must never click "checkout", "place order", "pay", or fill payment
  or address forms on a store site.
- **Only user-requested items.** Cart additions are limited to products the user
  explicitly selected in the popup, which themselves only ever come from matches
  against the user's own grocery list.
- Plain ES modules, no TypeScript, no npm runtime dependencies anywhere
  (extension, build, backend). Node >= 18 assumed for build/backend.
- Content scripts cannot use ES module imports — `scanner.js` and
  `cart-injector.js` must be self-contained (adapter descriptors are passed to
  them via messages, never imported).
- All UI text in English; currency symbol comes from the adapter.

## Data contract (see `common/types.js` for the canonical JSDoc)

```js
GroceryItem   = { id: string, name: string, quantity: number, maxPrice: number|null, notes: string }
Product       = { storeId, title, url, price: number|null, wasPrice: number|null,
                  discountPct: number|null, onSpecial: boolean, tileIndex: number,
                  query: string }   // the search term that produced this product
DiscountMatch = { listItemId, listItemName, product: Product, score: number }  // score 0..1
StoreAdapter  = {
  id: 'au.woolworths',            // '<cc>.<slug>'
  name: 'Woolworths',
  country: 'AU',                  // ISO 3166-1 alpha-2
  currency: 'AUD',
  homeUrl, cartUrl: string,
  searchUrlTemplate: string,      // contains '{query}' placeholder
  matchPatterns: string[],        // host patterns the content scripts run on
  selectors: {
    productTile, title, price, wasPrice, promoBadge, addToCartButton: string  // CSS
  },
  priceRegex: string|null,        // optional override for price extraction
}
LicenseState  = { installDate: number, trialDays: number, status: 'trial'|'active'|'expired',
                  token: string|null, email: string|null, lastCheckedAt: number|null }
ScanState     = { scanId: string, startedAt: number, region: string, done: boolean,
                  storeStatus: Object<string,'pending'|'scanning'|'done'|'error'>,
                  matches: DiscountMatch[] }
Settings      = { countryOverride: string|null, disabledStores: string[],
                  backendUrl: string, discountOnly: true }
```

Adapters are **plain serializable objects** (no functions) so they can cross the
messaging boundary; `searchUrlTemplate` uses a `{query}` placeholder instead of a
function.

## Storage keys (`storage.local`)

| key           | type            | written by                     |
|---------------|-----------------|--------------------------------|
| `groceryList` | `GroceryItem[]` | popup                          |
| `settings`    | `Settings`      | options                        |
| `license`     | `LicenseState`  | licensing.js (background only) |
| `lastScan`    | `ScanState`     | scan.js (background only)      |

`storage.js` exposes `getGroceryList/setGroceryList/getSettings/setSettings/
getLicense/setLicense/getLastScan/setLastScan` plus `onChanged(key, cb)`.
Each getter returns a sensible default when unset.

## Message protocol (`runtime.sendMessage`, request/response objects)

Every message is `{ type, ...payload }`; every response is `{ ok: boolean, ... }`
with `{ ok:false, error: string, code?: 'LICENSE_EXPIRED'|... }` on failure.

Popup/options -> background:

| type               | payload                                | response                                  |
|--------------------|----------------------------------------|-------------------------------------------|
| `GET_REGION`       | —                                      | `{ok, country, stores: StoreAdapter[]}`   |
| `START_SCAN`       | —                                      | `{ok, scanId}`; `code:'LICENSE_EXPIRED'` when expired; `code:'NO_HOST_ACCESS', origins:[]` when the browser has not granted store-site access (Firefox MV3 — popup then calls `permissions.request(origins)` from the user gesture) |
| `GET_SCAN_STATUS`  | —                                      | `{ok, scan: ScanState|null}` — also reconciles a scan orphaned by a service-worker shutdown (no matching in-memory scan, or older than 20 min): marks it done with unfinished stores `'error'` |
| `ADD_TO_CART`      | `{storeId, items: [{product: Product, quantity: number}]}` | `{ok, added: number, failed: number}`; `code:'LICENSE_EXPIRED'` when expired; `code:'SCAN_STALE'` when the last scan is older than 6h |
| `GET_LICENSE`      | —                                      | `{ok, license, daysLeft: number}`         |
| `START_CHECKOUT`   | `{email}`                              | `{ok, url, token}` (Checkout URL + the pending license token — the paywall polls `ACTIVATE_LICENSE` with it until the Stripe webhook confirms payment); dev mode: `{ok, url:'', devToken}` (already activated) |
| `ACTIVATE_LICENSE` | `{token}`                              | `{ok, license}`                           |

Background -> content scripts (`tabs.sendMessage`):

| type            | payload                                   | response                          |
|-----------------|-------------------------------------------|-----------------------------------|
| `SCAN_PAGE`     | `{adapter: StoreAdapter, query: string}`  | `{ok, products: Product[]}` — scans the CURRENT page's tiles |
| `ADD_PRODUCTS`  | `{adapter: StoreAdapter, items: [{product: Product, quantity: number}]}` | `{ok, added: number, failed: number}` |

Scan flow per store: background opens one inactive tab, then for each grocery
item name navigates that tab to `searchUrl(adapter, name)`, waits for load +
settle delay, sends `SCAN_PAGE {adapter, query: name}`, and aggregates the
returned products. Tab is closed when the store finishes. Stores run in
parallel, queries within a store run sequentially with a polite delay (>=800ms).

Cart flow per store: background groups the approved items by `product.query`,
opens/reuses a tab, navigates to `searchUrl(adapter, query)` per group, sends
`ADD_PRODUCTS` for that group. `cart-injector` locates each tile by exact title
match first, `tileIndex` as fallback — accepted only when that tile's title
still equals or contains the approved product's title (a reordered page must
fail the item, never click a different product) — then re-locates and re-vets
the adapter's `addToCartButton` before every click (`quantity` clicks, capped
at 10, ~400ms apart), and NEVER navigates to checkout.
When all groups are done, background opens the store's cart page in a normal
(active) tab so the user can review and place the order themselves.

## Licensing flow

- On `runtime.onInstalled`, background writes `license` with `installDate=Date.now(),
  trialDays=14, status='trial'`.
- `licensing.evaluate(license)` returns the effective status: `'active'` if a token
  was verified against the backend within the 72h grace window (`ACTIVE_GRACE_MS`
  = 12h re-check cadence + offline grace), else `'trial'` while
  `now < installDate + 14d`, else `'expired'`. Without the recency bound a
  canceled subscription would stay active forever once the backend became
  unreachable.
- Background re-verifies the token against `GET {backendUrl}/api/license/:token`
  at most once per 12h (`lastCheckedAt`); a token the backend still reports as
  `pending` (checkout not completed) does not start the 12h clock, so it is
  re-verified on every refresh until it resolves. A daily `alarms` re-check is
  created only when absent (an unconditional `alarms.create` at worker startup
  would replace and perpetually reschedule it).
- Checkout delivers the pending license token to the client in the
  `START_CHECKOUT` response and as `license_token` on the Stripe `success_url`;
  the paywall polls `ACTIVATE_LICENSE` until the webhook flips it active.
- `START_SCAN` / `ADD_TO_CART` return `{ok:false, code:'LICENSE_EXPIRED'}` when
  expired; popup then swaps to the paywall view.
- Honest limitation (documented in README): client-side gating is best-effort;
  the source of truth is the backend, and anything truly premium should be
  server-mediated in a future iteration.

## Country detection (`background/region.js`)

`Intl.DateTimeFormat().resolvedOptions().timeZone` mapped to a country for the
supported set (all `Australia/*` -> AU, `America/*` US zones -> US, `Europe/London`
-> GB...), falling back to `navigator.language` region subtag, falling back to AU.
`settings.countryOverride` always wins. Store roster = adapters for that country
minus `settings.disabledStores`.
