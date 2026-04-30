import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  apiPath,
  backendDisplayName,
  isSelfService,
  loadBackendState,
  mergeDiscoveredItems,
  saveBackendState,
  type DiscoveredService,
} from './backend.js';

const DEFAULT = 'http://127.0.0.1:8000';

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
  (globalThis as unknown as { window: Window }).window = {} as Window;
  window.__ARIAFLOW_DASHBOARD_HOSTNAME__ = 'pc31';
  window.__ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__ = '192.168.1.10';
  window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__ = ['192.168.1.10', '10.0.0.5'];
});

// ---------- loadBackendState / saveBackendState ----------

test('loadBackendState returns empty backends + default when storage is empty', () => {
  const s = loadBackendState(DEFAULT);
  assert.deepEqual(s.backends, []);
  assert.equal(s.selected, DEFAULT);
});

test('loadBackendState filters out the default URL from stored backends', () => {
  localStorage.setItem(
    'ariaflow.backends',
    JSON.stringify([DEFAULT, 'http://h2:8000', 'http://h3:8000']),
  );
  const s = loadBackendState(DEFAULT);
  assert.deepEqual(s.backends, ['http://h2:8000', 'http://h3:8000']);
});

test('loadBackendState falls back to default when selected is unknown', () => {
  localStorage.setItem('ariaflow.backends', JSON.stringify(['http://h2:8000']));
  localStorage.setItem('ariaflow.selected_backend', 'http://stale:8000');
  assert.equal(loadBackendState(DEFAULT).selected, DEFAULT);
});

test('saveBackendState writes back cleaned list and reconciled selected', () => {
  const s = saveBackendState([' http://h2:8000 ', '', DEFAULT, 'http://h2:8000'], 'http://h2:8000', DEFAULT);
  assert.deepEqual(s.backends, ['http://h2:8000']);
  assert.equal(s.selected, 'http://h2:8000');
  assert.deepEqual(JSON.parse(localStorage.getItem('ariaflow.backends')!), ['http://h2:8000']);
  assert.equal(localStorage.getItem('ariaflow.selected_backend'), 'http://h2:8000');
});

// ---------- isSelfService ----------

test('isSelfService matches by TXT hostname (case-insensitive)', () => {
  const item: DiscoveredService = { txt_hostname: 'PC31' };
  assert.equal(isSelfService(item, ['192.168.1.10']), true);
});

test('isSelfService matches by .local SRV host with trailing dot', () => {
  const item: DiscoveredService = { host: 'pc31.local.' };
  assert.equal(isSelfService(item, []), true);
});

test('isSelfService matches by IP membership', () => {
  const item: DiscoveredService = { ip: '10.0.0.5' };
  assert.equal(isSelfService(item, ['192.168.1.10', '10.0.0.5']), true);
});

test('isSelfService matches loopback IP prefix', () => {
  assert.equal(isSelfService({ ip: '127.0.0.1' }, []), true);
  assert.equal(isSelfService({ ip: '127.0.5.99' }, []), true);
});

test('isSelfService matches loopback URL hostname', () => {
  assert.equal(isSelfService({ url: 'http://127.0.0.1:9000' }, []), true);
});

test('isSelfService returns false for a remote service', () => {
  const item: DiscoveredService = {
    txt_hostname: 'other-host',
    host: 'other-host.local.',
    ip: '203.0.113.5',
    url: 'http://203.0.113.5:8000',
  };
  assert.equal(isSelfService(item, ['192.168.1.10']), false);
});

test('isSelfService ignores malformed URL gracefully', () => {
  assert.equal(isSelfService({ url: 'not a url' }, []), false);
});

// ---------- mergeDiscoveredItems ----------

test('mergeDiscoveredItems skips web-role services', () => {
  const r = mergeDiscoveredItems(
    [
      { url: 'http://web:80', name: 'web', role: 'web' },
      { url: 'http://h2:8000', name: 'h2', role: 'backend' },
    ],
    {},
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: [] },
  );
  assert.deepEqual(Object.keys(r.meta), ['http://h2:8000']);
});

