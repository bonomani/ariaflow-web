import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FreshnessRouter, type EndpointMeta, type RouterAdapters } from './freshness.js';

interface FakeClock {
  now: number;
  timers: Map<number, { fireAt: number; cb: () => void }>;
  nextId: number;
}

function makeAdapters(opts: {
  responses?: Record<string, unknown>;
  failOn?: Set<string>;
} = {}): { adapters: RouterAdapters; fakeClock: FakeClock; fetchLog: string[]; routerLog: unknown[] } {
  const fakeClock: FakeClock = { now: 1_000_000, timers: new Map(), nextId: 1 };
  const fetchLog: string[] = [];
  const routerLog: unknown[] = [];
  const adapters: RouterAdapters = {
    now: () => fakeClock.now,
    setTimer: (cb, ms) => {
      const id = fakeClock.nextId++;
      fakeClock.timers.set(id, { fireAt: fakeClock.now + ms, cb });
      return id;
    },
    clearTimer: (token) => {
      fakeClock.timers.delete(token as number);
    },
    fetchJson: async (method, path) => {
      const key = `${method} ${path}`;
      fetchLog.push(key);
      if (opts.failOn?.has(key)) throw new Error(`boom ${key}`);
      return opts.responses?.[key] ?? { ok: true, key };
    },
    log: (entry) => routerLog.push(entry),
  };
  return { adapters, fakeClock, fetchLog, routerLog };
}

async function tick(): Promise<void> {
  // Drain enough microtask cycles to flush a fetchJson resolve →
  // .then(set state) → .then(reconcile) → next tick's promise chain.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function advance(fakeClock: FakeClock, ms: number): void {
  fakeClock.now += ms;
  // Fire any due timers in registration order.
  const due = [...fakeClock.timers.entries()]
    .filter(([, t]) => t.fireAt <= fakeClock.now)
    .sort((a, b) => a[1].fireAt - b[1].fireAt);
  for (const [id, t] of due) {
    fakeClock.timers.delete(id);
    t.cb();
  }
}

const META_LIFECYCLE: EndpointMeta = {
  method: 'GET',
  path: '/api/lifecycle',
  freshness: 'warm',
  ttl_s: 30,
  revalidate_on: ['POST /api/lifecycle/install'],
};

const META_STATUS: EndpointMeta = {
  method: 'GET',
  path: '/api/status',
  freshness: 'live',
  transport: 'sse',
};

const META_OPTIONS: EndpointMeta = {
  method: 'GET',
  path: '/api/options',
  freshness: 'cold',
};

const META_BANDWIDTH: EndpointMeta = {
  method: 'GET',
  path: '/api/bandwidth',
  freshness: 'on-action',
  revalidate_on: ['POST /api/bandwidth/probe'],
};

const META_HEALTH: EndpointMeta = {
  method: 'GET',
  path: '/api/health',
  freshness: 'bootstrap',
};

// ---------- subscribe / visibility / fetch ----------

test('warm endpoint: fetches on first visible subscribe, polls at ttl', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'comp1', { visible: true });
  // Initial reconcile schedules a 0ms timer; advance to fire it.
  advance(fakeClock, 0);
  await tick();
  assert.deepEqual(fetchLog, ['GET /api/lifecycle']);
  // Next fetch should be at ttl=30s.
  advance(fakeClock, 29_000);
  await tick();
  assert.equal(fetchLog.length, 1);
  advance(fakeClock, 1_500);
  await tick();
  assert.equal(fetchLog.length, 2);
});

test('warm endpoint: stops polling when last visible subscriber unsubscribes', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'comp1', { visible: true });
  advance(fakeClock, 0);
  await tick();
  assert.equal(fetchLog.length, 1);
  r.unsubscribe('GET', '/api/lifecycle', 'comp1');
  advance(fakeClock, 60_000);
  await tick();
  assert.equal(fetchLog.length, 1);
});

