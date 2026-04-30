# Freshness axis — a contract property for API endpoints

**Status:** Design note, 2026-04-30. Not yet implemented (tracked as BG-31 backend / paired frontend gap).
**Project:** ariaflow-dashboard / ariaflow-server
**Author context:** Emerged from the BG-30 state-machine cleanup — once download status was made canonical, the next class of drift surfaced was *temporal*: every endpoint was being treated as equally hot, so the SSE channel and the on-screen lifecycle row had the same effective refresh strategy as a streaming download.

## Problem

Most REST/JSON APIs leave **how often to refetch** entirely to the client. The contract describes the *shape* of the response (schema, types, error envelope) but not its *freshness semantics*. The client is then expected to either:

1. Poll on a hardcoded interval per endpoint (and pick a number out of a hat).
2. Subscribe to a single firehose stream and refetch everything on every tick.
3. Refetch on every user action that *might* have changed something.

All three lose. Strategy 1 wastes bandwidth on slow-moving data and is stale on fast-moving data. Strategy 2 is what we had before this design: a single SSE `state_changed` event triggered a full `/api/status` refetch even when only one item's progress had ticked, and lifecycle / bandwidth / options were all dragged along. Strategy 3 produces a tangled `if (action === X) refetch(Y, Z)` web that rots silently when new actions are added.

The missing piece is that **freshness class is part of the contract**, not a client guess.

## Proposal

Each endpoint declares its freshness class in a stable `meta` block:

```json
{
  "ok": true,
  "data": { /* ... */ },
  "meta": {
    "freshness": "warm",
    "ttl_s": 30,
    "revalidate_on": ["POST /api/lifecycle/install", "POST /api/lifecycle/uninstall"]
  }
}
```

The class is a small enum the frontend's data layer recognises and maps to a fetch strategy.

### The seven classes

| Class | When it changes | Fetch strategy | Concrete examples |
|---|---|---|---|
| **bootstrap** | Once per session (or per build) | Fetch on first load, cache for the lifetime of the tab | build SHA, schema version, capability flags, feature gates |
| **live** | Continuously, push-friendly | Server pushes via SSE / WebSocket; client never polls | item progress, downloadSpeed, scheduler.running, dispatch_paused, active_gid |
| **warm** | Slowly but autonomously | Recurring timer poll; pause when tab hidden, resume on focus | lifecycle axes, versions, peer list |
| **cold** | Only when user navigates there | Fetch on tab/panel open; don't poll | options, archive, dev metrics |
| **on-action** | Right after a specific user action | Refetch declared by `revalidate_on` after the named POST | bandwidth after `/probe`, lifecycle after `/install` |
| **swr** | Has a TTL but tolerates stale | Show cached immediately, refetch in background, swap in when ready | log tail, slow aggregates |
| **derived** | Never — pure computation | Don't fetch; compute from other state in the client | summary counts, filter visibility, badge classes |

Seven is the practical ceiling. Beyond that the strategies blur (e.g. `swr` is `warm` with a different render policy; `derived` is the absence of a fetch). The first five are mandatory; `swr` and `derived` are optional and earned by a concrete need.

### The `revalidate_on` field

This is what makes **on-action** declarative. Instead of the frontend hardcoding *"after I POST `/api/lifecycle/install` I should refetch `/api/lifecycle`"*, the lifecycle endpoint itself says:

```json
"meta": { "freshness": "warm", "revalidate_on": ["POST /api/lifecycle/install", "POST /api/lifecycle/uninstall"] }
```

The frontend's data layer registers an interceptor: when any matching POST returns 2xx, all endpoints whose `revalidate_on` listed it get invalidated. New backend actions that mutate this resource extend the list at the source — the frontend doesn't change.

This is the SWR/TanStack Query "key invalidation" pattern, but with the invalidation graph **declared by the server** instead of curated by the client.

## Why this isn't just SWR / TanStack Query / RTK Query

Existing client-side data libraries solve a related problem — caching, deduplication, background revalidation — but the **policy** still lives in the client:

- TanStack Query: `staleTime` and `refetchInterval` are passed at the call site.
- SWR: `refreshInterval` is per-hook.
- RTK Query: `keepUnusedDataFor` is per-endpoint, on the client.
- Apollo: cache policies and `pollInterval` are per-query.
- HTTP `Cache-Control` / `ETag`: come closest, but cover only TTL and revalidation, not the *kind* of data and not push-eligibility or action-driven invalidation.

None of them define a small, named **set of classes** that the *server* publishes per endpoint and that the client's data layer maps to a strategy without per-call configuration.

The closest prior art:

- **HTTP `Cache-Control: max-age` + `stale-while-revalidate`** — covers `swr` and partially `warm`, but is silent on push-eligibility, on-action invalidation, or whether something is `bootstrap` (once-ever) vs `cold` (on-demand).
- **GraphQL `@live` directive** — distinguishes live from request/response, but is binary.
- **Hypermedia / HATEOAS link relations** — can describe relationships but not refresh policy.
- **JSON:API `meta`** — defines the shape of a metadata block but not freshness vocabulary.

