import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderItemSparkline, renderGlobalSparkline } from './sparkline.js';

test('renderItemSparkline returns empty string for short series', () => {
  assert.equal(renderItemSparkline(null), '');
  assert.equal(renderItemSparkline([]), '');
  assert.equal(renderItemSparkline([1]), '');
});

test('renderItemSparkline emits an SVG polyline for ≥2 points', () => {
  const svg = renderItemSparkline([1, 2, 3, 4]);
  assert.match(svg, /<svg /);
  assert.match(svg, /<polyline points="/);
  assert.match(svg, /viewBox="0 0 120 28"/);
});

test('renderGlobalSparkline returns empty for <2 dl points', () => {
  assert.equal(renderGlobalSparkline([], []), '');
  assert.equal(renderGlobalSparkline([5], []), '');
});

test('renderGlobalSparkline emits dl polyline + peak label', () => {
  const svg = renderGlobalSparkline([100, 200, 300], []);
  assert.match(svg, /<polyline points="[^"]+" fill="none" stroke="var\(--ws-accent\)"/);
  assert.match(svg, /peak ↓/);
});

test('renderGlobalSparkline adds upload polyline when ul has data', () => {
  const svg = renderGlobalSparkline([100, 200], [50, 80]);
  assert.match(svg, /stroke="var\(--ws-accent-2\)"/);
  assert.match(svg, /↑/);
});
