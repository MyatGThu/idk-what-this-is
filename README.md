# Grocery Discount Hunter

A cross-browser (Manifest V3) WebExtension that hunts discounts for your grocery
list at the well-known online grocery stores near you:

1. **Location-aware store roster** — detects your country (timezone/locale, with a
   manual override) and picks the supported stores for it: Woolworths, Coles and
   IGA in Australia; Walmart, Kroger and Target in the US; Tesco and Sainsbury's
   in the UK.
2. **Grocery-list discount matching** — you type or paste your grocery list; the
   extension scans each store's search pages and surfaces the matching products
   that are **on discount**.
3. **Fills the cart, you place the order** — tick the matches you want and the
   extension adds exactly those to the store's cart, then opens the cart page.
   Checkout is always yours.

## Safety guarantees

These are hard rules enforced across the codebase (see `docs/ARCHITECTURE.md`):

- **It never checks out.** The extension stops at the cart. It never clicks
  "checkout", "place order" or "pay", and never fills payment or address forms
  on a store site.
- **It never touches payment.** No card data, no wallets, no store credentials.
  The only payment flow in the product is your own subscription, which runs on
  Stripe Checkout in a normal browser tab — never on a store site.
- **Only items from your list.** Cart additions are limited to products you
  explicitly ticked, and those candidates only ever come from matches against
  your own grocery list.

## Pricing

Free for 14 days from install, then **A$6.99/month (AUD)** via Stripe. The subscription
is handled by the bundled zero-dependency licensing server in `backend/`.

## Quick start

Requires Node >= 18. No npm dependencies to install.

```sh
npm test           # unit tests (node --test)
npm run build      # builds dist/chrome and dist/firefox (+ zips when `zip` exists)
```

- **Chrome / Edge / Brave / Opera**: open `chrome://extensions`, enable
  Developer mode, click "Load unpacked", pick `dist/chrome/`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, click
  "Load Temporary Add-on…", pick `dist/firefox/manifest.json`.

Per-browser details, publishing notes and the Safari conversion are in
[`docs/BROWSERS.md`](docs/BROWSERS.md).

## Backend setup

The licensing server (trial verification, Stripe Checkout, license tokens) lives
in `backend/` and runs with `npm run backend`. Deployment and Stripe
configuration are covered in `backend/README.md`. Point the extension at your
deployed backend via the options page ("Backend URL").

## Caveats & compliance

Honest notes before you rely on (or ship) this:

- **Store DOM changes break selectors.** Adapters locate product tiles with
  best-effort CSS fallback chains; a store redesign can silently break scanning
  or cart-filling for that store until the selectors are updated. Maintenance
  guide: [`docs/STORES.md`](docs/STORES.md).
- **Retailer terms of service.** Automated interaction with retailer sites may
  conflict with their terms of service or robots policies. Review each store's
  ToS/robots and strongly consider official APIs or affiliate programs before
  any commercial launch.
- **Client-side trial gating is best-effort.** The 14-day gate runs in the
  extension and can be tampered with locally; the backend is the source of
  truth, and anything truly premium should be server-mediated.
- **Prices and availability belong to the stores.** What the extension shows is
  a scrape of a search page at a moment in time; the store's own cart and shelf
  prices win.
- **No affiliation.** This project is not affiliated with, endorsed by, or
  sponsored by any retailer named here.
