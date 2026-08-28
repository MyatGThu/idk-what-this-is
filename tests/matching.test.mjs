import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGrocerySheet,
  normalizeTitle,
  tokenize,
  matchScore,
  bestMatches,
} from '../extension/src/common/matching.js';

/** Minimal discounted-by-default product factory. */
function product(overrides = {}) {
  return {
    storeId: 'au.test',
    title: '',
    url: '',
    price: null,
    wasPrice: null,
    discountPct: null,
    onSpecial: true,
    tileIndex: 0,
    query: '',
    ...overrides,
  };
}

describe('parseGrocerySheet', () => {
  test('one item per non-empty line, defaults quantity to 1', () => {
    const items = parseGrocerySheet('milk\n\nbread\n');
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'milk');
    assert.equal(items[0].quantity, 1);
    assert.equal(items[0].maxPrice, null);
    assert.equal(items[1].name, 'bread');
  });

  test('quantity form "2x milk"', () => {
    const [item] = parseGrocerySheet('2x milk');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 2);
  });

  test('quantity form "3 x eggs" (spaced)', () => {
    const [item] = parseGrocerySheet('3 x eggs');
    assert.equal(item.name, 'eggs');
    assert.equal(item.quantity, 3);
  });

  test('quantity form "milk x2"', () => {
    const [item] = parseGrocerySheet('milk x2');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 2);
  });

  test('quantity form "milk, 2"', () => {
    const [item] = parseGrocerySheet('milk, 2');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 2);
  });

  test('quantity form "milk (2)"', () => {
    const [item] = parseGrocerySheet('milk (2)');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 2);
  });

  test('strips leading bullets and numbering', () => {
    const items = parseGrocerySheet('- bread\n* butter\n• cheese\n1. eggs\n12) apples');
    assert.deepEqual(
      items.map((i) => i.name),
      ['bread', 'butter', 'cheese', 'eggs', 'apples'],
    );
    assert.ok(items.every((i) => i.quantity === 1));
  });

  test('non-quantity parentheses become notes', () => {
    const [item] = parseGrocerySheet('milk (lactose free)');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 1);
    assert.equal(item.notes, 'lactose free');
  });

  test('quantity and notes parentheses combine', () => {
    const [item] = parseGrocerySheet('- 2x milk (any brand)');
    assert.equal(item.name, 'milk');
    assert.equal(item.quantity, 2);
    assert.equal(item.notes, 'any brand');
  });

  test('numbered line with a quantity form keeps both apart', () => {
    const [item] = parseGrocerySheet('1. tomatoes x4');
    assert.equal(item.name, 'tomatoes');
    assert.equal(item.quantity, 4);
  });

  test('sizes in names survive ("1.5kg" is not numbering, "2L" is not a quantity)', () => {
    const [a, b] = parseGrocerySheet('1.5kg flour\nmilk 2L');
    assert.equal(a.name, '1.5kg flour');
    assert.equal(b.name, 'milk 2L');
    assert.equal(b.quantity, 1);
  });

  test('ids are unique and non-empty', () => {
    const items = parseGrocerySheet('milk\nbread\neggs');
    const ids = new Set(items.map((i) => i.id));
    assert.equal(ids.size, 3);
    assert.ok(items.every((i) => typeof i.id === 'string' && i.id.length > 0));
  });
});

describe('normalizeTitle', () => {
  test('lowercases, strips diacritics, collapses punctuation and whitespace', () => {
    assert.equal(normalizeTitle('Crème  Fraîche – 300g!'), 'creme fraiche 300g');
    assert.equal(normalizeTitle("Bulla's Thickened-Cream (600 ml)"), 'bulla s thickened cream 600 ml');
    assert.equal(normalizeTitle('   '), '');
  });
});

describe('tokenize', () => {
  test('drops stopwords and 1-char tokens, keeps number+unit tokens', () => {
    assert.deepEqual(tokenize('a carton of milk'), ['carton', 'milk']);
    assert.deepEqual(tokenize('Milk 2L'), ['milk', '2l']);
    assert.deepEqual(tokenize('Flour 500g for the pantry'), ['flour', '500g', 'pantry']);
  });
});

