// Popup: grocery list manager, scan trigger + progress, results, cart handoff.
// Talks to the background exclusively via the message protocol in
// docs/ARCHITECTURE.md; direct storage access is limited to the grocery list.
// All dynamic DOM is built with createElement/textContent — scraped product
// titles must never reach innerHTML.

import { ext } from '../common/compat.js';
import { getGroceryList, setGroceryList, onChanged } from '../common/storage.js';
import { parseGrocerySheet } from '../common/matching.js';
import { TRIAL_DAYS, normalizeGroceryItem, discountPct } from '../common/types.js';

/** @typedef {import('../common/types.js').GroceryItem} GroceryItem */
/** @typedef {import('../common/types.js').StoreAdapter} StoreAdapter */
/** @typedef {import('../common/types.js').DiscountMatch} DiscountMatch */
/** @typedef {import('../common/types.js').ScanState} ScanState */

const POLL_INTERVAL_MS = 1500;
const MAX_QUANTITY = 10; // cart-injector caps add-to-cart clicks at 10

const state = {
  /** @type {StoreAdapter[]} */ stores: [],
  /** @type {Map<string, StoreAdapter>} */ storeById: new Map(),
  /** @type {GroceryItem[]} */ list: [],
  daysLeft: 0,
  /** @type {'trial'|'active'|'expired'} */ licenseStatus: 'trial',
  expired: false,
  /** @type {ScanState|null} */ scan: null,
  scanning: false,
};

// Invalidates in-flight polling loops when a new one starts.
let pollGeneration = 0;

const $ = (id) => document.getElementById(id);

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * sendMessage that never throws: failures collapse to the protocol shape.
 * @param {{type: string}} message
 * @returns {Promise<{ok: boolean, error?: string, code?: string, [k: string]: *}>}
 */
async function send(message) {
  try {
    const res = await ext.runtime.sendMessage(message);
    if (!res || typeof res.ok !== 'boolean') {
      return { ok: false, error: 'No response from the extension background.' };
    }
    return res;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function openPaywall() {
  ext.tabs.create({ url: ext.runtime.getURL('src/paywall/paywall.html') }).catch(() => {});
}

function openInNewTab(url) {
  // Scraped hrefs are untrusted; only ever open web URLs from the popup.
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  ext.tabs.create({ url }).catch(() => {});
}

/** @param {string} code */
function countryName(code) {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
}

/**
 * @param {number|null} value
 * @param {StoreAdapter|null} adapter
 */
function formatPrice(value, adapter) {
  if (!Number.isFinite(value)) return '';
  if (adapter && adapter.currency) {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: adapter.currency,
        currencyDisplay: 'narrowSymbol',
      }).format(value);
    } catch {
      // fall through to the generic form
    }
  }
  return `$${value.toFixed(2)}`;
}

// ---------------------------------------------------------------- license --

async function loadLicense() {
  const res = await send({ type: 'GET_LICENSE' });
  if (!res.ok) return; // fail open in the UI; background still gates actions
  state.licenseStatus = res.license && res.license.status ? res.license.status : 'trial';
  state.daysLeft = Number.isFinite(res.daysLeft) ? res.daysLeft : 0;
  state.expired = state.licenseStatus === 'expired';
  renderLicense();
}

/** Swap to the expired view after a LICENSE_EXPIRED response. */
function showExpired() {
  state.licenseStatus = 'expired';
  state.expired = true;
  state.scanning = false;
  pollGeneration += 1; // stop any in-flight polling loop
  renderLicense();
  updateScanButton();
  renderResults();
}

function renderLicense() {
  const banner = $('license-banner');
  banner.textContent = '';
  banner.hidden = true;

  if (state.expired) {
    banner.hidden = false;
    const card = el('div', 'expired-card');
    card.append(
      el(
        'p',
        'expired-headline',
        `Your ${TRIAL_DAYS}-day free trial has ended — subscribe for A$6.99/month`,
      ),
    );
    const button = el('button', 'button primary wide', 'Subscribe');
    button.type = 'button';
    button.addEventListener('click', openPaywall);
    card.append(button);
    banner.append(card);
  } else if (state.licenseStatus === 'trial') {
    banner.hidden = false;
    const row = el('div', 'trial-banner');
    const days = state.daysLeft;
    row.append(el('span', '', `Free trial: ${days} day${days === 1 ? '' : 's'} left`));
    const link = el('button', 'link-button subtle', 'Subscribe');
    link.type = 'button';
    link.addEventListener('click', openPaywall);
    row.append(link);
    banner.append(row);
  }
  // 'active': no banner at all

  updateScanButton();
}

