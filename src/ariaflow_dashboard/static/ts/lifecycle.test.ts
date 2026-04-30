import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeLifecycleStatus,
  isLifecycleHealthy,
  lifecycleActionsFor,
  lifecycleDetailLines,
  type LifecycleRecord,
} from './lifecycle.js';

// ---------- isLifecycleHealthy ----------

test('isLifecycleHealthy is false when record or result is missing', () => {
  assert.equal(isLifecycleHealthy(null), false);
  assert.equal(isLifecycleHealthy({}), false);
});

test('isLifecycleHealthy uses axes when present', () => {
  assert.equal(
    isLifecycleHealthy({ result: { installed: true, current: true, running: true } }),
    true,
  );
  assert.equal(
    isLifecycleHealthy({ result: { installed: true, current: true, running: false } }),
    false,
  );
  assert.equal(
    isLifecycleHealthy({ result: { installed: true, current: false, running: true } }),
    false,
  );
  assert.equal(
    isLifecycleHealthy({ result: { installed: false } }),
    false,
  );
});

test('isLifecycleHealthy treats null axis as N/A (healthy on that axis)', () => {
  assert.equal(
    isLifecycleHealthy({ result: { installed: true, current: null, running: true } }),
    true,
  );
  assert.equal(
    isLifecycleHealthy({ result: { installed: null, current: null, running: true } }),
    true,
  );
});

test('isLifecycleHealthy falls back to legacy reason when no axes', () => {
  assert.equal(isLifecycleHealthy({ result: { reason: 'match' } }), true);
  assert.equal(isLifecycleHealthy({ result: { reason: 'ready' } }), true);
  assert.equal(isLifecycleHealthy({ result: { reason: 'missing' } }), false);
  assert.equal(isLifecycleHealthy({ result: { reason: 'error' } }), false);
});

// ---------- describeLifecycleStatus ----------

test('describeLifecycleStatus axes — happy path', () => {
  assert.equal(
    describeLifecycleStatus('ariaflow-server', {
      result: { installed: true, current: true, running: true },
    }),
    'running · current',
  );
});

test('describeLifecycleStatus axes — stopped', () => {
  assert.equal(
    describeLifecycleStatus('aria2', {
      result: { installed: true, current: true, running: false },
    }),
    'installed · stopped',
  );
});

test('describeLifecycleStatus axes — update available with version', () => {
  assert.equal(
    describeLifecycleStatus('ariaflow-server', {
      result: { installed: true, current: false, version: '0.1.5', expected_version: '0.1.7' },
    }),
    'update available (0.1.5 → 0.1.7)',
  );
});

test('describeLifecycleStatus axes — update available without version info', () => {
  assert.equal(
    describeLifecycleStatus('aria2', {
      result: { installed: true, current: false },
    }),
    'update available',
  );
});

test('describeLifecycleStatus axes — not installed wins over current/running', () => {
  assert.equal(
    describeLifecycleStatus('aria2', {
      result: { installed: false, current: true, running: true },
    }),
    'not installed',
  );
});

test('describeLifecycleStatus axes — pure registration (launchd) running', () => {
  assert.equal(
    describeLifecycleStatus('aria2 auto-start (advanced)', {
      result: { installed: null, current: null, running: true },
    }),
    'loaded',
  );
});

test('describeLifecycleStatus axes — pure registration (launchd) not running', () => {
  assert.equal(
    describeLifecycleStatus('aria2 auto-start (advanced)', {
      result: { installed: null, current: null, running: false },
    }),
    'not loaded',
  );
});

test('describeLifecycleStatus axes — networkquality (current=null) uses installed/running', () => {
  assert.equal(
    describeLifecycleStatus('networkquality', {
      result: { installed: true, current: null, running: true },
    }),
    'running · current',
  );
});

test('describeLifecycleStatus axes — running=null collapses to installed/current', () => {
  assert.equal(
    describeLifecycleStatus('foo', {
      result: { installed: true, current: true, running: null },
    }),
    'installed · current',
  );
});

test('isLifecycleHealthy BG-29 — on-demand idle is healthy', () => {
  assert.equal(
    isLifecycleHealthy({
      result: { installed: true, current: true, running: false, expected_running: false },
    }),
    true,
  );
  assert.equal(
    isLifecycleHealthy({
      result: { installed: true, current: true, running: true, expected_running: false },
    }),
    false,
  );
});

test('describeLifecycleStatus BG-29 — on-demand idle label', () => {
  assert.equal(
    describeLifecycleStatus('aria2', {
      result: {
        installed: true,
        current: true,
        running: false,
        expected_running: false,
        managed_by: 'ariaflow',
      },
    }),
    'idle · on-demand (ariaflow)',
  );
});

test('describeLifecycleStatus BG-29 — managed_by suffix on running', () => {
  assert.equal(
    describeLifecycleStatus('aria2', {
      result: { installed: true, current: true, running: true, managed_by: 'launchd' },
    }),
    'running · current (launchd)',
  );
});

// ---------- describeLifecycleStatus legacy fallback ----------