describe('matchScore', () => {
  test('exact > partial > unrelated', () => {
    const exact = matchScore('full cream milk', 'Full Cream Milk');
    const partial = matchScore('full cream milk', 'Milk 2L');
    const unrelated = matchScore('full cream milk', 'Dog Food 5kg');
    assert.ok(exact > partial, `expected ${exact} > ${partial}`);
    assert.ok(partial > unrelated, `expected ${partial} > ${unrelated}`);
    assert.equal(unrelated, 0);
    assert.ok(exact <= 1 && exact >= 0);
  });

  test('prefix matches count ("tomato" ~ "tomatoes")', () => {
    assert.ok(matchScore('tomato', 'Roma Tomatoes 500g') >= 0.9);
  });

  test('wildly longer titles score below a tight title', () => {
    const tight = matchScore('milk', 'Milk 2L');
    const bloated = matchScore(
      'milk',
      'Chocolate Flavoured Malt Milk Drink Family Value Multipack Six Bottles Limited Edition',
    );
    assert.ok(bloated < tight, `expected ${bloated} < ${tight}`);
  });

  test('deterministic', () => {
    assert.equal(matchScore('brown rice', 'SunRice Brown Rice 1kg'), matchScore('brown rice', 'SunRice Brown Rice 1kg'));
  });
});

describe('bestMatches', () => {
  const milk = { id: 'i1', name: 'milk', quantity: 1, maxPrice: null, notes: '' };
  const bread = { id: 'i2', name: 'bread', quantity: 1, maxPrice: 3, notes: '' };

  test('only discounted products are considered', () => {
    const products = [
      product({ title: 'Milk 2L', price: 3, onSpecial: false, wasPrice: null }),
      product({ title: 'Milk 1L', price: 2, wasPrice: 3, onSpecial: false, discountPct: 33 }),
    ];
    const matches = bestMatches([milk], products);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].product.title, 'Milk 1L');
    assert.equal(matches[0].listItemId, 'i1');
    assert.equal(matches[0].listItemName, 'milk');
  });

  test('maxPrice caps candidates; null price fails a cap but passes without one', () => {
    const products = [
      product({ title: 'Bread White', price: 4.5, discountPct: 20 }),
      product({ title: 'Bread Multigrain', price: 2.5, discountPct: 20 }),
      product({ title: 'Bread Rye', price: null, discountPct: 20 }),
    ];
    const capped = bestMatches([bread], products);
    assert.deepEqual(capped.map((m) => m.product.title), ['Bread Multigrain']);

    const uncapped = bestMatches([{ ...bread, maxPrice: null }], products);
    assert.equal(uncapped.length, 3);
    assert.ok(uncapped.some((m) => m.product.price === null));
  });

  test('keeps top maxPerItem sorted by discountPct desc, score desc, price asc', () => {
    const products = [
      product({ title: 'Milk 2L', price: 3, discountPct: 30 }),
      product({ title: 'Milk 1L', price: 2, discountPct: 50 }),
      product({ title: 'Milk 600ml', price: 2, discountPct: 30 }),
      product({ title: 'Milk 3L', price: 6, discountPct: 5 }),
    ];
    const all = bestMatches([milk], products);
    assert.deepEqual(
      all.map((m) => m.product.title),
      ['Milk 1L', 'Milk 600ml', 'Milk 2L'], // 50% first; 30% tie broken by price asc
    );
    const two = bestMatches([milk], products, { maxPerItem: 2 });
    assert.deepEqual(two.map((m) => m.product.title), ['Milk 1L', 'Milk 600ml']);
  });

  test('minScore filters weak matches', () => {
    const products = [product({ title: 'Almond Butter 250g', price: 5, discountPct: 40 })];
    assert.deepEqual(bestMatches([milk], products), []);
  });

  test('flat result is ordered by item then rank', () => {
    const products = [
      product({ title: 'Bread White', price: 2, discountPct: 10 }),
      product({ title: 'Milk 2L', price: 3, discountPct: 20 }),
    ];
    const matches = bestMatches([milk, bread], products);
    assert.deepEqual(matches.map((m) => m.listItemId), ['i1', 'i2']);
    assert.ok(matches.every((m) => m.score >= 0.45 && m.score <= 1));
  });
});
