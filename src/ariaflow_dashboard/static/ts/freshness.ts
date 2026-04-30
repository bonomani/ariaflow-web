// FE-24: FreshnessRouter — subscriber-driven, ref-counted refresh.
//
// Three conditions must all hold for the router to do I/O on an
// endpoint:
//   1. Class permits work right now (cold = subscribe-time only,
//      warm = at intervals, live = while transport open, ...).
//   2. Host visibility is true (tab visible, or host shell hasn't
//      hidden us via postMessage).
//   3. At least one subscriber for the endpoint is visible.
//
// Design and rationale: docs/FRESHNESS_AXIS.md. Backend contract
// (BG-31): each endpoint declares meta.freshness, ttl_s,
// revalidate_on. Index at GET /api/_meta.
//
// This module is transport-agnostic and Alpine-free. Wire it into
// app.ts (or any other view layer) by passing fetch/SSE adapters
// at construction.

export type FreshnessClass =
  | 'bootstrap'
  | 'live'
  | 'warm'
  | 'cold'
  | 'on-action'
  | 'swr'
  | 'derived';

export interface EndpointMeta {
  method: string;
  path: string;
  freshness: FreshnessClass;
  ttl_s?: number;
  revalidate_on?: string[];
  transport?: 'sse';
  transport_topics?: string[];
}

export type EndpointKey = string; // "GET /api/lifecycle"

export function endpointKey(method: string, path: string): EndpointKey {
  return `${method.toUpperCase()} ${path}`;
}

export type QueryParams = Record<string, string | number>;

export interface RouterAdapters {
  /** Performs a one-shot fetch. Resolves with parsed JSON or rejects.
   *  `params` is the current subscriber-supplied query string, if any. */
  fetchJson: (method: string, path: string, params?: QueryParams) => Promise<unknown>;
  /** Returns current monotonic time in ms. Override in tests. */
  now: () => number;
  /** Schedule a callback after `ms`. Returns a token cancellable via clearTimer. */
  setTimer: (cb: () => void, ms: number) => unknown;
  clearTimer: (token: unknown) => void;
  /** Optional logger for observability — called on every state change. */
  log?: (entry: RouterLogEntry) => void;
}

export interface RouterLogEntry {
  at: number;
  endpoint: EndpointKey;
  event:
    | 'subscribe'
    | 'unsubscribe'
    | 'visibility-change'
    | 'host-visibility-change'
    | 'fetch-start'
    | 'fetch-end'
    | 'fetch-error'
    | 'invalidate'
    | 'pause'
    | 'resume';
  detail?: Record<string, unknown>;
}

interface SubscriberRecord {
  id: string;
  visible: boolean;
  onUpdate?: (value: unknown) => void;
}

interface EndpointState {
  meta: EndpointMeta;
  subscribers: Map<string, SubscriberRecord>;
  lastFetchAt: number | null;
  lastValue: unknown;
  inflight: Promise<unknown> | null;
  timer: unknown;
  /** Last params used (or about to be used) for a fetch on this endpoint.
   *  Latest subscribe() with params wins; cache invalidates on change. */
  currentParams?: QueryParams;
}

function paramsEqual(a?: QueryParams, b?: QueryParams): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (String(a[k]) !== String(b[k])) return false;
  return true;
}

export interface RouterStatus {
  endpoint: EndpointKey;
  freshness: FreshnessClass;
  ttl_s: number | null;
  visibleSubscribers: number;
  hiddenSubscribers: number;
  hostVisible: boolean;
  lastFetchAt: number | null;
  nextFetchAt: number | null;
  active: boolean;
}

export class FreshnessRouter {
  private endpoints = new Map<EndpointKey, EndpointState>();
  private hostVisible = true;
  private adapters: RouterAdapters;

  constructor(adapters: RouterAdapters) {
    this.adapters = adapters;
  }

  /** Register endpoint metadata from /api/_meta. Idempotent. */
  registerMeta(meta: EndpointMeta): void {
    const key = endpointKey(meta.method, meta.path);
    const existing = this.endpoints.get(key);
    if (existing) {
      existing.meta = meta;
      return;
    }
    const next: EndpointState = {
      meta,
      subscribers: new Map(),
      lastFetchAt: null,
      lastValue: undefined,
      inflight: null,
      timer: null,
    };
    this.endpoints.set(key, next);
  }