// ----------------------------------------------------------------- region --

async function loadRegion() {
  const line = $('region-line');
  const res = await send({ type: 'GET_REGION' });
  if (!res.ok) {
    line.textContent = 'Could not detect your region.';
    return;
  }
  state.stores = Array.isArray(res.stores) ? res.stores : [];
  state.storeById = new Map(state.stores.map((s) => [s.id, s]));
  if (state.stores.length === 0) {
    line.textContent = `No stores enabled for ${countryName(res.country)} — check settings.`;
    return;
  }
  const names = state.stores.map((s) => s.name).join(', ');
  line.textContent = `Scanning stores in ${countryName(res.country)}: ${names}`;
}

// ----------------------------------------------------------- grocery list --

async function loadList() {
  try {
    state.list = await getGroceryList();
  } catch {
    state.list = [];
  }
  renderList();
}

/** @param {GroceryItem[]} next */
async function persistList(next) {
  state.list = next;
  renderList();
  try {
    await setGroceryList(next);
  } catch {
    // storage.onChanged will reconcile if the write half-applied
  }
}

/** @param {string} id @param {Partial<GroceryItem>} patch */
function updateItem(id, patch) {
  const next = state.list.map((item) =>
    item.id === id ? normalizeGroceryItem({ ...item, ...patch }, item.id) : item,
  );
  void persistList(next);
}

/** @param {string} id */
function removeItem(id) {
  void persistList(state.list.filter((item) => item.id !== id));
}

function renderList() {
  const listEl = $('grocery-list');
  listEl.textContent = '';
  $('list-empty').hidden = state.list.length > 0;
  for (const item of state.list) listEl.append(renderListItem(item));
}