To my knowledge, no widely-adopted spec defines a small enum of **freshness classes** as a server-declared contract property with **action-graph invalidation**.

## Why declare it server-side

1. **One source of truth.** The team that owns the endpoint knows whether it changes on a push, a tick, or only on a write. The client team should not be guessing.
2. **Robust to new mutations.** Adding a new POST that affects a resource extends `revalidate_on` at the source. The frontend doesn't need a code change to learn about it.
3. **Multi-client correctness.** A second client (CLI, mobile, embedded) reads the same contract and gets correct refresh behaviour for free.
4. **Auditable.** "Why is the dashboard hammering this endpoint?" becomes a contract question, answerable from the OpenAPI doc.
5. **Pushable upstream.** Once this lives in the OpenAPI / JSON:API world, every framework's data layer can adopt the vocabulary without inventing its own.

## Visibility — an orthogonal modifier

Freshness class says *how often the data wants to refresh*. **Visibility** says *whether anyone is looking*. They multiply.

| Class | Tab visible | Tab hidden | Embedded but host hidden |
|---|---|---|---|
| **bootstrap** | fetch once | (already fetched) | (already fetched) |
| **live** | SSE connected | SSE connected but render throttled, OR disconnected if cost matters | disconnected; reconnect on `visibility: visible` |
| **warm** | poll at `ttl_s` | poll at `ttl_s × 4` or stop | stop |
| **cold** | fetch on tab open | n/a (tab not open) | n/a |
| **on-action** | refetch on action | (no actions while hidden) | (no actions while hidden) |
| **swr** | revalidate at `ttl_s` | serve cached, no revalidate | serve cached |
| **derived** | recompute on dep change | recompute on dep change | recompute on dep change |

Two visibility signals to listen to (whichever fires first wins):

1. `document.visibilitychange` — standalone tabs (browser tab switch / minimize)
2. `postMessage` from a host shell with `{type: "visibility", visible: bool}` — when the dashboard is embedded in an iframe and the host hides it without changing browser tab visibility

The `FreshnessRouter` should expose a single `setVisible(bool)` entry point that drives all timers/streams; the two listeners both call it.

This matters because today our SSE keeps polling and the lifecycle / bandwidth refetches keep firing when the tab is in the background — burning bandwidth and the user's battery for nobody to read.

## Anti-goals

- **Not a cache implementation.** This is a *declaration*; clients still implement caching with whatever they prefer (TanStack Query, plain Map, IndexedDB).
- **Not a transport.** Whether `live` rides SSE, WebSocket, or long-poll is orthogonal.
- **Not enforcement.** A server lying about its freshness class is a bug, not a security issue. Schema validation can warn (e.g. "endpoint declares `bootstrap` but its body changed between calls"), but the runtime treats the meta as advisory.
- **Not personal preferences.** "User wants this to refresh every 5 seconds" is a UI control, not a class.

## Migration path for ariaflow-server

1. Add the `meta` block to every endpoint with `freshness` and (where applicable) `ttl_s` and `revalidate_on`. Default to `warm` + `ttl_s: 30` for endpoints that don't yet know.
2. Frontend data layer: introduce a tiny `FreshnessRouter` that maps class → strategy. Replace the current "SSE-tick refetches everything" with the per-class strategies above.
3. Document the vocabulary in `ariaflow-server/docs/FRESHNESS.md` (server-side mirror of this file) so the contract is co-located with the code that emits it.
4. Once stable for one release, propose to upstream OpenAPI/JSON:API as an extension keyword (`x-freshness`).

## Open design questions

- **Should `revalidate_on` accept arbitrary event names** (not just `METHOD /path`)? E.g. `revalidate_on: ["bandwidth_probed"]` for an SSE-emitted event. Probably yes — gives push and POST equal expressive power.
- **Should `live` endpoints carry a `transport` hint** (`sse` / `ws` / `longpoll`)? Probably yes for forward compat, no for now.
- **Per-field freshness**, not just per-endpoint? E.g. `/api/status` mixes live items with warm summary counts. Could split into sub-endpoints, or annotate per-field. Wait until the pain shows up.

## Push upstream — venues

If this proves out in ariaflow over a few releases:

- **OpenAPI** — propose `x-freshness` as a vendor extension, then a stable keyword.
- **JSON:API** — extend the `meta` member spec with a recommended `freshness` field.
- **HTTP** — propose a `Freshness-Class:` response header alongside `Cache-Control`.
- **Blog post / ADR write-up** comparing this to TanStack/SWR/Apollo policy locations.

Don't push upstream until the seven classes have survived contact with at least one second consumer (CLI client, an embedded view, or a third-party dashboard) — otherwise it's just our local taxonomy.
