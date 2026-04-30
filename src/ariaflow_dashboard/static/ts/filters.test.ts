import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  filterQueueItems,
  isFilterButtonVisible,
  matchesSearch,
  matchesStatusFilter,
  normalizeStatus,
  type FilterableItem,
} from './filters.js';

const items: FilterableItem[] = [
  { status: 'active', url: 'https://example.com/foo.iso', output: '/tmp/foo.iso' },
  { status: 'paused', url: 'https://example.com/bar.zip', output: '/tmp/bar.zip' },
  { status: 'complete', url: 'https://other.org/baz.tar', output: '/tmp/baz.tar' },
  { status: 'error', url: 'https://example.com/qux.deb', output: '/tmp/qux.deb' },
  {
    status: 'waiting',
    url: 'https://example.com/quux.iso',
    output: '/tmp/quux.iso',
    live: { url: 'http://mirror.example.com/quux.iso' },
  },
];

test('normalizeStatus lowercases', () => {
  assert.equal(normalizeStatus(undefined), 'unknown');
  assert.equal(normalizeStatus(null), 'unknown');
  assert.equal(normalizeStatus('Active'), 'active');
});

test('matchesStatusFilter "all" accepts every item', () => {
  for (const item of items) {
    assert.equal(matchesStatusFilter(item, 'all'), true);
  }
});

test('matchesStatusFilter direct comparison only (no aliases)', () => {
  assert.equal(matchesStatusFilter({ status: 'active' }, 'active'), true);
  assert.equal(matchesStatusFilter({ status: 'complete' }, 'complete'), true);
  assert.equal(matchesStatusFilter({ status: 'paused' }, 'active'), false);
  assert.equal(matchesStatusFilter({ status: 'queued' }, 'queued'), true);
});

test('matchesSearch is case-insensitive across url, output, live.url', () => {
  assert.equal(matchesSearch(items[0]!, 'FOO'), true); // url
  assert.equal(matchesSearch(items[0]!, '/tmp/'), true); // output
  assert.equal(matchesSearch(items[4]!, 'mirror'), true); // live.url
  assert.equal(matchesSearch(items[0]!, 'nope'), false);
});

test('matchesSearch with empty search matches everything', () => {
  for (const item of items) {
    assert.equal(matchesSearch(item, ''), true);
  }
});

test('filterQueueItems composes status + search', () => {
  const r = filterQueueItems(items, 'active', 'foo');
  assert.equal(r.length, 1);
  assert.equal(r[0]!.url, 'https://example.com/foo.iso');
});

test('filterQueueItems with all + empty search returns input unchanged', () => {
  assert.equal(filterQueueItems(items, 'all', '').length, items.length);
});

test('isFilterButtonVisible always shows stable filters', () => {
  for (const f of ['all', 'active', 'paused', 'complete', 'error']) {
    assert.equal(isFilterButtonVisible(f, {}, 'all'), true);
  }
});

test('isFilterButtonVisible shows non-stable filter when count > 0', () => {
  assert.equal(isFilterButtonVisible('queued', { queued: 3 }, 'all'), true);
  assert.equal(isFilterButtonVisible('queued', { queued: 0 }, 'all'), false);
});

test('isFilterButtonVisible shows the currently-selected filter even with zero items', () => {
  assert.equal(isFilterButtonVisible('queued', {}, 'queued'), true);
});