/** @param {GroceryItem} item */
function renderListItem(item) {
  const li = el('li', 'grocery-item');

  const name = el('span', 'item-name', item.name);
  if (item.notes) name.title = `${item.name} (${item.notes})`;

  const stepper = el('div', 'stepper');
  stepper.setAttribute('role', 'group');
  stepper.setAttribute('aria-label', `Quantity of ${item.name}`);
  const dec = el('button', 'stepper-button', '−');
  dec.type = 'button';
  dec.setAttribute('aria-label', `Decrease quantity of ${item.name}`);
  dec.disabled = item.quantity <= 1;
  dec.addEventListener('click', () => updateItem(item.id, { quantity: item.quantity - 1 }));
  const count = el('span', 'stepper-count', String(item.quantity));
  const inc = el('button', 'stepper-button', '+');
  inc.type = 'button';
  inc.setAttribute('aria-label', `Increase quantity of ${item.name}`);
  inc.disabled = item.quantity >= MAX_QUANTITY;
  inc.addEventListener('click', () => updateItem(item.id, { quantity: item.quantity + 1 }));
  stepper.append(dec, count, inc);

  const price = document.createElement('input');
  price.type = 'number';
  price.className = 'max-price';
  price.min = '0.01';
  price.step = '0.01';
  price.placeholder = 'Max $';
  price.setAttribute('aria-label', `Maximum price for ${item.name}`);
  if (item.maxPrice !== null) price.value = String(item.maxPrice);
  price.addEventListener('change', () => updateItem(item.id, { maxPrice: price.value }));

  const remove = el('button', 'icon-button remove-button', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${item.name}`);
  remove.addEventListener('click', () => removeItem(item.id));

  li.append(name, stepper, price, remove);
  return li;
}

function wireQuickAdd() {
  const form = $('quick-add-form');
  const input = $('quick-add-input');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    const item = normalizeGroceryItem({ name, quantity: 1 }, crypto.randomUUID());
    input.value = '';
    void persistList([...state.list, item]);
  });
}

function wirePasteImport() {
  const toggle = $('paste-toggle');
  const panel = $('paste-panel');
  const textarea = $('paste-textarea');
  const importButton = $('paste-import');
  const feedback = $('paste-feedback');

  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) textarea.focus();
  });

  importButton.addEventListener('click', () => {
    feedback.className = 'feedback';
    const parsed = parseGrocerySheet(textarea.value);
    if (parsed.length === 0) {
      feedback.textContent = 'No items found in the pasted text.';
      feedback.classList.add('error');
      return;
    }
    const { list, added, updated } = mergeLists(state.list, parsed);
    void persistList(list);
    textarea.value = '';
    feedback.textContent = `Imported ${parsed.length} item${parsed.length === 1 ? '' : 's'} (${added} new, ${updated} updated).`;
    feedback.classList.add('success');
  });
}

/**
 * Merge parsed items into the existing list: same name (case-insensitive)
 * updates quantity/notes in place and keeps the item's id; new names append.
 * @param {GroceryItem[]} existing
 * @param {GroceryItem[]} incoming
 * @returns {{list: GroceryItem[], added: number, updated: number}}
 */
function mergeLists(existing, incoming) {
  const list = [...existing];
  let added = 0;
  let updated = 0;
  for (const item of incoming) {
    const key = item.name.toLowerCase();
    const index = list.findIndex((it) => it.name.toLowerCase() === key);
    if (index === -1) {
      list.push(item);
      added += 1;
    } else {
      const current = list[index];
      list[index] = normalizeGroceryItem(
        {
          ...current,
          quantity: item.quantity,
          maxPrice: item.maxPrice !== null ? item.maxPrice : current.maxPrice,
          notes: item.notes || current.notes,
        },
        current.id,
      );
      updated += 1;
    }
  }
  return { list, added, updated };
}

// ------------------------------------------------------------------- scan --

function updateScanButton() {
  const button = $('scan-button');
  button.disabled = state.expired || state.scanning;
  button.textContent = state.scanning ? 'Scanning…' : 'Find discounts';
}

/** @param {string} text @param {boolean} [isError] */
function setScanNote(text, isError = false) {
  const note = $('scan-note');
  note.hidden = !text;
  note.textContent = text;
  note.className = `feedback${isError ? ' error' : ''}`;
}

async function startScan() {
  if (state.expired || state.scanning) return;
  setScanNote('');
  if (state.list.length === 0) {
    setScanNote('Add items to your grocery list first.');
    return;
  }
  const res = await send({ type: 'START_SCAN' });
  if (!res.ok) {
    if (res.code === 'LICENSE_EXPIRED') {
      showExpired();
      return;
    }
    if (res.code === 'NO_HOST_ACCESS' && Array.isArray(res.origins) && res.origins.length > 0) {
      renderHostAccessPrompt(res.origins);
      return;
    }
    setScanNote(res.error || 'Could not start the scan.', true);
    return;
  }
  beginPolling();
}

/**
 * Firefox MV3 does not grant store-site access at install; ask for it from a
 * user gesture, then retry the scan.
 * @param {string[]} origins
 */
function renderHostAccessPrompt(origins) {
  const note = $('scan-note');
  note.hidden = false;
  note.className = 'feedback error';
  note.textContent = 'Your browser needs permission to read the store sites. ';
  const button = el('button', 'button small', 'Grant store access');
  button.type = 'button';
  button.addEventListener('click', async () => {
    let granted = false;
    try {
      if (ext.permissions && typeof ext.permissions.request === 'function') {
        granted = await ext.permissions.request({ origins });
      }
    } catch {
      granted = false;
    }
    if (granted) {
      setScanNote('');
      void startScan();
    } else {
      setScanNote('Store access was not granted — the scan cannot run without it.', true);
    }
  });
  note.append(button);
}

function beginPolling() {
  const generation = ++pollGeneration;
  state.scanning = true;
  updateScanButton();

  const tick = async () => {
    if (generation !== pollGeneration) return;
    const res = await send({ type: 'GET_SCAN_STATUS' });
    if (generation !== pollGeneration) return;
    if (res.ok && res.scan) {
      state.scan = res.scan;
      renderScanProgress();
      if (res.scan.done) {
        state.scanning = false;
        updateScanButton();
        renderResults();
        return;
      }
    }
    // Transient failures keep polling; the scan continues in the background.
    setTimeout(tick, POLL_INTERVAL_MS);
  };
  void tick();
}

function renderScanProgress() {
  const chips = $('store-chips');
  chips.textContent = '';
  const scan = state.scan;
  const statuses = scan && scan.storeStatus ? scan.storeStatus : null;
  if (!statuses || Object.keys(statuses).length === 0) {
    chips.hidden = true;
    return;
  }
  chips.hidden = false;
  // Roster order first, then any store ids the roster does not know about.
  const ordered = [
    ...state.stores.map((s) => s.id).filter((id) => id in statuses),
    ...Object.keys(statuses).filter((id) => !state.storeById.has(id)),
  ];
  for (const storeId of ordered) {
    const status = statuses[storeId];
    const adapter = state.storeById.get(storeId);
    chips.append(el('span', `chip ${status}`, `${adapter ? adapter.name : storeId} · ${status}`));
  }
}

// ---------------------------------------------------------------- results --

async function loadLastScan() {
  const res = await send({ type: 'GET_SCAN_STATUS' });
  if (!res.ok || !res.scan) return;
  state.scan = res.scan;
  if (!res.scan.done) {
    renderScanProgress();
    beginPolling();
  } else {
    renderResults();
  }
}

function renderResults() {
  const section = $('results-section');
  const container = $('results');
  container.textContent = '';
  const scan = state.scan;
  if (!scan || !scan.done) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const matches = Array.isArray(scan.matches) ? scan.matches : [];
  if (matches.length === 0) {
    container.append(el('p', 'empty-note', 'No discounts matched your list today.'));
    return;
  }

  /** @type {Map<string, DiscountMatch[]>} */
  const byStore = new Map();
  for (const match of matches) {
    const storeId = match.product && match.product.storeId;
    if (!storeId) continue;
    if (!byStore.has(storeId)) byStore.set(storeId, []);
    byStore.get(storeId).push(match);
  }
  for (const [storeId, storeMatches] of byStore) {
    container.append(renderStoreGroup(storeId, storeMatches));
  }
}

/**
 * @param {string} storeId
 * @param {DiscountMatch[]} matches
 */
function renderStoreGroup(storeId, matches) {
  const adapter = state.storeById.get(storeId) || null;
  const group = el('section', 'store-group');
  group.append(el('h3', 'store-name', adapter ? adapter.name : storeId));

  /** @type {Map<string, DiscountMatch[]>} */
  const byItem = new Map();
  for (const match of matches) {
    if (!byItem.has(match.listItemId)) byItem.set(match.listItemId, []);
    byItem.get(match.listItemId).push(match);
  }

  /** @type {{checkbox: HTMLInputElement, match: DiscountMatch}[]} */
  const rows = [];
  for (const itemMatches of byItem.values()) {
    const block = el('div', 'item-group');
    block.append(el('p', 'item-group-name', itemMatches[0].listItemName));
    let top = itemMatches[0];
    for (const match of itemMatches) if (match.score > top.score) top = match;
    for (const match of itemMatches) {
      const { row, checkbox } = renderMatchRow(match, adapter, match === top);
      rows.push({ checkbox, match });
      block.append(row);
    }
    group.append(block);
  }

  const footer = el('div', 'store-footer');
  const addButton = el('button', 'button primary wide');
  addButton.type = 'button';
  const feedback = el('p', 'feedback');
  feedback.setAttribute('role', 'status');
  const updateCount = () => {
    const selected = rows.filter((r) => r.checkbox.checked).length;
    addButton.textContent = `Add ${selected} selected to cart`;
    addButton.disabled = state.expired || selected === 0;
  };
  for (const row of rows) row.checkbox.addEventListener('change', updateCount);
  updateCount();
  addButton.addEventListener('click', () => {
    void addSelected(storeId, rows, addButton, feedback, updateCount);
  });
  footer.append(addButton, feedback);
  group.append(footer);
  return group;
}

/**
 * @param {DiscountMatch} match
 * @param {StoreAdapter|null} adapter
 * @param {boolean} defaultChecked
 * @returns {{row: HTMLElement, checkbox: HTMLInputElement}}
 */
function renderMatchRow(match, adapter, defaultChecked) {
  const product = match.product;
  const row = el('div', 'match-row');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'match-check';
  checkbox.checked = defaultChecked;
  checkbox.setAttribute('aria-label', `Add ${product.title} to cart`);

  const body = el('div', 'match-body');
  if (product.url) {
    const link = document.createElement('a');
    link.className = 'match-title';
    link.textContent = product.title;
    link.title = product.title;
    link.href = product.url;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openInNewTab(product.url);
    });
    body.append(link);
  } else {
    const title = el('span', 'match-title', product.title);
    title.title = product.title;
    body.append(title);
  }

  const priceLine = el('div', 'price-line');
  if (product.price !== null) {
    priceLine.append(el('span', 'price', formatPrice(product.price, adapter)));
  }
  if (product.wasPrice !== null && (product.price === null || product.wasPrice > product.price)) {
    priceLine.append(el('s', 'was-price', formatPrice(product.wasPrice, adapter)));
  }
  const pct = product.discountPct ?? discountPct(product.price, product.wasPrice);
  if (pct !== null) priceLine.append(el('span', 'discount-badge', `-${pct}%`));
  if (priceLine.childNodes.length > 0) body.append(priceLine);

  row.append(checkbox, body);
  return { row, checkbox };
}

/**
 * @param {string} storeId
 * @param {{checkbox: HTMLInputElement, match: DiscountMatch}[]} rows
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} feedback
 * @param {() => void} updateCount
 */
async function addSelected(storeId, rows, button, feedback, updateCount) {
  const selected = rows.filter((r) => r.checkbox.checked);
  if (selected.length === 0) return;

  const quantityByItemId = new Map(state.list.map((item) => [item.id, item.quantity]));
  const items = selected.map(({ match }) => ({
    product: match.product,
    quantity: quantityByItemId.get(match.listItemId) ?? 1,
  }));

  button.disabled = true;
  button.textContent = 'Adding to cart…';
  feedback.className = 'feedback';
  feedback.textContent = '';

  const res = await send({ type: 'ADD_TO_CART', storeId, items });
  if (!res.ok) {
    if (res.code === 'LICENSE_EXPIRED') {
      showExpired();
      return;
    }
    feedback.textContent = res.error || 'Could not add to cart.';
    feedback.classList.add('error');
    updateCount();
    return;
  }

  const added = Number.isFinite(res.added) ? res.added : 0;
  const failed = Number.isFinite(res.failed) ? res.failed : 0;
  if (failed > 0) {
    feedback.textContent =
      `Added ${added} item${added === 1 ? '' : 's'}, ${failed} failed — the store page may ` +
      'have changed. Review your cart and place the order yourself.';
    feedback.classList.add('error');
  } else {
    feedback.textContent =
      `Added ${added} item${added === 1 ? '' : 's'} — review your cart and place the order yourself.`;
    feedback.classList.add('success');
  }
  updateCount();
}

// ------------------------------------------------------------------- init --

function wireStaticHandlers() {
  $('options-button').addEventListener('click', () => {
    if (ext.runtime.openOptionsPage) ext.runtime.openOptionsPage().catch(() => {});
  });
  $('scan-button').addEventListener('click', () => void startScan());
  wireQuickAdd();
  wirePasteImport();

  onChanged('groceryList', (newValue) => {
    const next = Array.isArray(newValue) ? newValue : [];
    if (JSON.stringify(next) === JSON.stringify(state.list)) return;
    state.list = next;
    renderList();
  });
}

async function init() {
  wireStaticHandlers();
  updateScanButton();
  await Promise.all([loadLicense(), loadRegion(), loadList()]);
  await loadLastScan(); // after loadRegion so results can show store names
}

void init();
