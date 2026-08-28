// Grocery sheet parsing and item <-> product-title matching.
// PURE module: no browser APIs, no storage — imports only types.js.

import { normalizeGroceryItem, isDiscounted, discountPct } from './types.js';

/** @typedef {import('./types.js').GroceryItem} GroceryItem */
/** @typedef {import('./types.js').Product} Product */
/** @typedef {import('./types.js').DiscountMatch} DiscountMatch */

const LEADING_BULLET_RE = /^\s*(?:[-–—*•·▪‣+]+\s*|\d{1,3}[.)]\s+)/;
const PAREN_RE = /\(([^)]*)\)/g;
const QTY_LEADING_RE = /^(\d{1,3})\s*[x×]\s+(.+)$/i;
const QTY_TRAILING_X_RE = /^(.+?)\s*[x×]\s*(\d{1,3})$/i;
const QTY_TRAILING_COMMA_RE = /^(.+?)\s*,\s*(\d{1,3})$/;

let idCounter = 0;
function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  idCounter += 1;
  return `item-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Parse a pasted "grocery sheet": one item per non-empty line.
 * Understands leading bullets/numbering, the quantity forms
 * "2x milk" / "milk x2" / "milk, 2" / "milk (2)", and treats non-quantity
 * parenthesized text as notes.
 * @param {string} text
 * @returns {GroceryItem[]}
 */
export function parseGrocerySheet(text) {
  const items = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(LEADING_BULLET_RE, '').trim();
    if (!line) continue;

    let quantity = null;
    const notes = [];
    line = line
      .replace(PAREN_RE, (whole, inner) => {
        const content = String(inner).trim();
        if (/^\d{1,3}$/.test(content)) {
          if (quantity === null) quantity = Number(content);
        } else if (content) {
          notes.push(content);
        }
        return ' ';
      })
      .trim();

    let name = line;
    let m;
    if (quantity === null && (m = QTY_LEADING_RE.exec(line))) {
      quantity = Number(m[1]);
      name = m[2];
    } else if (quantity === null && (m = QTY_TRAILING_X_RE.exec(line))) {
      name = m[1];
      quantity = Number(m[2]);
    } else if (quantity === null && (m = QTY_TRAILING_COMMA_RE.exec(line))) {
      name = m[1];
      quantity = Number(m[2]);
    }

    name = name.replace(/\s{2,}/g, ' ').replace(/[\s,;-]+$/, '').trim();
    if (!name) continue;

    items.push(
      normalizeGroceryItem(
        { name, quantity: quantity ?? 1, notes: notes.join('; ') },
        makeId(),
      ),
    );
  }
  return items;
}

/**
 * Lowercase, strip diacritics, collapse punctuation to spaces, collapse
 * whitespace.
 * @param {string} s
 * @returns {string}
 */
export function normalizeTitle(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'a', 'an', 'of', 'the', 'and', 'or', 'for', 'to', 'with', 'in', 'on', 'at', 'by', 'per', 'each',
]);

/**
 * Significant tokens of a name/title: stopwords and 1-char non-digit tokens
 * dropped; number+unit tokens like "2l" / "500g" kept.
 * @param {string} s
 * @returns {string[]}
 */
export function tokenize(s) {
  return normalizeTitle(s)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t) && (t.length >= 2 || /^\d$/.test(t)));
}

// Exact token match, or prefix match ("tomato" ~ "tomatoes") when the shorter
// token has at least 3 chars.
function tokenMatches(a, b) {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && longer.startsWith(shorter);
}

const ALL_TOKENS_BONUS = 0.1;
const LENGTH_PENALTY_PER_TOKEN = 0.03;
const LENGTH_PENALTY_MAX = 0.2;

/**
 * Deterministic 0..1 confidence that `productTitle` is the grocery item
 * `itemName`: fraction of item tokens present in the title (prefix matches
 * allowed), a small bonus when every item token is present, and a penalty
 * when the title is wildly longer than the item.
 * @param {string} itemName
 * @param {string} productTitle
 * @returns {number}
 */
export function matchScore(itemName, productTitle) {
  const itemTokens = tokenize(itemName);
  const titleTokens = tokenize(productTitle);
  if (itemTokens.length === 0 || titleTokens.length === 0) return 0;

  let found = 0;
  for (const it of itemTokens) {
    if (titleTokens.some((tt) => tokenMatches(it, tt))) found += 1;
  }
  if (found === 0) return 0;

  let score = found / itemTokens.length;
  if (found === itemTokens.length) score += ALL_TOKENS_BONUS;
  const excess = titleTokens.length - itemTokens.length * 2;
  if (excess > 0) score -= Math.min(LENGTH_PENALTY_MAX, excess * LENGTH_PENALTY_PER_TOKEN);
  return Math.max(0, Math.min(1, score));
}

function effectiveDiscountPct(product) {
  return product.discountPct ?? discountPct(product.price, product.wasPrice) ?? 0;
}

// item.maxPrice null = no cap; otherwise the product needs a known price
// within the cap (a null price passes only when there is no cap).
function respectsMaxPrice(item, product) {
  if (item.maxPrice === null || item.maxPrice === undefined) return true;
  return product.price !== null && product.price <= item.maxPrice;
}

/**
 * Best discounted matches per grocery item. Only discounted products within
 * the item's maxPrice and scoring >= minScore are considered; the top
 * maxPerItem per item are kept, sorted by discountPct desc, then score desc,
 * then price asc. The returned flat array is ordered by item, then rank.
 * @param {GroceryItem[]} groceryItems
 * @param {Product[]} products
 * @param {{minScore?: number, maxPerItem?: number}} [opts]
 * @returns {DiscountMatch[]}
 */
export function bestMatches(groceryItems, products, opts = {}) {
  const { minScore = 0.45, maxPerItem = 3 } = opts;
  const out = [];
  for (const item of groceryItems) {
    /** @type {DiscountMatch[]} */
    const candidates = [];
    for (const product of products) {
      if (!isDiscounted(product)) continue;
      if (!respectsMaxPrice(item, product)) continue;
      const score = matchScore(item.name, product.title);
      if (score < minScore) continue;
      candidates.push({ listItemId: item.id, listItemName: item.name, product, score });
    }
    candidates.sort(
      (a, b) =>
        effectiveDiscountPct(b.product) - effectiveDiscountPct(a.product) ||
        b.score - a.score ||
        (a.product.price ?? Infinity) - (b.product.price ?? Infinity),
    );
    out.push(...candidates.slice(0, maxPerItem));
  }
  return out;
}