  /**
   * Subscribe a component to an endpoint.
   *
   * `onUpdate`, if provided, fires after every successful fetch with the
   * parsed value. Use it to drive view state in the subscriber. Callback
   * exceptions are isolated — one bad subscriber doesn't break others.
   * If the endpoint already has a cached value at subscribe time, the
   * callback fires once synchronously with that cached value so the
   * subscriber can render immediately without waiting for the next fetch.
   */
  subscribe(
    method: string,
    path: string,
    subscriberId: string,
    opts: { visible: boolean; onUpdate?: (value: unknown) => void; params?: QueryParams },
  ): void {
    const key = endpointKey(method, path);
    const ep = this.endpoints.get(key);
    if (!ep) {
      throw new Error(`FreshnessRouter: no meta registered for ${key}`);
    }
    // If the new subscriber supplies params and they differ from the
    // current ones, invalidate the cache — last writer wins. Designed for
    // single-active-subscriber endpoints (e.g. archive/sessions limit).
    const paramsChanged = opts.params !== undefined && !paramsEqual(ep.currentParams, opts.params);
    if (paramsChanged) {
      ep.currentParams = opts.params;
      ep.lastValue = undefined;
      ep.lastFetchAt = null;
    }
    const rec: SubscriberRecord = { id: subscriberId, visible: opts.visible };
    if (opts.onUpdate) rec.onUpdate = opts.onUpdate;
    ep.subscribers.set(subscriberId, rec);
    this.log(key, 'subscribe', { subscriberId, visible: opts.visible });
    if (opts.onUpdate && ep.lastValue !== undefined) {
      this.invokeOne(rec, ep.lastValue);
    }
    this.reconcile(key);
  }

  unsubscribe(method: string, path: string, subscriberId: string): void {
    const key = endpointKey(method, path);
    const ep = this.endpoints.get(key);
    if (!ep) return;
    ep.subscribers.delete(subscriberId);
    this.log(key, 'unsubscribe', { subscriberId });
    this.reconcile(key);
  }

  /** Update a subscriber's visibility (component scrolled, tab moved, etc). */
  setSubscriberVisible(subscriberId: string, visible: boolean): void {
    for (const [key, ep] of this.endpoints) {
      const rec = ep.subscribers.get(subscriberId);
      if (rec && rec.visible !== visible) {
        rec.visible = visible;
        this.log(key, 'visibility-change', { subscriberId, visible });
        this.reconcile(key);
      }
    }
  }

  /** Update the host visibility (browser tab / iframe host). */
  setHostVisible(visible: boolean): void {
    if (this.hostVisible === visible) return;
    this.hostVisible = visible;
    for (const key of this.endpoints.keys()) {
      this.log(key, 'host-visibility-change', { visible });
      this.reconcile(key);
    }
  }

  /**
   * Apply revalidate_on for an action. Call after a successful POST.
   * Endpoints whose meta lists `${METHOD} ${path}` in revalidate_on
   * will be refetched if currently active.
   */
  invalidateByAction(actionMethod: string, actionPath: string): void {
    const action = endpointKey(actionMethod, actionPath);
    for (const [key, ep] of this.endpoints) {
      const triggers = ep.meta.revalidate_on ?? [];
      if (!triggers.includes(action)) continue;
      this.log(key, 'invalidate', { action });
      if (this.isActive(key)) {
        void this.runFetch(key);
      }
    }
  }

  /** Read current cached value for an endpoint, if any. */
  getCached(method: string, path: string): unknown {
    const ep = this.endpoints.get(endpointKey(method, path));
    return ep?.lastValue;
  }

  /** Snapshot router state for the Dev-tab Freshness map. */
  status(): RouterStatus[] {
    const out: RouterStatus[] = [];
    for (const [key, ep] of this.endpoints) {
      const visible = this.countVisible(ep);
      const hidden = ep.subscribers.size - visible;
      out.push({
        endpoint: key,
        freshness: ep.meta.freshness,
        ttl_s: ep.meta.ttl_s ?? null,
        visibleSubscribers: visible,
        hiddenSubscribers: hidden,
        hostVisible: this.hostVisible,
        lastFetchAt: ep.lastFetchAt,
        nextFetchAt: this.nextFetchAt(ep),
        active: this.isActive(key),
      });
    }
    return out;
  }