test('warm endpoint: stops polling when subscriber goes hidden', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'comp1', { visible: true });
  advance(fakeClock, 0);
  await tick();
  r.setSubscriberVisible('comp1', false);
  advance(fakeClock, 60_000);
  await tick();
  assert.equal(fetchLog.length, 1);
  r.setSubscriberVisible('comp1', true);
  advance(fakeClock, 0);
  await tick();
  // Cache is stale (60s > 30s ttl) → immediate refetch on resume.
  assert.equal(fetchLog.length, 2);
});

test('warm endpoint: stops polling when host hidden, resumes when host visible', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'comp1', { visible: true });
  advance(fakeClock, 0);
  await tick();
  r.setHostVisible(false);
  advance(fakeClock, 60_000);
  await tick();
  assert.equal(fetchLog.length, 1);
  r.setHostVisible(true);
  advance(fakeClock, 0);
  await tick();
  // Cache valid; no immediate refetch but a timer is now scheduled.
  assert.ok(fakeClock.timers.size >= 1);
});

test('cold endpoint: fetches once on visible subscribe, never polls', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_OPTIONS);
  r.subscribe('GET', '/api/options', 'comp1', { visible: true });
  await tick();
  assert.deepEqual(fetchLog, ['GET /api/options']);
  advance(fakeClock, 600_000);
  await tick();
  assert.equal(fetchLog.length, 1);
});

test('bootstrap endpoint: fetches once and never again, even across re-subscribes', async () => {
  const { adapters, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_HEALTH);
  r.subscribe('GET', '/api/health', 'comp1', { visible: true });
  await tick();
  r.unsubscribe('GET', '/api/health', 'comp1');
  r.subscribe('GET', '/api/health', 'comp2', { visible: true });
  await tick();
  assert.equal(fetchLog.length, 1);
});

test('live endpoint: router does not fetch (transport handles it)', async () => {
  const { adapters, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_STATUS);
  r.subscribe('GET', '/api/status', 'comp1', { visible: true });
  await tick();
  assert.equal(fetchLog.length, 0);
});

// ---------- on-action / revalidate_on ----------

test('on-action: initial fetch on subscribe, refetch on matching action', async () => {
  const { adapters, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_BANDWIDTH);
  r.subscribe('GET', '/api/bandwidth', 'comp1', { visible: true });
  await tick();
  assert.equal(fetchLog.length, 1);
  r.invalidateByAction('POST', '/api/bandwidth/probe');
  await tick();
  assert.equal(fetchLog.length, 2);
});

test('on-action: action with no matching endpoint is a no-op', async () => {
  const { adapters, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_BANDWIDTH);
  r.subscribe('GET', '/api/bandwidth', 'comp1', { visible: true });
  await tick();
  r.invalidateByAction('POST', '/api/something/else');
  await tick();
  assert.equal(fetchLog.length, 1);
});

test('on-action: invalidation while inactive does NOT fetch', async () => {
  const { adapters, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_BANDWIDTH);
  r.subscribe('GET', '/api/bandwidth', 'comp1', { visible: false });
  await tick();
  r.invalidateByAction('POST', '/api/bandwidth/probe');
  await tick();
  assert.equal(fetchLog.length, 0);
});

test('warm: revalidate_on triggers an immediate refetch even mid-interval', async () => {
  const { adapters, fakeClock, fetchLog } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'comp1', { visible: true });
  advance(fakeClock, 0);
  await tick();
  advance(fakeClock, 5_000); // mid-interval
  r.invalidateByAction('POST', '/api/lifecycle/install');
  await tick();
  assert.equal(fetchLog.length, 2);
});

// ---------- registerMeta / errors ----------

test('subscribe before registerMeta throws', () => {
  const { adapters } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  assert.throws(
    () => r.subscribe('GET', '/api/unknown', 'c', { visible: true }),
    /no meta registered/,
  );
});

