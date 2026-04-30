import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  KEYS,
  readString,
  readNumber,
  readJson,
  readTheme,
  writeTheme,
  readRefreshInterval,
  writeRefreshInterval,
  readBackends,
  writeBackends,
  readSelectedBackend,
  writeSelectedBackend,
} from './storage.js';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.has(k) ? this.store.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, String(v));
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
});

test('readString returns fallback on missing key', () => {
  assert.equal(readString(KEYS.theme, 'system'), 'system');
});

test('readString trims and falls back on empty string', () => {
  localStorage.setItem(KEYS.theme, '   ');
  assert.equal(readString(KEYS.theme, 'system'), 'system');
});

test('readNumber returns fallback for missing / non-positive / NaN', () => {
  assert.equal(readNumber(KEYS.refreshInterval, 10000), 10000);
  localStorage.setItem(KEYS.refreshInterval, '0');
  assert.equal(readNumber(KEYS.refreshInterval, 10000), 10000);
  localStorage.setItem(KEYS.refreshInterval, 'abc');
  assert.equal(readNumber(KEYS.refreshInterval, 10000), 10000);
  localStorage.setItem(KEYS.refreshInterval, '5000');
  assert.equal(readNumber(KEYS.refreshInterval, 10000), 5000);
});

test('readJson returns fallback on parse error', () => {
  localStorage.setItem(KEYS.backends, '{not json');
  assert.deepEqual(readJson(KEYS.backends, []), []);
});

test('readTheme normalizes invalid values to system', () => {
  assert.equal(readTheme(), 'system');
  writeTheme('dark');
  assert.equal(readTheme(), 'dark');
  localStorage.setItem(KEYS.theme, 'rainbow');
  assert.equal(readTheme(), 'system');
});

test('refreshInterval round-trips', () => {
  writeRefreshInterval(2500);
  assert.equal(readRefreshInterval(), 2500);
});

test('backends round-trip and reject non-array stored value', () => {
  writeBackends(['http://a', 'http://b']);
  assert.deepEqual(readBackends(), ['http://a', 'http://b']);
  localStorage.setItem(KEYS.backends, '"not-an-array"');
  assert.deepEqual(readBackends(), []);
});

test('backends drops empty / whitespace entries', () => {
  localStorage.setItem(KEYS.backends, JSON.stringify(['  http://a ', '', null, '   ']));
  assert.deepEqual(readBackends(), ['http://a']);
});

test('selected backend round-trips', () => {
  writeSelectedBackend('http://x');
  assert.equal(readSelectedBackend(), 'http://x');
});
