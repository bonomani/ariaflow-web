import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAllSelected,
  isSomeSelected,
  normalizeFiles,
  selectedFileIndexes,
  setAllSelected,
  type NormalizedFile,
} from './file_selection.js';

test('normalizeFiles defaults selected to true when missing or null', () => {
  const r = normalizeFiles([
    { index: 0, path: '/a' },
    { index: 1, path: '/b', selected: null },
    { index: 2, path: '/c', selected: true },
  ]);
  assert.deepEqual(
    r.map((f) => f.selected),
    [true, true, true],
  );
});

test('normalizeFiles flips to false only on explicit false', () => {
  const r = normalizeFiles([
    { index: 0, selected: false },
    { index: 1, selected: true },
  ]);
  assert.deepEqual(
    r.map((f) => f.selected),
    [false, true],
  );
});

test('normalizeFiles returns [] for non-array input', () => {
  assert.deepEqual(normalizeFiles(undefined), []);
  assert.deepEqual(normalizeFiles(null), []);
  assert.deepEqual(normalizeFiles({}), []);
  assert.deepEqual(normalizeFiles('files'), []);
});

test('normalizeFiles preserves other fields via spread', () => {
  const r = normalizeFiles([{ index: 0, path: '/foo', length: '1024' }]);
  assert.equal(r[0]!.path, '/foo');
  assert.equal(r[0]!.length, '1024');
  assert.equal(r[0]!.selected, true);
});

test('selectedFileIndexes returns numeric indexes of selected files only', () => {
  const files: NormalizedFile[] = [
    { index: 0, selected: true },
    { index: 1, selected: false },
    { index: 2, selected: true },
  ];
  assert.deepEqual(selectedFileIndexes(files), [0, 2]);
});

test('selectedFileIndexes skips entries without a numeric index', () => {
  const files: NormalizedFile[] = [
    { selected: true },
    { index: 5, selected: true },
  ];
  assert.deepEqual(selectedFileIndexes(files), [5]);
});

test('isAllSelected returns false for an empty list', () => {
  assert.equal(isAllSelected([]), false);
});

test('isAllSelected returns true when every file is selected', () => {
  assert.equal(
    isAllSelected([
      { index: 0, selected: true },
      { index: 1, selected: true },
    ]),
    true,
  );
});

test('isAllSelected returns false when any file is unselected', () => {
  assert.equal(
    isAllSelected([
      { index: 0, selected: true },
      { index: 1, selected: false },
    ]),
    false,
  );
});

test('isSomeSelected is true only for a mixed list', () => {
  assert.equal(isSomeSelected([{ index: 0, selected: true }]), false);
  assert.equal(isSomeSelected([{ index: 0, selected: false }]), false);
  assert.equal(
    isSomeSelected([
      { index: 0, selected: true },
      { index: 1, selected: false },
    ]),
    true,
  );
});

test('setAllSelected flips every entry while preserving other fields', () => {
  const files: NormalizedFile[] = [
    { index: 0, path: '/a', selected: true },
    { index: 1, path: '/b', selected: false },
  ];
  const r = setAllSelected(files, false);
  assert.deepEqual(
    r.map((f) => f.selected),
    [false, false],
  );
  assert.equal(r[0]!.path, '/a');
  assert.equal(r[1]!.path, '/b');
});