test('mergeDiscoveredItems dedupes by Bonjour name', () => {
  const r = mergeDiscoveredItems(
    [
      { url: 'http://h2:8000', name: 'aria-1' },
      { url: 'http://h2:8001', name: 'aria-1' }, // dup name → dropped
      { url: 'http://h3:8000', name: 'aria-2' },
    ],
    {},
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: [] },
  );
  assert.deepEqual(r.state.backends.sort(), ['http://h2:8000', 'http://h3:8000']);
});

test('mergeDiscoveredItems auto-selects when exactly one remote and dashboard on default', () => {
  const r = mergeDiscoveredItems(
    [{ url: 'http://h2:8000', name: 'aria-1', ip: '203.0.113.5' }],
    {},
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: ['192.168.1.10'] },
  );
  assert.equal(r.autoSelectedUrl, 'http://h2:8000');
  assert.equal(r.state.selected, 'http://h2:8000');
});

test('mergeDiscoveredItems does NOT auto-select when more than one remote', () => {
  const r = mergeDiscoveredItems(
    [
      { url: 'http://h2:8000', name: 'a' },
      { url: 'http://h3:8000', name: 'b' },
    ],
    {},
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: [] },
  );
  assert.equal(r.autoSelectedUrl, null);
  assert.equal(r.state.selected, DEFAULT);
});

test('mergeDiscoveredItems does NOT auto-select when user already picked a non-default', () => {
  const r = mergeDiscoveredItems(
    [{ url: 'http://h2:8000', name: 'aria' }],
    {},
    { backends: ['http://h-existing:8000'], selected: 'http://h-existing:8000' },
    { defaultBackendUrl: DEFAULT, localIps: [] },
  );
  assert.equal(r.autoSelectedUrl, null);
  assert.equal(r.state.selected, 'http://h-existing:8000');
});

test('mergeDiscoveredItems drops self entries before deciding to auto-select', () => {
  const r = mergeDiscoveredItems(
    [{ url: 'http://192.168.1.10:8000', name: 'self', ip: '192.168.1.10' }],
    {},
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: ['192.168.1.10'] },
  );
  assert.equal(r.autoSelectedUrl, null);
  assert.equal(r.state.selected, DEFAULT);
});

test('mergeDiscoveredItems preserves prior metadata for URLs not present in the new batch', () => {
  const prev = {
    'http://old:8000': { name: 'old', host: '', ip: '', txt_hostname: '' },
  };
  const r = mergeDiscoveredItems(
    [{ url: 'http://h2:8000', name: 'h2' }],
    prev,
    { backends: [], selected: DEFAULT },
    { defaultBackendUrl: DEFAULT, localIps: [] },
  );
  assert.ok(r.meta['http://old:8000']);
  assert.ok(r.meta['http://h2:8000']);
});

// ---------- backendDisplayName ----------

test('backendDisplayName uses hostname + main IP for the default backend', () => {
  assert.equal(
    backendDisplayName(DEFAULT, {}, DEFAULT, '192.168.1.10'),
    'pc31 (192.168.1.10:8000)',
  );
});

test('backendDisplayName uses Bonjour name (with disambiguator stripped)', () => {
  const meta = {
    'http://h2:8000': { name: 'aria-server (2)', host: '', ip: '', txt_hostname: '' },
  };
  assert.equal(
    backendDisplayName('http://h2:8000', meta, DEFAULT, '192.168.1.10'),
    'aria-server (h2:8000)',
  );
});

test('backendDisplayName falls back to host:port when no metadata', () => {
  assert.equal(
    backendDisplayName('http://h3:9000', {}, DEFAULT, '192.168.1.10'),
    'h3:9000',
  );
});

test("backendDisplayName returns '-' for an empty URL", () => {
  assert.equal(backendDisplayName('', {}, DEFAULT, '192.168.1.10'), '-');
});

// ---------- apiPath ----------

test('apiPath joins backend URL with path, stripping trailing slashes', () => {
  assert.equal(apiPath('http://h:8000', '/api/x'), 'http://h:8000/api/x');
  assert.equal(apiPath('http://h:8000///', '/api/x'), 'http://h:8000/api/x');
});