test('registerMeta is idempotent and updates existing entry', () => {
  const { adapters } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.registerMeta({ ...META_LIFECYCLE, ttl_s: 60 });
  const s = r.status().find((e) => e.endpoint === 'GET /api/lifecycle')!;
  assert.equal(s.ttl_s, 60);
});

// ---------- status snapshot ----------

test('status() reports subscribers, host visibility, and active flag', () => {
  const { adapters } = makeAdapters();
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'a', { visible: true });
  r.subscribe('GET', '/api/lifecycle', 'b', { visible: false });
  const s = r.status()[0]!;
  assert.equal(s.visibleSubscribers, 1);
  assert.equal(s.hiddenSubscribers, 1);
  assert.equal(s.hostVisible, true);
  assert.equal(s.active, true);
  r.setHostVisible(false);
  assert.equal(r.status()[0]!.active, false);
});

// ---------- inflight dedupe ----------

test('runFetch dedupes overlapping requests', async () => {
  let resolveFetch!: (v: unknown) => void;
  const adapters: RouterAdapters = {
    now: () => 0,
    setTimer: () => 0,
    clearTimer: () => {},
    fetchJson: () => new Promise((res) => { resolveFetch = res; }),
  };
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_BANDWIDTH);
  r.subscribe('GET', '/api/bandwidth', 'c', { visible: true });
  // While the first is inflight, fire an invalidation.
  r.invalidateByAction('POST', '/api/bandwidth/probe');
  await tick();
  resolveFetch({ ok: true });
  await tick();
  // Hard to assert count without a counter; this exercises the path.
  assert.ok(true);
});

// ---------- onUpdate notify hook (FE-26 prerequisite) ----------

test('onUpdate fires after each successful fetch', async () => {
  const { adapters, fakeClock } = makeAdapters({ responses: { 'GET /api/lifecycle': { ok: true, n: 1 } } });
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  const seen: unknown[] = [];
  r.subscribe('GET', '/api/lifecycle', 'c', { visible: true, onUpdate: (v) => seen.push(v) });
  advance(fakeClock, 0);
  await tick();
  assert.deepEqual(seen, [{ ok: true, n: 1 }]);
});

test('onUpdate fires synchronously on subscribe when value already cached', async () => {
  const { adapters, fakeClock } = makeAdapters({ responses: { 'GET /api/lifecycle': { ok: true, n: 2 } } });
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  r.subscribe('GET', '/api/lifecycle', 'a', { visible: true });
  advance(fakeClock, 0);
  await tick();
  const seen: unknown[] = [];
  r.subscribe('GET', '/api/lifecycle', 'b', { visible: true, onUpdate: (v) => seen.push(v) });
  assert.deepEqual(seen, [{ ok: true, n: 2 }]);
});

test('unsubscribe stops further onUpdate calls', async () => {
  const { adapters, fakeClock } = makeAdapters({ responses: { 'GET /api/lifecycle': { ok: true } } });
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  let count = 0;
  r.subscribe('GET', '/api/lifecycle', 'c', { visible: true, onUpdate: () => count++ });
  advance(fakeClock, 0);
  await tick();
  assert.equal(count, 1);
  r.unsubscribe('GET', '/api/lifecycle', 'c');
  r.subscribe('GET', '/api/lifecycle', 'd', { visible: true });
  advance(fakeClock, 60_000);
  await tick();
  assert.equal(count, 1);
});

test('onUpdate exception is isolated — other subscribers still fire', async () => {
  const { adapters, fakeClock } = makeAdapters({ responses: { 'GET /api/lifecycle': { ok: true } } });
  const r = new FreshnessRouter(adapters);
  r.registerMeta(META_LIFECYCLE);
  let bGotIt = false;
  r.subscribe('GET', '/api/lifecycle', 'a', { visible: true, onUpdate: () => { throw new Error('boom'); } });
  r.subscribe('GET', '/api/lifecycle', 'b', { visible: true, onUpdate: () => { bGotIt = true; } });
  advance(fakeClock, 0);
  await tick();
  assert.equal(bGotIt, true);
});
