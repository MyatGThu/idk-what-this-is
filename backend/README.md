# Grocery Discount Hunter — licensing backend

A zero-dependency Node (>= 18) server that sells the A$6.99/month (AUD) subscription
through Stripe Checkout and answers license-status lookups from the extension.
One file (`server.js`), no npm install, JSON-file persistence.

## Endpoints

| Method | Path                  | Purpose                                                              |
|--------|-----------------------|----------------------------------------------------------------------|
| POST   | `/api/checkout`       | `{email}` → `{ok, url}` — a Stripe Checkout URL to open              |
| POST   | `/api/webhook`        | Stripe webhook receiver (activates / cancels licenses)               |
| GET    | `/api/license/<token>`| `{ok, status: active\|pending\|canceled\|unknown, email}`            |
| GET    | `/healthz`            | `{ok:true}` liveness probe                                           |

CORS is wide open (`Access-Control-Allow-Origin: *`), so the extension can call
the backend from its popup/paywall pages without any extra host permission.

## 1. Stripe setup (do this in test mode first)

1. Create a Stripe account and stay in **Test mode** (toggle in the dashboard).
2. **Product**: Dashboard → Product catalog → *Add product* — name it
   "Grocery Discount Hunter".
3. **Price**: on the product, add a **recurring** price of **A$6.99 per month** with the currency set to **AUD** (the price object determines the charge currency — the extension and this server never set it).
   Copy its price ID (`price_...`).
4. **API key**: Dashboard → Developers → API keys — copy the **secret** key
   (`sk_test_...`, later `sk_live_...`).
5. **Webhook** (production): Dashboard → Developers → Webhooks → *Add endpoint*
   pointing at `https://<your-host>/api/webhook`, subscribed to
   `checkout.session.completed` and `customer.subscription.deleted`. Copy the
   signing secret (`whsec_...`). For local development use the Stripe CLI
   instead (see below).

When everything works in test mode, repeat product/price/key/webhook in live
mode and swap the env vars.

## 2. Environment variables

| Variable                | Default                              | Notes                                                        |
|-------------------------|--------------------------------------|--------------------------------------------------------------|
| `PORT`                  | `8787`                               | Listen port                                                  |
| `STRIPE_SECRET_KEY`     | *(unset)*                            | `sk_...`. **Unset = dev mode**: `/api/checkout` skips Stripe and returns an immediately-active `devToken` |
| `STRIPE_PRICE_ID`       | *(unset)*                            | The `price_...` id of the A$6.99/month (AUD) recurring price        |
| `STRIPE_WEBHOOK_SECRET` | *(unset)*                            | `whsec_...`. Unset = webhook signatures are **not** verified (dev only) |
| `SUCCESS_URL`           | `https://example.invalid/subscribed` | Where Stripe sends the customer after paying. Replace with a small hosted "Subscription active — you can close this tab" page |
| `CANCEL_URL`            | `https://example.invalid/canceled`   | Where Stripe sends the customer if they back out. Replace with a "Checkout canceled — you can close this tab" page |
| `DATA_FILE`             | `backend/licenses.json`              | JSON persistence file (written atomically)                   |

The `example.invalid` defaults are deliberate non-resolving placeholders (RFC
2606): checkout still completes and the webhook still activates the license,
but the customer lands on a dead page — set real URLs before launch.

## 3. Running locally

```sh
# dev mode (no Stripe at all — checkout returns a devToken you can paste
# into the extension's paywall page):
node backend/server.js

# with Stripe test mode:
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_PRICE_ID=price_... \
STRIPE_WEBHOOK_SECRET=whsec_... \
node backend/server.js
```

Smoke test:

```sh
curl http://localhost:8787/healthz
curl -X POST http://localhost:8787/api/checkout \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
curl http://localhost:8787/api/license/<token-from-above>
```

### Forwarding webhooks in development

Stripe cannot reach `localhost`, so use the [Stripe CLI](https://docs.stripe.com/stripe-cli):

```sh
stripe listen --forward-to localhost:8787/api/webhook
```

`stripe listen` prints a `whsec_...` secret — export it as
`STRIPE_WEBHOOK_SECRET` and restart the server so signatures verify. Complete a
test checkout (card `4242 4242 4242 4242`) and watch the license flip from
`pending` to `active`.

## 4. Pointing the extension at the backend

Open the extension's options page and set **Backend URL** to your server's
origin without a trailing slash (default `http://localhost:8787`, production
e.g. `https://license.yourdomain.com`). Because the backend sends permissive
CORS headers, the extension needs no additional host permission to call it.

Flow: the paywall page posts the user's email to `/api/checkout`, opens the
returned Stripe URL in a tab, and after payment the user pastes/receives their
license token, which the background verifies via `GET /api/license/<token>`
(re-checked at most every 12 hours).

## 5. Deployment

- Any host that runs Node >= 18 works: a $5 VPS with systemd, Fly.io, Railway,
  Render, etc. There is nothing to build and nothing to `npm install`.
- Put HTTPS in front (Caddy, nginx + certbot, or your platform's TLS). Stripe
  requires HTTPS for live-mode webhooks, and license tokens should never
  travel over plain HTTP.
- Persistence is a single JSON file written atomically (temp file + rename).
  That is fine for small scale (thousands of licenses, one process). Before
  scaling to multiple instances or serious volume, swap the store for a real
  database — the store functions (`createStore`/`issueLicense`/`getLicense`)
  are the only seam you need to replace.
- Back up `DATA_FILE`; it is the customer list. If it is ever lost, the
  webhook handler recreates a license record when Stripe replays
  `checkout.session.completed`, but only for completed checkouts you replay.

## 6. Security notes

- **`STRIPE_SECRET_KEY` stays on the server.** Never embed it in the
  extension, the repo, or client-side code of any kind — anyone holding it can
  charge and refund on your account.
- **Set `STRIPE_WEBHOOK_SECRET` in production.** Without it the server accepts
  unsigned webhook posts, which would let anyone activate licenses for free.
  The server verifies `Stripe-Signature` (HMAC-SHA256, constant-time compare)
  and rejects timestamps older than 5 minutes to block replays.
- **License tokens are bearer credentials.** Whoever has a token gets 'active'
  answers, so treat them like passwords: the server only ever logs the first 8
  characters, and lookups for unknown tokens return `status:'unknown'` rather
  than an enumerable 404.
- Request bodies are capped at 64 KB; everything else is rejected before
  parsing.
- Honest limitation (mirrored in the root README): the extension's client-side
  gating is best-effort. This backend is the source of truth, and anything
  truly premium should become server-mediated in a future iteration.
