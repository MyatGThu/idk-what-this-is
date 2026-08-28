// node --test tests/registry.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ADAPTERS,
  SUPPORTED_COUNTRIES,
  adaptersForCountry,
  getAdapter,
  searchUrl,
} from '../extension/src/adapters/registry.js';

const manifestPath = fileURLToPath(
  new URL('../extension/manifest.chrome.json', import.meta.url),
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const COUNTRIES = ['AU', 'US', 'GB'];
const CURRENCIES = ['AUD', 'USD', 'GBP'];
const STRING_FIELDS = ['id', 'name', 'country', 'currency', 'homeUrl', 'cartUrl', 'searchUrlTemplate'];
const SELECTOR_KEYS = ['productTile', 'title', 'price', 'wasPrice', 'promoBadge', 'addToCartButton'];

test('registry has 8 adapters with unique well-formed ids', () => {
  assert.equal(ADAPTERS.length, 8);
  const ids = ADAPTERS.map((a) => a.id);
  assert.equal(new Set(ids).size, 8, 'ids must be unique');
  for (const id of ids) {
    assert.match(id, /^[a-z]{2}\.[a-z]+$/, `bad id: ${id}`);
  }
});

test('every adapter has valid country, currency, and non-empty string fields', () => {
  for (const adapter of ADAPTERS) {
    assert.ok(COUNTRIES.includes(adapter.country), `${adapter.id}: country ${adapter.country}`);
    assert.ok(CURRENCIES.includes(adapter.currency), `${adapter.id}: currency ${adapter.currency}`);
    for (const field of STRING_FIELDS) {
      assert.equal(typeof adapter[field], 'string', `${adapter.id}.${field} must be a string`);
      assert.ok(adapter[field].length > 0, `${adapter.id}.${field} must be non-empty`);
    }
    assert.ok(
      adapter.searchUrlTemplate.includes('{query}'),
      `${adapter.id}: searchUrlTemplate must contain {query}`,
    );
    assert.ok(Array.isArray(adapter.matchPatterns) && adapter.matchPatterns.length > 0);
  }
});

test('every adapter has all selector keys, non-empty', () => {
  for (const adapter of ADAPTERS) {
    for (const key of SELECTOR_KEYS) {
      assert.equal(typeof adapter.selectors[key], 'string', `${adapter.id}.selectors.${key}`);
      assert.ok(adapter.selectors[key].length > 0, `${adapter.id}.selectors.${key} is empty`);
    }
  }
});

test('SUPPORTED_COUNTRIES matches the adapter roster', () => {
  assert.deepEqual(
    SUPPORTED_COUNTRIES.map((c) => c.code).sort(),
    [...COUNTRIES].sort(),
  );
  for (const { code } of SUPPORTED_COUNTRIES) {
    assert.ok(adaptersForCountry(code).length > 0, `no adapters for ${code}`);
  }
});

test('getAdapter returns adapters by id and null for unknown', () => {
  for (const adapter of ADAPTERS) {
    assert.equal(getAdapter(adapter.id), adapter);
  }
  assert.equal(getAdapter('zz.nowhere'), null);
});

test('searchUrl replaces {query} and encodes spaces', () => {
  for (const adapter of ADAPTERS) {
    const url = searchUrl(adapter, 'full cream milk');
    assert.ok(!url.includes('{query}'), `${adapter.id}: {query} not replaced`);
    assert.ok(url.includes('full%20cream%20milk'), `${adapter.id}: spaces not encoded: ${url}`);
  }
});

test('every matchPattern is in the manifest host_permissions and content_scripts matches', () => {
  const hostPermissions = manifest.host_permissions;
  const contentMatches = manifest.content_scripts[0].matches;
  for (const adapter of ADAPTERS) {
    for (const pattern of adapter.matchPatterns) {
      assert.ok(
        hostPermissions.includes(pattern),
        `${adapter.id}: ${pattern} missing from host_permissions`,
      );
      assert.ok(
        contentMatches.includes(pattern),
        `${adapter.id}: ${pattern} missing from content_scripts[0].matches`,
      );
    }
  }
});
