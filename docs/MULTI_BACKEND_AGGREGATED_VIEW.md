# Multi-Backend Aggregated View — Design Doc

> Status: design only — no implementation yet.
>
> Goal: capture the architectural changes needed to evolve the dashboard
> from "talks to one backend at a time" to "shows all paired backends
> in one unified view." Captures decisions, refactors, risks, and a
> phased path to get there without breaking the current single-backend
> flow.

## Table of Contents

1. [Vision & motivation](#1-vision--motivation)
2. [Current state (Level 0)](#2-current-state-level-0)
3. [Target state (Level 3)](#3-target-state-level-3)
4. [Architectural deltas](#4-architectural-deltas)
5. [Per-subsystem refactors](#5-per-subsystem-refactors)
6. [Migration phasing (L0 → L1 → L2 → L3)](#6-migration-phasing-l0--l1--l2--l3)
7. [Performance & resource model](#7-performance--resource-model)
8. [Authentication interaction](#8-authentication-interaction)
9. [Edge cases & open questions](#9-edge-cases--open-questions)
10. [Concrete file-level impact map](#10-concrete-file-level-impact-map)
11. [Acceptance criteria](#11-acceptance-criteria)

---

## 1. Vision & motivation

### The user-visible target

```
                ┌──────── Dashboard (single page) ────────┐
                │                                          │
                │  All Downloads (across 3 backends)       │
                │  ┌──────────────────────────────────┐  │
                │  │ ubuntu.iso  [NAS-Bonomani]  45MB/s │ │
                │  │ linux.iso   [Pote-NAS]      12MB/s │ │
                │  │ win.iso     [Maman-PC]      ⏸ pause│ │
                │  │ debian.iso  [NAS-Bonomani]  ✓ done │ │
                │  └──────────────────────────────────┘  │
                │                                          │
                │  Aggregate metrics:                      │
                │   ↓ 75 MB/s    ↑ 12 MB/s                 │
                │   13 active · 47 done · 2.4 TB used      │
                │                                          │
                │  Filter by: [All ▼] [✓Active] [✓Done]    │
                │                                          │
                └──────────────────────────────────────────┘
```

One UI, N backends, unified data model.

### Why this matters

Selfhost reality with multiple backends today (single-backend mode):

```
"Did mom's NAS finish her movie download?"
  → switch dropdown to maman-pc
  → wait for SSE reconnect (~2s)
  → look at Downloads tab
  → switch back to my NAS
  → wait for SSE reconnect again
```

Multi-backend reality:

```
"Did mom's NAS finish?"
  → glance at the unified Downloads list, filter "[Maman-PC]"
  → done in 1 second
```

For 2-3 backends this is a quality-of-life improvement. For 5+ it becomes
essential — context-switching between dropdowns is hostile to actual
operational work.

### Use cases that drive Level 3

Listed in priority order:

1. **Family fleet at a glance** — see which of {your NAS, mom's, dad's,
   friend's} are healthy without clicking through.
2. **Aggregate download history** — search for "where did I download X?"
   across all your machines without remembering which one.
3. **Cross-backend ops** — move a torrent from one NAS to another
   without 4 clicks.
4. **Quota / storage decisions** — "Which backend has free space for
   this 100 GB ISO?" requires aggregate visibility.
5. **Failover** — when one backend is down, you instantly see what
   activity moved (or didn't) to the others.

### Use cases that DON'T drive this

- Single-user, single-NAS setup → Level 0 is fine, no need to evolve.
- Detailed inspection / debug of a specific backend → Level 0 single-
  backend view is actually clearer for that.
- Performance-critical environments → multiple SSE + multi-backend
  aggregation has overhead; single backend stays leaner.

The design intentionally **keeps Level 0 fully functional** alongside
Level 3 (toggle between unified and focus modes).

---

## 2. Current state (Level 0)

### How it works today

```
Browser (TS bundle)
   │
   │  selectedBackend = single URL
   │
   ▼
┌─────────────────────────────────────┐
│  Single SSE connection              │
│  All HTTP fetches go to selected    │
│  All Alpine state mirrors selected  │
│  FreshnessRouter manages 1 backend  │
└─────────────────────────────────────┘
```

### State shape (Alpine `data()`)

```typescript
{
  selectedBackend: 'http://192.168.1.10:8000',
  backends: ['http://...', 'http://...'],

  downloads: [...],          // ← from selectedBackend only
  scheduler: {...},
  declaration: {...},
  lifecycle: {...},
  bandwidth: {...},
  // ... all single-backend
}
```

### Switching backend today

```typescript
selectBackend(backend) {
  saveBackendState(...)
  this._closeSSE()
  this._initSSE()           // ← reconnects to new backend
  this.deferRefresh(0)      // ← forces re-fetch of everything
}
```

Cost of a switch: ~1-3 seconds for SSE reconnection + initial polls.
Acceptable for occasional switches; painful at "5 times a minute" rate.

---

## 3. Target state (Level 3)

### How it works in Level 3

```
Browser (TS bundle)
   │
   │  watchedBackends = N URLs (subset of paired)
   │  primaryBackend = optional focus for detail views
   │
   ▼
┌─────────────────────────────────────┐
│  N SSE connections (one per backend)│
│  Per-backend state cache:           │
│    state[url].downloads             │
│    state[url].scheduler             │
│    ...                              │
│  Aggregate views compute on top     │
│  Action targets resolved per item   │
└─────────────────────────────────────┘
```

### State shape (Level 3)

```typescript
{
  watchedBackends: Set<string>,         // explicit subscription set
  primaryBackend: string | null,         // for detail views (optional)
  viewMode: 'aggregated' | 'focus',      // toggle between L3 and L0

  // Per-backend state cache:
  backendState: {
    'http://nas-bonomani:8000': {
      reachable: true,
      lastSeen: 1746540000,
      downloads: [...],
      scheduler: {...},
      declaration: {...},
      lifecycle: {...},
      bandwidth: {...},
      version: { server, aria2, dashboard },
      sseHandle: SSEConnection,
    },
    'http://maman-pc:8000': { ... },
    'http://pote-nas:8000': { ... },
  },

  // Computed aggregate views (memoized):
  get allDownloads(): { item, backendUrl, backendName }[] { ... },
  get aggregateBandwidth(): { down: number, up: number } { ... },
  get aggregateStats(): { active, done, paused, error } { ... },
}
```

### Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Persist watched set | Yes, in localStorage | Survives refresh; user expects continuity |
| Default watched set | All paired backends | Most users want all visible by default |
| Max watched | 10 (soft warning at 5) | Performance ceiling for casual users |
| Action targeting | Item carries its `backendUrl` | No ambiguity — action goes to that item's source |
| Composite IDs | `${backendUrl}#${gid}` for routing | aria2 gids are unique per backend, not globally |
| Search scope | Default cross-backend | Aggregate is the whole point |
| Sort default | By backend, then by status | Group naturally; user can change |

---

## 4. Architectural deltas

The path from L0 to L3 touches every layer. Listed in dependency order
(top of the stack first, bottom last):

### 4.1 UI layer (HTML fragments + Alpine bindings)

**Today**: every `tab_*.html` fragment iterates over Alpine state arrays
that are scoped to a single backend implicitly.

**L3**: every iterable item must carry its backend identity, and every
template must show it (badge, color-coded, or column).

```html
<!-- Today: -->
<template x-for="item in downloads">
  <tr>
    <td x-text="item.name"></td>
    <td x-text="item.size"></td>
  </tr>
</template>

<!-- L3: -->
<template x-for="item in allDownloads">
  <tr>
    <td>
      <span class="backend-badge"
            :style="`background:${item.backendColor}`"
            x-text="item.backendName"></span>
    </td>
    <td x-text="item.name"></td>
    <td x-text="item.size"></td>
  </tr>
</template>
```

### 4.2 State layer (`Alpine.data` shape)

**Today**: flat keys (`downloads`, `scheduler`, ...) reference current
backend's data implicitly.

**L3**: nested under `backendState[url]`, plus computed getters that
flatten across watched URLs.

This is the **biggest refactor** — every place in `app.ts` that reads
`this.downloads` etc. must either:
- (a) Read from `this.backendState[primaryBackend].downloads` (focus mode), or
- (b) Read from `this.allDownloads` (aggregate getter).

Many places need to know about both modes; some only ever need one.

### 4.3 SSE layer (event-driven freshness)

**Today**: single SSE connection in `_initSSE()` listens to events from
selectedBackend and updates state.

**L3**: dictionary of SSE connections, each routing events to its
backend's state slice.

```typescript
// L3 sketch
private _sseHandles = new Map<string, EventSource>();

_attachBackend(url: string) {
  if (this._sseHandles.has(url)) return;
  const es = new EventSource(`${url}/api/events`);
  es.addEventListener('state_changed', (ev) => {
    this._applyEvent(url, JSON.parse(ev.data));
  });
  // ... other events
  this._sseHandles.set(url, es);
}

_detachBackend(url: string) {
  this._sseHandles.get(url)?.close();
  this._sseHandles.delete(url);
}
```

Watched-set changes (user adds/removes a backend from watch list)
trigger attach/detach.

### 4.4 FreshnessRouter (subscription / TAB_MOUNT_HOOK)

**Today**: subscriptions are global — `subscribe('GET /api/downloads')`
fetches from selectedBackend.

**L3**: subscriptions become URL-aware:

```typescript
// L3 API
subscribe({ backendUrl, method: 'GET', path: '/api/downloads', apply: ... })
```

The router maintains per-backend subscription lists and dispatches
HTTP fetches with the right base URL. Most consumers (`app.ts` boot
code) become loops over watched backends.

### 4.5 Action handlers (mutations)

**Today**: `pauseItem(gid)` calls `POST ${selectedBackend}/api/downloads/${gid}/pause`.

**L3**: every mutation function takes the item (or item's backend URL):

```typescript
pauseItem(item) {
  return fetch(`${item.backendUrl}/api/downloads/${item.gid}/pause`, ...);
}
```

This is mechanically simple but pervasive — every action handler in
`app.ts` (~30+ functions) needs the item to carry its backend.

### 4.6 Add Download dialog

**Today**: "Add download" implicitly targets selectedBackend.

**L3**: requires a backend picker:

```
[+ Add download]
  URL: [_______________]
  Target backend: [NAS-Bonomani ▼]
  Output dir:    [/Downloads]
  [Add]
```

Or smarter: auto-pick the backend with most free space / least active.

---

## 5. Per-subsystem refactors

### 5.1 Downloads

```
Today:        downloads: Item[]
L3:           backendState[url].downloads: Item[]
              + get allDownloads(): {item, backendUrl, backendName}[]
```

**Sort/filter logic** must be re-implemented to work over the flattened
list. Filters (status, queue) work the same way; new filter dimension
"backend" appears.

**Search** queries the aggregate.

**Item ID rendering** needs the backend prefix to be visible (badge or
column).

### 5.2 Scheduler

```
Today:        scheduler: { state, ... }
L3:           backendState[url].scheduler
              No global aggregate makes sense — scheduler is per-backend
```

Display: a small "scheduler status per backend" panel showing
running/paused/stopped × N. No unified action ("start all schedulers")
beyond "for each watched backend, dispatch start" — could be useful as
a bulk action.

### 5.3 Declaration (preferences)

```
Today:        declaration: { ... }
L3:           backendState[url].declaration
              No aggregate — preferences are per-backend
```

The Declaration tab in L3 must let you pick **which** backend's prefs
to view. Probably a dropdown at the top of the tab. Or split into
N collapsible panels (one per backend).

### 5.4 Lifecycle

```
Today:        lifecycle: { server, aria2, dashboard }
L3:           backendState[url].lifecycle
              Aggregate view: All Backends overview (Level 1 stays useful)
```

The Lifecycle tab in L3 is essentially the Level 1 status grid + ability
to drill into a specific backend's lifecycle for actions.

### 5.5 Bandwidth

```
Today:        bandwidth: { down, up, ... }
L3:           backendState[url].bandwidth
              + get aggregateBandwidth(): { downSum, upSum, perBackend: ... }
```

The bandwidth chart in L3 could either:
- Stack lines (one per backend, stacked area chart)
- Sum (total throughput, single line)
- Toggle between

Recommend: stacked area chart with optional "show per-backend lines"
toggle.

### 5.6 Action log / activity

```
Today:        activity: Action[]
L3:           backendState[url].activity[]
              + get aggregateActivity(): { ...Action, backendUrl }[]
```

Aggregate activity feed is one of the **highest-value L3 features** —
seeing all events from all backends in chronological order makes
debugging across the fleet trivial.

Key challenge: clock skew. Events from different backends might have
slightly different timestamps. Sort by event timestamp, not arrival
order at the dashboard.

### 5.7 Sessions / files / aria2 options / etc.

All similar pattern: per-backend state cache + optional aggregate getter.

---

## 6. Migration phasing (L0 → L1 → L2 → L3)

### Phase A — Level 1 (status grid only) — ~3 days

**Scope**: a new tab "All Backends" that shows a status card per
watched backend. Read-only summary. No action bar.

**Why first**: zero refactor of existing code paths. Pure addition.
Validates the multi-backend polling pattern in isolation.

**State added**:
```typescript
{
  backendsOverview: { [url]: { reachable, version, activeCount, freeBytes, lastSeen } }
}
```

**Polling**: `Promise.allSettled` over watched URLs every 30s, calling
`/api/health` + `/api/status`. 3s timeout per backend.

**Deliverable**: a single new tab. Existing dropdown switching still
the only way to "go to" a specific backend.

### Phase B — Level 2 prerequisites: per-backend state factoring — ~5 days

**Scope**: refactor `app.ts` Alpine state from flat to nested
`backendState[url]`. Keep behavior identical (always show
selectedBackend's data).

**Why before L3**: this is the gnarly refactor. Doing it under L0
behavior (single backend stays primary) lets us catch regressions
without UX changes confusing the picture.

**Deliverable**: same UX as today, but state is now per-backend
internally. Aggregate getters return single-backend data (since only
one backend is watched).

**Risks**: 30+ `this.downloads` references etc. become
`this.backendState[this.selectedBackend].downloads`. Easy to miss one.

**Mitigation**: incremental — do one subsystem at a time
(downloads first, then scheduler, then ...). Each subsystem is a
separate PR.

### Phase C — Level 2 (multi-backend tabs / focus switching) — ~5 days

**Scope**: enable watching N backends simultaneously. Each backend
maintains its own SSE connection and state. UI lets you switch
between them via a "primary" tab strip.

**State added**:
```typescript
{
  watchedBackends: Set<string>,     // localStorage
  primaryBackend: string,            // which is currently focused
  // backendState[url] for each watched
}
```

**SSE management**:
- `attachBackend(url)` opens SSE, dispatches events to state slice
- `detachBackend(url)` closes SSE, cleans up
- Watch-set change in UI triggers attach/detach

**UI**: tab strip near header showing watched backends as tabs.
Clicking a tab sets `primaryBackend`.

**Behavior**: same single-backend UX as L0/L1, but the user can
"prepare" multiple backends in the background. Switching is now
instant (no SSE reconnect) because the connection is already live.

### Phase D — Level 3 (aggregate views) — ~5 days

**Scope**: introduce aggregate getters and new aggregate-aware
templates. Add `viewMode` toggle (`aggregated` vs `focus`).

**State added**:
```typescript
{
  viewMode: 'aggregated' | 'focus',    // localStorage
}
```

**Aggregate getters**: `allDownloads`, `aggregateBandwidth`,
`aggregateActivity`, etc.

**Templates**: dual-mode — every tab supports both views, switched
via `viewMode` getter.

**Action targeting**: every action handler reads `item.backendUrl`
explicitly. The "Add download" dialog gets a backend picker.

**Deliverable**: complete Level 3 — single page shows all backends
unified, with focus mode available as a fallback.

### Phase summary

| Phase | Scope | Days | Independently shippable? |
|---|---|:-:|:-:|
| A | Level 1 (status grid) | 3 | ✅ |
| B | State factoring (no UX change) | 5 | ✅ (transparent) |
| C | Level 2 (multi-tab focus) | 5 | ✅ |
| D | Level 3 (aggregate) | 5 | ✅ |
| **Total** | **L0 → L3** | **~18 days** | — |

Each phase is independently shippable. We can stop at any phase if the
ROI of the next isn't compelling.

---

## 7. Performance & resource model

### Network

| N watched | Total fetches/30s baseline | SSE connections | RAM cost (state) |
|---|:-:|:-:|:-:|
| 1 (today) | ~10 | 1 | ~5 MB |
| 3 | ~30 | 3 | ~15 MB |
| 5 | ~50 | 5 | ~25 MB |
| 10 | ~100 | 10 | ~50 MB |

For LAN-scale (≤10), this is comfortable. For 50+, we'd need:
- Push-based notifications (not implemented)
- Coalesced batch endpoints (`/api/multi-status` querying multiple
  backends in one shot)
- Lazy attachment (only watch backends with their UI tabs visible)

### Polling vs SSE

For the **status grid** (L1) polling is fine — 30s cadence, 10s timeout,
~1KB per response.

For the **aggregate downloads** (L3), SSE is required — without it,
bandwidth shown would lag by 30s, useless for an "active downloads"
panel.

### Browser limits

Chrome has a hard limit of ~6 concurrent connections per origin. SSE
connections count. With 6 backends watched, the dashboard nears this
limit and additional fetches start queueing.

**Mitigation**: each backend is a different origin (different IP/port)
so the per-origin limit applies independently. We're safe up to ~30+
backends per origin.

### CPU cost

The aggregate getters (`allDownloads`, `aggregateBandwidth`) are O(N)
in items. With 1000 active downloads across 5 backends, sort + filter
runs in ~50ms in modern browsers. Acceptable.

For 10000+ items: virtualized lists (only render visible rows).

---

## 8. Authentication interaction

### Current state (single backend)

The dashboard talks to `selectedBackend` over plain HTTP within the LAN.
No per-backend authentication — it's an unauthenticated API right now.

### After multi-device pairing (when shipped, see MULTI_DEVICE_AUTH_DESIGN.md)

Each backend has its own `device_token`. The dashboard's
`peers.json` will store `{ backend_url, device_token }` per pairing.

Multi-backend monitoring at L3 implies:
- Each fetch / SSE attaches the right `Authorization: Bearer <token>`
  header for its target backend
- `peers.json` is the source of truth for which backends we have
  tokens for
- The watched-backends set is a subset of paired backends (you can't
  watch unpaired ones)
- New invitations bring up a backend in the watched set automatically
- Revoking your access means removing the entry from `peers.json` AND
  from the watched set

### Cross-cutting auth concerns at L3

- **Action button enabled?** Depends on the role granted on that
  specific backend. Item from a guest-role backend has limited actions.
- **Aggregate "pause all"** must skip backends where you don't have
  pause permission.
- **Audit log** shows the action with the backend identity, not the
  dashboard's identity (you're acting on the remote backend).

---

## 9. Edge cases & open questions

### 9.1 Same item, different backends?
A torrent could be downloaded on multiple backends simultaneously
(e.g. you started it on yours, then on a NAS for redundancy). They'll
have different gids but same name + magnet/info-hash.

**Decision**: show them as separate items. Optional future enhancement:
group by info-hash with sub-rows showing each backend's progress.

### 9.2 Clock skew across backends
Backends may have wall clocks that differ by minutes. Aggregate
chronological views (activity log) get reordered.

**Decision**: trust each backend's own timestamps. Tolerate up to
~1 min skew; if more, show a warning badge. Don't try to correct
client-side.

### 9.3 Backend goes offline mid-session
SSE connection dies. The dashboard:
- Marks the backend as `unreachable` in `backendsOverview`
- Stops aggregating its data into views (data goes stale, not zero)
- Shows a "stale" indicator on items from that backend
- Auto-reconnects the SSE every ~30s

User explicitly removes the backend from watched set → state for that
URL is freed.

### 9.4 Watched set mismatch with paired set
User pairs 5 backends but only watches 3. The 2 unwatched are still
listed as "paired" but no SSE / no state. They appear in the dropdown
to switch focus mode, just don't contribute to aggregates.

### 9.5 Add download with no specific backend
Default behavior: route to current `primaryBackend`.
Alternative: smart routing — pick the backend with most free space.
Alternative: prompt user to choose.

**Decision**: default to primaryBackend, expose smart routing as a
Settings checkbox.

### 9.6 Simultaneous lifecycle ops on multiple backends
"Update all backends" — sequential or parallel?

**Decision**: parallel with rate limit (max 3 concurrent updates).
Operator confirms before bulk operation. Each result reported
individually. No cross-backend transactions (one fails, others
proceed).

### 9.7 What about Windows / mobile dashboards?
Multi-backend doubles down on memory + connection count. On older
devices or mobile, watching 10 backends may struggle.

**Decision**: detect device class via `navigator.deviceMemory` / UA;
on low-memory devices, default watched set to size 1 (current backend
only) and show a warning when adding more.

### 9.8 Data export across backends
"Export all my downloads to CSV" — needs aggregation logic.

**Decision**: defer. Export per-backend only in the first L3 release.

### 9.9 Migration from L0 user state
Operators with bookmarks like `?backend=X` should still work.
LocalStorage state from L0 (`backends`, `selectedBackend`,
`backendMeta`) all stays valid; new keys are added (`watchedBackends`,
`primaryBackend`, `viewMode`) with defaults that mimic L0 behavior.

**Decision**: at first L3 launch, `watchedBackends = {selectedBackend}`,
`viewMode = 'focus'`. Existing user sees no change. They opt into
aggregate via the toggle.

### 9.10 What happens when a backend's auth is revoked?
SSE returns 401. The dashboard:
- Closes the SSE
- Marks backend as `auth_failed`
- Shows recovery banner: "Re-pair this backend"
- Removes from watched set after operator dismisses the banner
  (or auto after 24h?)

---

## 10. Concrete file-level impact map

### Files added

| File | Purpose | Phase |
|---|---|:-:|
| `static/_fragments/tab_all_backends.html` | Status grid UI | A |
| `static/ts/multi_backend.ts` | Watched-set logic, attach/detach helpers | C |
| `static/ts/aggregate.ts` | All `aggregateX` getters, pure functions | D |
| `static/ts/aggregate.test.ts` | Tests for aggregate getters | D |
| `tests/test_multi_backend.py` | Backend-side smoke for /api/health × N | A |

### Files heavily modified

| File | What changes | Phase |
|---|---|---|
| `static/ts/app.ts` | State shape: flat → nested per-backend; Alpine getters; action handlers | B/C/D |
| `static/ts/freshness.ts` | Subscriptions become URL-aware | C |
| `static/ts/freshness-bootstrap.ts` | Boot loop iterates over watched backends | C |
| `static/_fragments/tab_downloads.html` | Backend badge column; backend filter | D |
| `static/_fragments/tab_lifecycle.html` | Per-backend rows replicated | D |
| `static/_fragments/tab_options.html` | Per-backend selector at top | C |
| `static/_fragments/tab_activity.html` | Backend column; cross-backend ordering | D |
| `static/_fragments/header.html` | Tab strip for primaryBackend; viewMode toggle | C/D |
| `webapp.py` | Multi-backend metadata helpers (overview API?) | A |

### Files lightly modified

| File | What changes | Phase |
|---|---|---|
| `static/ts/storage.ts` | New keys: watchedBackends, primaryBackend, viewMode | C |
| `static/ts/backend.ts` | discoverBackends now adds to watched (configurable) | C |
| `auto_update.py` | Backend-aware orchestration | C |
| `install_self.py` | Multi-backend lifecycle dispatch | C |
| `docs/UPDATE_PROCESSES.md` | Note about per-backend update orchestration | C |

### Files unaffected

- `bonjour.py` — discovery still finds all backends, watched-set is
  separate concern
- `sigstore_verify.py` — verification is per-backend, current shape works
- `action_log.py` — local audit, no change

---

## 11. Acceptance criteria

### Phase A (Level 1 status grid)
- [ ] New "All Backends" tab visible in nav
- [ ] Card per watched backend: name, version triple, reachable/unreachable, active count, free bytes, last-seen
- [ ] Polling every 30s, 3s timeout per backend, parallel
- [ ] Click "Switch to this" navigates focus mode to that backend
- [ ] Click "Recover" on unreachable card calls bootstrap endpoint
- [ ] No regression in existing single-backend UX

### Phase B (state factoring, no UX change)
- [ ] All `this.downloads` etc. now go through `this.backendState[url]`
- [ ] `data` shape change documented in `freshness.ts` comments
- [ ] All existing tests still green
- [ ] No new tests required (refactor preserves behavior)
- [ ] Performance benchmark unchanged ±5%

### Phase C (Level 2 multi-tab focus)
- [ ] Watched-set persisted in localStorage
- [ ] N SSE connections concurrently
- [ ] Tab strip in header with paired backends, click to set primary
- [ ] Action handlers always target the item's `backendUrl`
- [ ] Memory profile reasonable (~5MB per watched backend)
- [ ] Connection count never exceeds (watched × 1) for SSE

### Phase D (Level 3 aggregate views)
- [ ] `viewMode` toggle visible (aggregated / focus)
- [ ] All Downloads tab: rows from all watched backends, backend badge visible
- [ ] Aggregate bandwidth chart (stacked or summed)
- [ ] Aggregate activity feed (chronological across backends)
- [ ] Cross-backend filter works (search, status, backend chip)
- [ ] Add Download dialog has backend picker
- [ ] All actions correctly target the item's source backend
- [ ] Documented operator guide: how to use aggregate vs focus

### Cross-phase
- [ ] No regression in 139 existing tests
- [ ] No regression in 214 existing TS tests
- [ ] make verify still green
- [ ] CI pipeline unchanged
- [ ] Operator can roll back to single-backend mode by setting `viewMode: focus`

---

## 12. Implementation plan — day by day

Concrete day-by-day breakdown for the ~18 days estimated. Each day
ends with a runnable artifact (no dangling refactors over weekends).
Days are sized to land + verify before close-of-day.

### Phase A — Level 1 status grid (3 days, independently shippable)

#### Day A1 — Polling helper + multi-backend config
- New file `static/ts/multi_backend.ts` with skeleton:
  ```typescript
  export interface BackendOverview {
    url: string;
    name: string;
    reachable: boolean;
    error?: string;
    health?: { status, uptime_seconds };
    versions?: { server, aria2, dashboard };
    activeCount?: number;
    freeBytes?: number;
    lastSeen?: number;
  }
  export async function probeBackend(url: string, timeoutMs: number): Promise<BackendOverview>
  ```
- Implementation: `Promise.race` with timeout, `fetch` to `/api/health`
  + `/api/lifecycle`, parse, return.
- Tests: success, timeout, network error, malformed response.
- Storage key `ariaflow.watched_backends` (default = `[selectedBackend]`).
- **Deliverable**: helper module + 6 tests passing.

#### Day A2 — Status grid UI + overview state
- New fragment `static/_fragments/tab_all_backends.html`:
  - Card grid layout
  - Per-card: traffic-light icon, name, version triple, active/free, last-seen
  - Action row: [Switch] [Recover] [Update]
- New Alpine state:
  ```typescript
  backendsOverview: {} as Record<string, BackendOverview>
  ```
- Polling loop in `app.ts`: every 30s when "All Backends" tab is open,
  paused otherwise. Uses `multi_backend.probeBackend()` in parallel.
- Hooked into existing `TAB_MOUNT_HOOK['all-backends']`.
- Nav item added.
- **Deliverable**: tab visible, polls work, cards render with live data.

#### Day A3 — Wiring + polish + tests
- "Switch to this" reuses existing `selectBackend()`
- "Recover" calls existing `bootstrapAriaflowServer()`
- "Update" guards: only enabled if probe says update_available
- Loading skeletons during initial poll
- Documentation: short note in `docs/MULTI_BACKEND_AGGREGATED_VIEW.md`
  about Level 1 being shipped
- E2E test: open All Backends tab, see ≥1 card, click Switch, verify
  primaryBackend updated
- **Deliverable**: Level 1 fully shipped, regression-free.

### Phase B — State refactor (5 days, transparent)

This phase is the riskiest because it touches the heart of the dashboard
without giving the user any visible new feature. The constraint: at
end of each day, behavior is **identical** to start of day.

#### Day B1 — Introduce `backendState` slot, downloads only
- Add to Alpine data:
  ```typescript
  backendState: {} as Record<string, BackendStateSlot>,
  get _primaryState() { return this.backendState[this.selectedBackend] || {}; },
  ```
- Define `BackendStateSlot` interface (downloads + indexes only for now).
- Migrate **only downloads-related code**:
  - All places writing `this.downloads = ...` → `this._setBackendField('downloads', ...)`
  - All places reading `this.downloads` → `this._primaryState.downloads || []`
- Add a thin compat getter `get downloads()` returning `_primaryState.downloads`
  so HTML doesn't change yet.
- Tests: downloads still appear, search still works, filter still works.
- **Deliverable**: downloads internally per-backend, externally identical.

#### Day B2 — Migrate scheduler + declaration
- Same pattern as B1 for `scheduler` and `declaration` fields.
- Compat getters preserved.
- Tests: declaration tab still works, scheduler buttons still work.
- **Deliverable**: 3/N subsystems migrated.

#### Day B3 — Migrate lifecycle + bandwidth + sessions
- Same pattern. Lifecycle is interesting because there are 3 components
  (server/aria2/dashboard) that are always associated with one backend
  contextually. Per-backend slot has `lifecycle: { server, aria2, dashboard }`.
- **Deliverable**: 6/N subsystems migrated.

#### Day B4 — Migrate remaining (action_log, peers, files, torrents, options)
- Catch-all day for the long tail.
- Audit: grep for any remaining `this.<field>` not yet routed via
  `_primaryState`. Fix each.
- **Deliverable**: all subsystems migrated. Compat getters all in place.

#### Day B5 — Cleanup + perf check + tests
- Remove compat getters where the templates can be updated to read
  `_primaryState.X` directly (saves an indirection).
- Run perf benchmarks: refresh time, memory at idle, memory under load.
  Target: <±5% regression vs L0.
- Update internal docs.
- **Deliverable**: clean refactor, performance verified, all 139+214 tests green.

### Phase C — Level 2 (multi-tab focus) (5 days)

#### Day C1 — Watched-set state + persistence
- New Alpine state:
  ```typescript
  watchedBackends: ['DEFAULT_BACKEND_URL'],   // localStorage
  primaryBackend: this.selectedBackend,        // localStorage
  ```
- Helpers: `addToWatched(url)`, `removeFromWatched(url)`, `setPrimary(url)`.
- Storage keys + sanitization in `storage.ts`.
- Tests: persistence round-trips, can't watch unpaired.
- **Deliverable**: state and helpers in place; UI not changed yet.

#### Day C2 — Multi-SSE manager
- New module `static/ts/sse_manager.ts`:
  ```typescript
  attachBackend(url, dispatch)
  detachBackend(url)
  reconnectAllStale()
  ```
- Each SSE event dispatched to the right `backendState[url]` slice.
- Reconnect with exponential backoff per-backend.
- Tests: spinning up 3 mock SSE sources, verify state slices update
  independently.
- **Deliverable**: SSE manager unit-tested.

#### Day C3 — Wire SSE manager into Alpine boot
- `_initSSE()` becomes a loop over `watchedBackends`, calling
  `sseManager.attachBackend(url, ...)` for each.
- `selectBackend(url)` no longer reconnects SSE — it just changes
  `primaryBackend`. SSE for selectedBackend was already up.
- Switching focus mode is now near-instant.
- **Deliverable**: switch between watched backends has no observable
  reconnect delay.

#### Day C4 — Tab strip UI in header
- Header gets a tab strip showing each watched backend.
- Active tab = primaryBackend.
- Click tab → `setPrimary(url)`.
- Right-click tab → context menu: [Stop watching] [Update] [Restart] [Open Settings]
- Watched-set editor in Settings panel.
- **Deliverable**: tab strip works, switching is instant, watched-set editable.

#### Day C5 — FreshnessRouter URL-aware + cleanup
- `subscribe({ backendUrl, ... })` — router holds per-backend list.
- Boot loop: `for url in watchedBackends: subscribe each path for url`.
- Tests for routing logic.
- E2E: 3 watched backends, ensure all SSE alive, all polls firing
  with correct base URL.
- **Deliverable**: Level 2 complete and shippable.

### Phase D — Level 3 (aggregate view) (5 days)

#### Day D1 — Aggregate getters + view mode toggle
- New file `static/ts/aggregate.ts`:
  ```typescript
  export function flattenDownloads(states): { item, backendUrl, backendName }[]
  export function aggregateBandwidth(states): { down, up, perBackend }
  export function aggregateActivity(states): Action[]
  ```
- All pure functions, well-tested.
- New Alpine state: `viewMode: 'focus' | 'aggregated'`
- Toggle in header: focus / aggregate.
- **Deliverable**: aggregate getters working in unit tests; toggle persists.

#### Day D2 — Downloads tab: aggregate mode
- New `_fragments/tab_downloads.html` with dual-mode template:
  - When `viewMode === 'focus'`: existing per-backend rendering
  - When `viewMode === 'aggregated'`: rows from `allDownloads`,
    backend badge prefix
- Backend badge color: stable hash of URL → HSL
- Filter chip: "Backend [Any ▼]" filter
- Cross-backend search.
- **Deliverable**: aggregate downloads view live, switchable.

#### Day D3 — Lifecycle tab: aggregate (= status grid from Phase A) + bandwidth chart
- Lifecycle in aggregate mode = the All Backends tab from Phase A,
  promoted to first-class.
- Bandwidth tab gets stacked area chart with toggle:
  - Stacked (per-backend lines stacked)
  - Summed (single line, total throughput)
  - Per-backend (separate lines, no stacking)
- **Deliverable**: 2 more tabs aggregate-aware.

#### Day D4 — Activity feed + Add Download dialog
- Aggregate activity: cross-backend chronological feed.
  Backend badge per entry. Filter by backend.
- Add Download dialog: backend picker dropdown.
  Default: primaryBackend. Smart routing as toggle.
- **Deliverable**: aggregate activity + add-download work.

#### Day D5 — Final polish + comprehensive tests + doc
- Backend filter UX (chip-style across all aggregate views).
- Operator guide: how to switch modes, what each shows.
- Comprehensive test pass: 139 Python + 214+ TS still green.
- Performance benchmark: aggregate view with 5 backends, 200 items,
  must render <300ms after data load.
- Update `MULTI_BACKEND_AGGREGATED_VIEW.md` to reflect shipped state.
- **Deliverable**: Level 3 complete, documented, shippable.

### Total
**18 days** for full L0 → L3. Phase boundaries are independently
shippable, so the project can stop at A, A+B+C, or full L3 based on
how the value delivered scales.

---

## 13. Problematic points analysis

The honest list of where this project will hurt, ranked by risk impact.

### 13.1 🔴 HIGH — `app.ts` state refactor (Phase B)

**Why painful**: ~30+ call sites read flat fields like `this.downloads`,
`this.scheduler`, `this.lifecycle`. Each must be re-routed without
breaking observers (Alpine's reactivity).

**What can go wrong**:
- Missed call site → stale data in some panel
- Compat getter loop (recursive read) → infinite render loop
- Reactivity misses → button states freeze
- Test coverage gaps → silent regressions in rarely-used flows

**Mitigation**:
- Migrate **one subsystem at a time**, run full tests between each
- Keep compat getters all the way through Phase B; remove only in B5
- Add a "diff snapshot" test: render the page in test, take a DOM
  snapshot, run after migration, diff. Catches almost-invisible
  regressions.
- Pair-review every migration commit (or at minimum self-review with
  fresh eyes the day after).

**Time risk**: real risk of B taking 7-8 days vs estimated 5.
Acceptable to extend.

---

### 13.2 🔴 HIGH — Reactivity cascade with `backendState[url]`

**Why painful**: Alpine's reactivity tracks property reads. Reading
`this.backendState[this.selectedBackend].downloads` triggers a chain:
- Property `selectedBackend` → reactive
- Property `backendState` → reactive
- Property `backendState[url]` → maybe reactive (depends on Alpine version)
- Property `.downloads` on that object → maybe reactive

If any link in the chain is non-reactive, updates won't propagate to
the DOM. Symptom: data updates internally but UI doesn't refresh.

**What can go wrong**:
- Updates to a backend's downloads not visible because Alpine doesn't
  observe nested objects deeply by default
- Manual `Alpine.reactive()` wrapping required, easy to forget
- Memory leaks from observers not cleaned up when a backend is unwatched

**Mitigation**:
- Use Alpine 3+ deep reactivity, audit by reading the docs first
- Replace nested objects with explicit setter methods:
  `setBackendField(url, 'downloads', items)` that triggers reactivity
  by reassigning the slot
- Add Alpine reactivity tests early — verify a synthetic state change
  propagates to the DOM in <1 frame
- Document the reactivity contract in `app.ts` header comment

---

### 13.3 🟠 HIGH-MEDIUM — Race conditions during backend switch

**Why painful**: today, switching backend reconnects SSE → there's a
clean cut between "old data" and "new data". L2/L3 keeps both alive,
so events from BOTH backends land in the state simultaneously. A
slow event from backend A could overwrite a fresher event from backend
B if not properly slotted.

**What can go wrong**:
- Events tagged with the wrong backend slot due to dispatch logic bug
- During SSE reconnect, missed events lead to stale state on one
  backend while another shows fresh
- "Latest event" timestamp confusion (clock skew + ordering)

**Mitigation**:
- Every SSE event handler must look up the dispatch slot by the SSE's
  origin URL (passed as closure), never by `selectedBackend`
- Each `BackendStateSlot` has a `lastEventAt` field; events with older
  timestamps are silently dropped (BG-style "freshness check")
- Integration tests with mocked multi-SSE injecting events out-of-order

---

### 13.4 🟠 MEDIUM — Browser connection limits with N SSE

**Why painful**: Chrome ~6 concurrent connections per origin. If user
watches 6+ backends on the same origin (unlikely — they'd all be on
same IP), SSE saturates and other fetches queue.

**What can go wrong**:
- 6 backends watched, all on same origin (LAN with reverse proxy?) →
  fetches stall behind SSE
- Operator confused why dashboard hangs

**Mitigation**:
- Most realistic case: each backend on its own IP/port → per-origin
  limit applies independently → safe to ~30 backends
- Detect the case where multiple watched backends share an origin →
  warning in UI: "Multiple backends behind same origin reduces
  responsiveness"
- Fallback: combine SSE into a multiplexed long-poll on a single
  connection (out-of-scope for L3, possible L4 work)

---

### 13.5 🟠 MEDIUM — Action targeting bugs in aggregate mode

**Why painful**: today, every action ("pause", "remove", "retry") sends
a request to `selectedBackend`. In aggregate mode, the action must go
to the **item's source backend**. Easy to write `fetch(this.backendPath('/api/...'))`
out of habit and target the wrong backend.

**What can go wrong**:
- Click "Pause" on an item from Maman-PC → request fires to your NAS →
  404 (item not found) or worse, pauses some other item with the same gid
- Bulk "Pause selected" must split by backend

**Mitigation**:
- Eliminate `this.backendPath` for item actions; require `item.backendUrl`
  always
- Type-check via an ESLint rule (or comment-based reviewer cue):
  "action handlers must accept item, not gid"
- Audit log shows `target_backend` for every action; mismatch =
  immediate red flag in tests
- Bulk operations split by backend explicitly: `groupBy(items, 'backendUrl')`,
  one HTTP call per backend group

---

### 13.6 🟠 MEDIUM — Auth divergence per backend

**Why painful**: when SPAKE2 pairing ships, each backend has its own
`device_token` stored in `peers.json`. Multi-backend means presenting
the right token to each backend on every request.

**What can go wrong**:
- Token mix-up: present backend B's token to backend A → 401
- Token expiry on one backend → only that backend's data goes stale,
  but error reporting doesn't make the cause obvious
- Token revocation: must remove from watched set + close SSE
- Different roles per backend: action button enabled/disabled
  inconsistently

**Mitigation**:
- Centralize token lookup: `getTokenForBackend(url)` reading peers.json
  via an injected helper
- Wrap fetch + SSE creation to always include the right
  `Authorization` header
- 401 handling: per-backend `auth_failed` state, recovery banner,
  optionally auto-detach from watched
- Test matrix: 3 backends × 4 role variants × 5 action types = 60
  scenarios. Pick 5-10 representative ones for explicit tests.

---

### 13.7 🟡 MEDIUM-LOW — Memory growth in long-lived sessions

**Why painful**: each watched backend's state slot grows over a session
(action log, completed downloads, history). With 5 backends × 24h
session × ~100 events/h = 12000 events accumulating.

**What can go wrong**:
- Browser tab memory grows, eventually slows down
- Aggregate views slow to render

**Mitigation**:
- Per-backend log capped at last 1000 entries (existing pattern)
- Aggregate getters memoized + invalidated on state change
- Periodic cleanup: backends unwatched for >X minutes have their slot
  freed
- Document expected steady-state memory in `MULTI_BACKEND_AGGREGATED_VIEW.md`

---

### 13.8 🟡 MEDIUM-LOW — Clock skew in aggregate activity feed

**Why painful**: chronological cross-backend feed depends on consistent
timestamps. Without NTP, two backends can drift by minutes.

**What can go wrong**:
- Events appear out-of-order in the unified feed
- "What happened first?" investigations get confusing
- "Last 5 minutes" filter excludes valid events from a backend with
  fast clock

**Mitigation**:
- Trust each backend's own clock; sort by event timestamp regardless
- Detect skew: if backend B's reported "now" is >60s off from local
  clock, show a warning badge on its card
- Don't try to correct client-side — that's a rabbit hole
- Operator can fix at source: enable NTP on each backend host

---

### 13.9 🟡 MEDIUM-LOW — UX confusion: focus vs aggregate

**Why painful**: two modes is one more than one. New operator opens
the dashboard in aggregate mode and sees data from 3 backends — does
"Pause" pause everything? They click; one item pauses; they're surprised
the others didn't.

**What can go wrong**:
- "Action target ambiguity" complaints
- Ops mistakes (wrong backend get an action)

**Mitigation**:
- Default to focus mode for first-time users; show a tooltip:
  "Try aggregate view to see all your backends at once"
- Strong visual cues: aggregate mode has visible backend badges everywhere
- Bulk action confirmation: "Pause 3 items across 2 backends?"
- Settings option: "Always confirm bulk actions in aggregate mode"

---

### 13.10 🟡 LOW — Test coverage explosion

**Why painful**: today's tests assume single backend. L3 ~doubles
relevant test surface (focus mode + aggregate mode for each subsystem).

**What can go wrong**:
- Test suite doubles in size; CI gets slow
- Bug only manifests in 1 mode, missed by single-mode tests

**Mitigation**:
- Parameterize tests over `viewMode` where it matters
- Most tests can stay single-mode (focus = backward compat)
- Add ~10 explicit aggregate-mode tests at strategic surfaces:
  downloads list, action handler, activity feed
- CI parallelism: run focus and aggregate test classes in parallel

---

### 13.11 🟡 LOW — Migration of existing user state

**Why painful**: existing operators have localStorage with current
schema. L3 introduces new keys. Smoke-testing the upgrade path is
needed.

**What can go wrong**:
- Operator with stale localStorage hits a JS error on page load
- Watched-set is empty, dashboard appears broken until they switch

**Mitigation**:
- All new keys default to legacy-compatible values:
  - `watchedBackends` defaults to `[selectedBackend]`
  - `viewMode` defaults to `'focus'`
- Add a one-time migration: on first L3 boot, populate `watchedBackends`
  from `backends + DEFAULT_BACKEND_URL`
- Test the migration on a synthetic "old user" state in unit tests

---

### 13.12 🟡 LOW — FreshnessRouter URL-aware refactor

**Why painful**: the FreshnessRouter (FE-24) was designed single-backend.
Subscriptions are global. L2 demands them per-backend.

**What can go wrong**:
- Subscriptions added before backend is attached are silently dropped
- Detaching a backend while subscriptions are pending creates leaks
- Boot order: subscriptions before SSE attachment vs after — both fail
  in different modes

**Mitigation**:
- Refactor subscriptions to take `{ backendUrl, ... }`
- Boot sequence: attach all watched backends first, then subscribe
  for each
- Tests: dynamic add/remove of backend from watched set, verify
  subscriptions reroute correctly

---

### 13.13 🟢 LOW — Backend availability badge spam

**Why painful**: in a session with intermittent network, the
"backend reachable" indicator could flap on/off, generating
notifications/audit entries.

**What can go wrong**:
- Status flip 3 times in a minute → 3 audit entries
- Visual flicker in the All Backends tab

**Mitigation**:
- Debounce status changes: require N consecutive failures before
  marking unreachable, N successes before marking reachable
- Audit log only on sustained state change

---

### 13.14 🟢 LOW — Bandwidth chart axis with N backends

**Why painful**: stacked area chart with 5 backends: 5 colors, 5
labels in legend, 5 lines to draw. Default chart libs handle this
fine, but the visual gets busy.

**Mitigation**:
- Limit visible per-backend lines to 5; aggregate the rest into "other"
- Color palette fixed: 7 distinguishable colors hardcoded
- Toggle: "show only top N by throughput"

---

### Summary of risks

| Risk | Phase | Rank | Effort to mitigate |
|---|:-:|:-:|---|
| State refactor regressions | B | HIGH | High (incremental migration + snapshot tests) |
| Reactivity cascade | B/C | HIGH | Medium (Alpine deep, explicit setters) |
| Race conditions during switch | C/D | HIGH-MED | Medium (timestamp-gated dispatch) |
| Browser connection limits | C | MED | Low (warning UI; rare) |
| Action targeting bugs | D | MED | Medium (linting + tests) |
| Auth divergence per backend | D | MED | Medium (centralized token lookup) |
| Memory growth | D | MED-LOW | Low (caps + cleanup) |
| Clock skew | D | MED-LOW | Low (warning + trust source) |
| UX confusion focus/aggregate | D | MED-LOW | Medium (defaults + confirmations) |
| Test coverage explosion | All | LOW | Medium (parameterized tests) |
| User state migration | C | LOW | Low (defaults + one-time migration) |
| FreshnessRouter refactor | C | LOW | Medium (URL-aware subscriptions) |
| Status flap | A/D | LOW | Low (debounce) |
| Chart visual clutter | D | LOW | Low (palette limits) |

**Aggregate verdict**: 2-3 HIGH risks, all in the state refactor zone
(Phase B) and the reactivity model. These are the success-or-failure
points of the whole effort. If we get B and the reactivity right, the
rest is engineering grind.

**Recommended risk-reduction approach**:
1. **Spike Phase B first** before committing to L3. Spend 2-3 days
   migrating just `downloads` end-to-end. If reactivity behaves +
   tests stay green, full B is feasible. If not, pivot to a different
   approach (e.g. multiple Alpine components with shared store).
2. **Don't build L3 without B's confidence**. Phase A (status grid) is
   safe to ship anytime; B/C/D are interdependent.
3. **Plan to extend B's estimate**. Honest budget: 7 days, not 5.
4. **Independent test environment** for the reactivity work. Catch
   regressions before they're merged.

---

## Appendix A — Comparison with prior art

| Tool | Multi-backend model | Notes |
|---|---|---|
| Sonarr/Radarr | Single-instance | Each instance is its own ecosystem. Cross-instance is a separate tool (Trash Guides, etc.) |
| Plex Web UI | Single server | Plex media server federation is server-side; client is single-server |
| qBittorrent Web UI | Single instance | No multi-instance UI |
| Tailscale admin console | Multi-device by design | Mesh-native; closer to L3 model conceptually |
| Grafana | Multi-datasource by design | Each panel can pull from different sources; ariaflow's dashboard would converge similarly at L3 |
| Home Assistant | Multi-device aggregate | Native multi-instance dashboards |

The reference for ariaflow's L3 aspiration is closer to **Tailscale +
Home Assistant** than to **Sonarr/Plex**: aggregate-by-default, with
focus mode as a power-user fallback.

## Appendix B — What we're explicitly NOT doing

- ❌ Server-side aggregation (a "meta-backend" that polls others)
  — adds infra, single point of failure, not needed for our scale
- ❌ Distributed transactions (atomic op across backends) — too complex,
  selfhost doesn't need it
- ❌ Cross-backend item migration UI (drag-drop a torrent between backends)
  — interesting but beyond Level 3 scope; possible Level 4
- ❌ Cluster mode (backends acting as a single fleet) — not the target
- ❌ Federated identity (sign in once, use all) — covered by per-backend
  pairing in MULTI_DEVICE_AUTH_DESIGN.md
- ❌ Real-time collaborative editing (two operators acting at once) —
  out of scope; existing event log handles audit
