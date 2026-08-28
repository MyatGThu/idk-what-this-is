// Grocery Discount Hunter — licensing/subscription backend.
//
// Zero-dependency Node >= 18 server (node:http + global fetch). Talks to the
// Stripe REST API directly; persists licenses to a JSON file with atomic
// writes. See backend/README.md for setup and docs/ARCHITECTURE.md for how the
// extension consumes these endpoints.
//
// Endpoints (all JSON, CORS open):
//   POST /api/checkout        {email} -> {ok, url} (Stripe Checkout) or dev token
//   POST /api/webhook         Stripe webhook (signature-verified)
//   GET  /api/license/<token> -> {ok, status, email}
//   GET  /healthz             -> {ok:true}

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 64 * 1024;
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const STRIPE_CHECKOUT_URL = 'https://api.stripe.com/v1/checkout/sessions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * @typedef {Object} LicenseRecord
 * @property {string} token                 Bearer credential (crypto.randomUUID()).
 * @property {string} email
 * @property {'pending'|'active'|'canceled'} status
 * @property {number} createdAt             Epoch ms.
 * @property {string} [stripeCustomerId]
 * @property {string} [subscriptionId]
 */

/**
 * @typedef {Object} LicenseStore
 * @property {string|null} dataFile         null = in-memory only (tests).
 * @property {Object<string, LicenseRecord>} licenses  Keyed by token.
 */

/**
 * @typedef {Object} ServerConfig
 * @property {number} port
 * @property {string} stripeSecretKey       '' = dev mode (no Stripe calls).
 * @property {string} stripePriceId
 * @property {string} stripeWebhookSecret   '' = skip webhook verification (dev only).
 * @property {string} successUrl
 * @property {string} cancelUrl
 * @property {string} dataFile
 */

/** @param {NodeJS.ProcessEnv} env @returns {ServerConfig} */
export function readConfig(env = process.env) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return {
    port: Number(env.PORT) || 8787,
    stripeSecretKey: env.STRIPE_SECRET_KEY || '',
    stripePriceId: env.STRIPE_PRICE_ID || '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    successUrl: env.SUCCESS_URL || 'https://example.invalid/subscribed',
    cancelUrl: env.CANCEL_URL || 'https://example.invalid/canceled',
    dataFile: env.DATA_FILE || path.join(here, 'licenses.json'),
  };
}

// ---------------------------------------------------------------------------
// License store (JSON file, atomic writes)

/**
 * Load (or initialize) a license store. Pass null for a memory-only store.
 * @param {string|null} dataFile
 * @returns {LicenseStore}
 */
export function createStore(dataFile) {
  /** @type {LicenseStore} */
  const store = { dataFile: dataFile || null, licenses: {} };
  if (dataFile && fs.existsSync(dataFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      if (parsed && typeof parsed.licenses === 'object' && parsed.licenses !== null) {
        store.licenses = parsed.licenses;
      }
    } catch (e) {
      // Never clobber a corrupt data file silently: move it aside and continue.
      const backup = `${dataFile}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(dataFile, backup);
      } catch {
        /* best effort */
      }
      log(`WARN could not parse ${dataFile} (${e.message}); moved to ${backup}`);
    }
  }
  return store;
}

/** @param {LicenseStore} store */
export function saveStore(store) {
  if (!store.dataFile) return;
  const tmp = `${store.dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ licenses: store.licenses }, null, 2));
  fs.renameSync(tmp, store.dataFile);
}

/**
 * Issue and persist a new license token.
 * @param {LicenseStore} store
 * @param {string} email
 * @param {'pending'|'active'|'canceled'} [status]
 * @returns {LicenseRecord}
 */
export function issueLicense(store, email, status = 'pending') {
  /** @type {LicenseRecord} */
  const license = {
    token: crypto.randomUUID(),
    email,
    status,
    createdAt: Date.now(),
  };
  store.licenses[license.token] = license;
  saveStore(store);
  return license;
}

