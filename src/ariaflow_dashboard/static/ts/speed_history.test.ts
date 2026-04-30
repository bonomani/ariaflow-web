import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendGlobalSpeed,
  appendItemSpeed,
  GLOBAL_SPEED_MAX,
  recordItemSpeed,
  SPEED_HISTORY_MAX,
  type SpeedHistoryMap,
} from './speed_history.js';

// ---------- appendItemSpeed ----------

test('appendItemSpeed appends and caps at SPEED_HISTORY_MAX', () => {
  const r = appendItemSpeed([1, 2, 3], 4);
  assert.deepEqual(r, [1, 2, 3, 4]);
});

test('appendItemSpeed coerces null/undefined/strings to numbers', () => {
  assert.deepEqual(appendItemSpeed([], null), [0]);
  assert.deepEqual(appendItemSpeed([], undefined), [0]);
  assert.deepEqual(appendItemSpeed([], '123'), [123]);
  assert.deepEqual(appendItemSpeed([], 'NaN'), [0]);
});

test('appendItemSpeed slices to cap when the buffer overflows', () => {
  const seed = Array.from({ length: SPEED_HISTORY_MAX }, (_, i) => i);
  const r = appendItemSpeed(seed, 999);
  assert.equal(r.length, SPEED_HISTORY_MAX);
  assert.equal(r[r.length - 1], 999);
  assert.equal(r[0], 1); // dropped index 0
});

test('appendItemSpeed skips appending consecutive zeros (idle-row optimization)', () => {
  const seed = [10, 0];
  const r = appendItemSpeed(seed, 0);
  assert.equal(r, seed); // exact reference preserved
});

test('appendItemSpeed does append a single zero after non-zero', () => {
  const seed = [10, 20];
  const r = appendItemSpeed(seed, 0);
  assert.deepEqual(r, [10, 20, 0]);
});

test('appendItemSpeed does append zero when buffer is empty', () => {
  const r = appendItemSpeed(undefined, 0);
  assert.deepEqual(r, [0]);
});

test('appendItemSpeed honors a custom cap', () => {
  const r = appendItemSpeed([1, 2, 3, 4], 5, 3);
  assert.deepEqual(r, [3, 4, 5]);
});

// ---------- recordItemSpeed ----------

test('recordItemSpeed returns same map when itemId is empty', () => {
  const m: SpeedHistoryMap = { a: [1] };
  assert.equal(recordItemSpeed(m, '', 5), m);
});

test('recordItemSpeed inserts a fresh series for an unseen itemId', () => {
  const r = recordItemSpeed({}, 'x', 5);
  assert.deepEqual(r, { x: [5] });
});

test('recordItemSpeed appends to an existing series and replaces map ref', () => {
  const m: SpeedHistoryMap = { x: [1, 2] };
  const r = recordItemSpeed(m, 'x', 3);
  assert.notEqual(r, m);
  assert.deepEqual(r.x, [1, 2, 3]);
});

test('recordItemSpeed returns same map ref when no-op rule kicks in', () => {
  const m: SpeedHistoryMap = { x: [10, 0] };
  const r = recordItemSpeed(m, 'x', 0);
  assert.equal(r, m); // same reference: no Alpine churn
});

// ---------- appendGlobalSpeed ----------

test('appendGlobalSpeed appends to both series', () => {
  const r = appendGlobalSpeed({ download: [1], upload: [10] }, 2, 20);
  assert.deepEqual(r.download, [1, 2]);
  assert.deepEqual(r.upload, [10, 20]);
});

test('appendGlobalSpeed caps at GLOBAL_SPEED_MAX by default', () => {
  const seed = Array.from({ length: GLOBAL_SPEED_MAX }, (_, i) => i);
  const r = appendGlobalSpeed({ download: seed, upload: seed }, 999, 999);
  assert.equal(r.download.length, GLOBAL_SPEED_MAX);
  assert.equal(r.upload.length, GLOBAL_SPEED_MAX);
  assert.equal(r.download[r.download.length - 1], 999);
});

test('appendGlobalSpeed coerces non-numeric inputs to 0', () => {
  const r = appendGlobalSpeed({ download: [], upload: [] }, null, undefined);
  assert.deepEqual(r.download, [0]);
  assert.deepEqual(r.upload, [0]);
});

test('appendGlobalSpeed honors a custom cap', () => {
  const r = appendGlobalSpeed({ download: [1, 2, 3], upload: [4, 5, 6] }, 9, 99, 3);
  assert.deepEqual(r.download, [2, 3, 9]);
  assert.deepEqual(r.upload, [5, 6, 99]);
});
