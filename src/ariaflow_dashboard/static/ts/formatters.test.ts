import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatEta,
  formatBytes,
  formatRate,
  formatMbps,
  humanCap,
  shortName,
  relativeTime,
  badgeClass,
  sessionLabel,
} from './formatters.js';

test('formatBytes scales to KiB / MiB / GiB', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KiB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MiB');
  assert.equal(formatBytes(null), '-');
});

test('formatRate appends /s', () => {
  assert.equal(formatRate(1024), '1.0 KiB/s');
  assert.equal(formatRate(null), '-');
});

test('formatMbps appends suffix', () => {
  assert.equal(formatMbps(50), '50 Mbps');
  assert.equal(formatMbps(null), '-');
});

test('formatEta returns null when stalled or done', () => {
  assert.equal(formatEta(100, 100, 0), null);
  assert.equal(formatEta(100, 0, 0), null);
});

test('formatEta formats seconds, minutes, hours', () => {
  assert.equal(formatEta(100, 0, 10), '10s');
  assert.equal(formatEta(6000, 0, 10), '10m 0s');
  assert.equal(formatEta(360000, 0, 10), '10h 0m');
});

test('humanCap normalizes zero/empty to "unlimited"', () => {
  assert.equal(humanCap(null), '-');
  assert.equal(humanCap(0), 'unlimited');
  assert.equal(humanCap('0 Mbps'), 'unlimited');
  assert.equal(humanCap('20M'), '20M');
});

test('shortName extracts last URL path segment', () => {
  assert.equal(shortName('https://example.com/foo/bar.iso'), 'bar.iso');
  assert.equal(shortName('https://example.com/'), 'example.com');
  assert.equal(shortName('relative/path/file.txt'), 'file.txt');
  assert.equal(shortName(null), '(no name)');
});

test('relativeTime returns "just now" / Xm ago / Xh ago / Xd ago', () => {
  const now = Date.now();
  assert.equal(relativeTime(new Date(now - 30_000).toISOString()), 'just now');
  assert.equal(relativeTime(new Date(now - 5 * 60_000).toISOString()), '5 min ago');
  assert.equal(relativeTime(new Date(now - 3 * 3_600_000).toISOString()), '3h ago');
  assert.equal(relativeTime(null), '-');
});

test('badgeClass maps status groups', () => {
  assert.equal(badgeClass('complete'), 'badge good');
  assert.equal(badgeClass('removed'), 'badge bad');
  assert.equal(badgeClass('error'), 'badge bad');
  assert.equal(badgeClass('paused'), 'badge warn');
  assert.equal(badgeClass('whatever'), 'badge');
});

test('sessionLabel reflects open vs closed', () => {
  assert.equal(
    sessionLabel({ session_id: 'abcdef1234', session_closed_at: null }),
    'current abcdef12',
  );
  assert.equal(
    sessionLabel({ session_id: 'abcdef1234', session_closed_at: '2026-01-01' }),
    'closed abcdef12',
  );
  assert.equal(sessionLabel(null), '-');
});