/**
 * @param {LicenseStore} store
 * @param {string} token
 * @returns {LicenseRecord|null}
 */
export function getLicense(store, token) {
  return (token && Object.hasOwn(store.licenses, token) && store.licenses[token]) || null;
}

/** @param {LicenseStore} store @param {string} subscriptionId @returns {LicenseRecord|null} */
function findBySubscription(store, subscriptionId) {
  if (!subscriptionId) return null;
  return Object.values(store.licenses).find((l) => l.subscriptionId === subscriptionId) || null;
}

// ---------------------------------------------------------------------------
// Stripe webhook signature (https://docs.stripe.com/webhooks#verify-manually)

/**
 * Verify a `Stripe-Signature` header against the raw request body.
 * @param {string} secret         Webhook signing secret (whsec_...).
 * @param {string} header         The Stripe-Signature header value.
 * @param {string|Buffer} rawBody Exact bytes Stripe signed.
 * @param {number} [nowMs]        Injectable clock for tests.
 * @returns {boolean}
 */
export function verifyStripeSignature(secret, header, rawBody, nowMs = Date.now()) {
  if (!secret || !header || rawBody === undefined || rawBody === null) return false;

  let timestamp = null;
  const candidates = [];
  for (const part of String(header).split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }
  if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) return false;
  if (nowMs - Number(timestamp) * 1000 > SIGNATURE_TOLERANCE_MS) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${timestamp}.`);
  hmac.update(rawBody);
  const expected = Buffer.from(hmac.digest('hex'), 'utf8');

  return candidates.some((candidate) => {
    const actual = Buffer.from(candidate.toLowerCase(), 'utf8');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

// ---------------------------------------------------------------------------
// HTTP plumbing

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

/** Tokens are bearer credentials: log only their first 8 chars. */
function redact(pathname) {
  return pathname.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    (m) => `${m.slice(0, 8)}…`,
  );
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS });
  res.end(JSON.stringify(body));
}

/**
 * Read the request body, rejecting anything over MAX_BODY_BYTES.
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
      return;
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.pause();
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidEmail(email) {
  return (
    typeof email === 'string' &&
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

// ---------------------------------------------------------------------------
// Route handlers

/**
 * @param {ServerConfig} config
 * @param {LicenseStore} store
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleCheckout(config, store, req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (e) {
    sendJson(res, e.statusCode || 400, { ok: false, error: e.statusCode ? e.message : 'invalid JSON body' });
    return;
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) {
    sendJson(res, 400, { ok: false, error: 'a valid email address is required' });
    return;
  }

  // Dev mode: no Stripe key configured — issue an immediately-active license.
  if (!config.stripeSecretKey) {
    const license = issueLicense(store, email, 'active');
    sendJson(res, 200, {
      ok: true,
      url: null,
      devToken: license.token,
      note: 'dev mode: no Stripe key configured',
    });
    return;
  }

  if (!config.stripePriceId) {
    sendJson(res, 500, { ok: false, error: 'STRIPE_PRICE_ID is not configured' });
    return;
  }

  const license = issueLicense(store, email, 'pending');
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', config.stripePriceId);
  form.set('line_items[0][quantity]', '1');
  form.set('customer_email', email);
  form.set('success_url', config.successUrl);
  form.set('cancel_url', config.cancelUrl);
  form.set('client_reference_id', license.token);

  let session;
  try {
    const stripeRes = await fetch(STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    session = await stripeRes.json();
    if (!stripeRes.ok || !session.url) {
      throw new Error(session?.error?.message || `Stripe responded ${stripeRes.status}`);
    }
  } catch (e) {
    delete store.licenses[license.token];
    saveStore(store);
    log(`ERROR checkout for token ${license.token.slice(0, 8)}…: ${e.message}`);
    sendJson(res, 502, { ok: false, error: `could not create Stripe Checkout session: ${e.message}` });
    return;
  }

  sendJson(res, 200, { ok: true, url: session.url });
}

/**
 * @param {ServerConfig} config
 * @param {LicenseStore} store
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function handleWebhook(config, store, req, res) {
  let rawBody;
  try {
    rawBody = await readBody(req);
  } catch (e) {
    sendJson(res, e.statusCode || 400, { ok: false, error: e.message });
    return;
  }

  if (config.stripeWebhookSecret) {
    const header = req.headers['stripe-signature'];
    if (!verifyStripeSignature(config.stripeWebhookSecret, header, rawBody)) {
      sendJson(res, 400, { ok: false, error: 'invalid Stripe signature' });
      return;
    }
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }

  const object = event?.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const token = object.client_reference_id;
    let license = getLicense(store, token);
    if (!license && token) {
      // Data file was lost/reset between checkout and webhook: recreate the record.
      license = {
        token,
        email: object.customer_details?.email || object.customer_email || '',
        status: 'pending',
        createdAt: Date.now(),
      };
      store.licenses[token] = license;
    }
    if (license) {
      license.status = 'active';
      license.stripeCustomerId = typeof object.customer === 'string' ? object.customer : '';
      license.subscriptionId = typeof object.subscription === 'string' ? object.subscription : '';
      saveStore(store);
      log(`license ${license.token.slice(0, 8)}… activated`);
    } else {
      log('WARN checkout.session.completed without client_reference_id');
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const license = findBySubscription(store, object.id);
    if (license) {
      license.status = 'canceled';
      saveStore(store);
      log(`license ${license.token.slice(0, 8)}… canceled`);
    } else {
      log(`WARN subscription.deleted for unknown subscription`);
    }
  }

  sendJson(res, 200, { received: true });
}

/**
 * Body of GET /api/license/<token>. Missing tokens are ok:true + 'unknown' on
 * purpose: the extension treats every non-active status uniformly and a 404
 * would look like an outage.
 * @param {LicenseStore} store
 * @param {string} token
 * @returns {{ok: true, status: 'active'|'pending'|'canceled'|'unknown', email: string|null}}
 */
export function licenseLookup(store, token) {
  const license = getLicense(store, token);
  return {
    ok: true,
    status: license ? license.status : 'unknown',
    email: license ? license.email : null,
  };
}

// ---------------------------------------------------------------------------
// Server

/**
 * Build the HTTP server without starting it (tests import this).
 * @param {{env?: NodeJS.ProcessEnv, store?: LicenseStore}} [options]
 * @returns {http.Server}
 */
export function createServer(options = {}) {
  const config = readConfig(options.env || process.env);
  const store = options.store || createStore(config.dataFile);

  return http.createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      log(`${req.method} ${redact(req.url || '/')} ${res.statusCode} ${Date.now() - started}ms`);
    });

    route(config, store, req, res).catch((e) => {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: e.message || 'internal error' });
      } else {
        res.destroy();
      }
    });
  });
}

/**
 * @param {ServerConfig} config
 * @param {LicenseStore} store
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
async function route(config, store, req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && pathname === '/api/checkout') {
    await handleCheckout(config, store, req, res);
    return;
  }
  if (req.method === 'POST' && pathname === '/api/webhook') {
    await handleWebhook(config, store, req, res);
    return;
  }
  if (req.method === 'GET' && pathname.startsWith('/api/license/')) {
    const token = decodeURIComponent(pathname.slice('/api/license/'.length));
    sendJson(res, 200, licenseLookup(store, token));
    return;
  }
  sendJson(res, 404, { ok: false, error: 'not found' });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const config = readConfig(process.env);
  const server = createServer();
  server.listen(config.port, () => {
    log(`licensing backend listening on http://localhost:${config.port}`);
    log(`data file: ${config.dataFile}`);
    if (!config.stripeSecretKey) log('WARN dev mode: STRIPE_SECRET_KEY not set, /api/checkout issues free dev tokens');
    if (!config.stripeWebhookSecret) log('WARN STRIPE_WEBHOOK_SECRET not set, /api/webhook signatures are NOT verified');
  });
}