test('describeLifecycleStatus legacy — ariaflow-server reason match', () => {
  assert.equal(
    describeLifecycleStatus('ariaflow-server', { result: { reason: 'match' } }),
    'installed · current',
  );
});

test('describeLifecycleStatus legacy — networkquality probe timeout', () => {
  assert.equal(
    describeLifecycleStatus('networkquality', { result: { reason: 'probe_timeout_no_parse' } }),
    'installed · probe timeout',
  );
});

test('describeLifecycleStatus legacy — launchd missing → not loaded', () => {
  assert.equal(
    describeLifecycleStatus('aria2 auto-start (advanced)', { result: { reason: 'missing' } }),
    'not loaded',
  );
});

test('describeLifecycleStatus legacy — falls back to outcome when reason unknown', () => {
  assert.equal(
    describeLifecycleStatus('aria2', { result: { reason: 'mystery', outcome: 'idk' } }),
    'idk',
  );
  assert.equal(
    describeLifecycleStatus('aria2', { result: { reason: 'mystery' } }),
    'unknown',
  );
});

// ---------- lifecycleDetailLines ----------

test('lifecycleDetailLines suppresses Reason: match when axes are present', () => {
  const lines = lifecycleDetailLines({
    result: {
      installed: true,
      current: true,
      running: true,
      reason: 'match',
      message: 'all good',
    },
  });
  assert.deepEqual(lines, ['all good']);
});

test('lifecycleDetailLines keeps diagnostic Reason even when axes are present', () => {
  const lines = lifecycleDetailLines({
    result: {
      installed: true,
      current: true,
      running: false,
      reason: 'rpc_unreachable',
    },
  });
  assert.deepEqual(lines, ['Reason: rpc_unreachable']);
});

test('lifecycleDetailLines preserves Reason when axes absent (legacy mode)', () => {
  const lines = lifecycleDetailLines({
    result: { reason: 'match', message: 'ok' },
  });
  assert.deepEqual(lines, ['ok', 'Reason: match']);
});

test('lifecycleDetailLines skips observation=ok', () => {
  const lines = lifecycleDetailLines({
    result: { observation: 'ok', message: 'fine' },
  });
  assert.deepEqual(lines, ['fine']);
});

test('lifecycleDetailLines includes completion when present', () => {
  const lines = lifecycleDetailLines({
    result: { installed: true, current: true, running: true, completion: 'rpc-ready' },
  });
  assert.deepEqual(lines, ['Completion: rpc-ready']);
});

test('lifecycleDetailLines returns [] for missing record', () => {
  assert.deepEqual(lifecycleDetailLines(null), []);
  assert.deepEqual(lifecycleDetailLines({}), []);
});

// ---------- lifecycleActionsFor ----------

const LEGACY_ARIAFLOW = [
  { target: 'ariaflow-server', action: 'install', label: 'Install / Update' },
  { target: 'ariaflow-server', action: 'uninstall', label: 'Remove' },
];

test('lifecycleActionsFor returns legacy actions when axes are absent', () => {
  const r = lifecycleActionsFor(
    'ariaflow-server',
    { result: { reason: 'match' } },
    LEGACY_ARIAFLOW,
  );
  assert.deepEqual(r, LEGACY_ARIAFLOW);
});

test('lifecycleActionsFor not-installed → only Install', () => {
  const r = lifecycleActionsFor(
    'ariaflow-server',
    { result: { installed: false, current: null, running: null } },
    LEGACY_ARIAFLOW,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.label, 'Install');
});

test('lifecycleActionsFor outdated → Update + Remove', () => {
  const r = lifecycleActionsFor(
    'ariaflow-server',
    { result: { installed: true, current: false, running: null } },
    LEGACY_ARIAFLOW,
  );
  assert.deepEqual(
    r.map((a) => a.label),
    ['Update', 'Remove'],
  );
});

test('lifecycleActionsFor running·current → Remove only', () => {
  const r = lifecycleActionsFor(
    'ariaflow-server',
    { result: { installed: true, current: true, running: true } },
    LEGACY_ARIAFLOW,
  );
  assert.deepEqual(
    r.map((a) => a.label),
    ['Remove'],
  );
});

test('lifecycleActionsFor pure registration (launchd) loaded → Unload only', () => {
  const r = lifecycleActionsFor(
    'aria2 auto-start (advanced)',
    { result: { installed: null, current: null, running: true } },
    [
      { target: 'aria2-launchd', action: 'install', label: 'Load' },
      { target: 'aria2-launchd', action: 'uninstall', label: 'Unload' },
    ],
  );
  assert.deepEqual(
    r.map((a) => a.label),
    ['Unload'],
  );
});

test('lifecycleActionsFor pure registration (launchd) not loaded → Load only', () => {
  const r = lifecycleActionsFor(
    'aria2 auto-start (advanced)',
    { result: { installed: null, current: null, running: false } },
    [
      { target: 'aria2-launchd', action: 'install', label: 'Load' },
      { target: 'aria2-launchd', action: 'uninstall', label: 'Unload' },
    ],
  );
  assert.deepEqual(
    r.map((a) => a.label),
    ['Load'],
  );
});