  /** Tear down all timers. Call on app teardown / hot reload. */
  dispose(): void {
    for (const ep of this.endpoints.values()) {
      if (ep.timer != null) this.adapters.clearTimer(ep.timer);
      ep.timer = null;
    }
  }

  // --- internals ---

  private countVisible(ep: EndpointState): number {
    let n = 0;
    for (const s of ep.subscribers.values()) if (s.visible) n++;
    return n;
  }

  private isActive(key: EndpointKey): boolean {
    const ep = this.endpoints.get(key);
    if (!ep) return false;
    if (!this.hostVisible) return false;
    return this.countVisible(ep) > 0;
  }

  private nextFetchAt(ep: EndpointState): number | null {
    const ttl = ep.meta.ttl_s;
    if (!ttl) return null;
    if (!ep.lastFetchAt) return this.adapters.now();
    return ep.lastFetchAt + ttl * 1000;
  }

  private reconcile(key: EndpointKey): void {
    const ep = this.endpoints.get(key);
    if (!ep) return;
    const active = this.isActive(key);
    if (!active) {
      if (ep.timer != null) {
        this.adapters.clearTimer(ep.timer);
        ep.timer = null;
        this.log(key, 'pause');
      }
      return;
    }
    // Active. Decide what to do based on class.
    switch (ep.meta.freshness) {
      case 'bootstrap':
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case 'cold':
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case 'live':
        // SSE handled outside the router today; transport hookup is
        // FE-24 follow-up. Mark fetched-once so status() shows it.
        return;
      case 'on-action':
        // Only fetches via invalidateByAction. Initial fetch happens
        // on first subscribe (so the panel has data to show).
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case 'derived':
        return;
      case 'warm':
      case 'swr': {
        const ttl = ep.meta.ttl_s ?? 30;
        const due = ep.lastFetchAt == null
          ? 0
          : Math.max(0, ep.lastFetchAt + ttl * 1000 - this.adapters.now());
        if (ep.timer != null) this.adapters.clearTimer(ep.timer);
        ep.timer = this.adapters.setTimer(() => {
          ep.timer = null;
          if (this.isActive(key)) {
            void this.runFetch(key).then(() => this.reconcile(key));
          }
        }, due);
        if (!ep.lastFetchAt) {
          this.log(key, 'resume');
        }
        return;
      }
    }
  }

  private async runFetch(key: EndpointKey): Promise<unknown> {
    const ep = this.endpoints.get(key);
    if (!ep) return undefined;
    if (ep.inflight) return ep.inflight;
    this.log(key, 'fetch-start');
    const promise = this.adapters
      .fetchJson(ep.meta.method, ep.meta.path, ep.currentParams)
      .then((value) => {
        ep.lastValue = value;
        ep.lastFetchAt = this.adapters.now();
        ep.inflight = null;
        this.log(key, 'fetch-end');
        for (const sub of ep.subscribers.values()) this.invokeOne(sub, value);
        return value;
      })
      .catch((err: unknown) => {
        ep.inflight = null;
        this.log(key, 'fetch-error', { message: err instanceof Error ? err.message : String(err) });
        throw err;
      });
    ep.inflight = promise;
    return promise;
  }

  private invokeOne(sub: SubscriberRecord, value: unknown): void {
    if (!sub.onUpdate) return;
    try {
      sub.onUpdate(value);
    } catch (err) {
      this.adapters.log?.({
        at: this.adapters.now(),
        endpoint: '',
        event: 'fetch-error',
        detail: {
          subscriberId: sub.id,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private log(endpoint: EndpointKey, event: RouterLogEntry['event'], detail?: Record<string, unknown>): void {
    if (!this.adapters.log) return;
    const entry: RouterLogEntry = { at: this.adapters.now(), endpoint, event };
    if (detail !== undefined) entry.detail = detail;
    this.adapters.log(entry);
  }
}
