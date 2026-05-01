# ariaflow-dashboard Plan

History lives in git. This file tracks only **active** and **deferred** work.

## Open gaps

| Gap | Status | Notes |
|---|---|---|
| FE-18 | Deferred | SSE smoke test — add only when payload drift causes a regression |
| FE-22 | Blocked by BG-15 | Fallback to `/api/peers` when local mDNS unavailable (WSL, containers) |
| FE-24 | In progress | Freshness routing + Dev map — see below |

## Active: FE-24 — Freshness routing remainder

Steps 1–8 shipped (router, eager-refetch removal, visibility, revalidate_on,
tests, `/api/_meta` consumption, Dev-tab map, `npm run freshness:snapshot`).
Remaining:

- **BG-32 paired wiring — deferred.** Backend v1 is connect-time filter
  only (mid-stream subscribe/unsubscribe deferred upstream), so any topic
  change forces an SSE reconnect. Today only `/api/status` declares topics
  (`items, scheduler`); the Log tab depends on `action_logged` events
  (`log` topic) but `/api/log` isn't a `live` endpoint, so a naive union
  over registered live endpoints would silently dark the Log tab.
  Revisit when either (a) backend ships mid-stream subscribe so the
  router can be subscriber-driven without reconnect storms, or (b) `log`
  is modeled as a router-registered SSE-driven endpoint so its topic is
  part of the union. Until then, leave SSE unfiltered (current behavior).
- **LOADERS manifest replacement.** Done — tracked as FE-26, shipped
  2026-05-01. All six tabs subscribe through the router via `TAB_SUBS`
  declarations. Follow-up cleanup: remove the now-empty `LOADERS` /
  `_startTabPollers` / `_stopTabPollers` harness once the new flow has
  been browser-validated.

## Won't-fix legacy fallbacks (small dead code, large policy cost)

- `freshness-bootstrap.ts` returns null on `/api/_meta` 404.
- `app.ts` `_fetch` `if (this._freshnessRouter)` invalidation guard.
- SSE event-name → "all topics" fallback path.

These would need a declared minimum backend version (banner, version
detection, upgrade UX) to drop safely — more weight than the ~5 lines
of guard code they'd remove. Revisit only if a real divergence between
old and new backend behavior shows up.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.

## To study — patterns from `claude-sub-proxy/ui` worth borrowing

Comparative review captured 2026-04-26 against `claude-sub-proxy` commit
`aeefa13`. Each item is **research-only** — graduate to a real plan entry
only when ariaflow hits a matching pain point. Listed roughly from
"highest leverage" to "cosmetic".

### Architecture & language

1. **Mini reactive store + pure `render(parent, state)` functions.**
   Replace Alpine's Proxy-magic reactivity with an explicit
   `createStore<S>()` (~40 LOC) plus per-view render fns. Wins:
   testable in isolation under happy-dom, every state mutation is a
   breakpoint-able call site, no "I mutated a nested object and the
   view didn't refresh" surprises. Cost: write `store.subscribe(...)`
   and `replaceChildren(parent, …)` plumbing manually.
2. **Build-time constants injected via esbuild `define`.** Inject
   `__BACKEND__` (URL of the backend the UI talks to) and `__COMMIT__`
   (`git rev-parse --short HEAD`) into the bundle. Show the commit sha
   in the header (`v2 aeefa13`). Saved hours of "is the new bundle
   loaded" debugging during claude-sub-proxy's recent passes.

### Quality & testing

3. **Defensive runtime asserts.** Patterns like
   `if (inflight < 0) { log("BUG: …"); inflight = 0 }` and a
   process-level `uncaughtException` handler that logs + survives
   instead of dying. Loud-but-recover.

### Embedded-mode discipline

4. **`?embedded=1` flag + postMessage handshake (UbiX-style).** Detect
   embedded mode at boot; emit `{type:"ready", minSize, preferredSize,
   title}` to `window.parent`; listen for `visibility` / `theme` /
   `state` from the host. Standalone path is unchanged (every
   `parent.postMessage` is a no-op when `parent === window`). Makes
   ariaflow-dashboard droppable into any future shell aggregator
   without retrofit. ~80 LOC, see
   `claude-sub-proxy/ui/src/shell-handshake.ts`.
5. **CSS scoped under a single root class** (e.g. `.ariaflow-app`).
   Today everything in `style.css` is global; if/when same-document
   embedding lands, every selector is a collision risk. Even without
   embedding, this is hygiene that prevents future bugs at zero cost.
   One pass of CSS-nesting under one wrapper.

### Deploy flexibility

6. **Three deploy modes via `BACKEND_URL` build env + `CORS_ORIGIN`
   runtime env.** Single-host (default, same-origin), split-host (UI
   on a CDN, backend on a VPS), embedded (iframe behind reverse
   proxy). Same bundle, different envs. Today ariaflow assumes the
   Python server hosts both; this would let the UI deploy to
   Cloudflare Pages / Vercel.
7. **Three-process orchestration script.** `scripts/dev.sh` with
   `start / stop / restart / status / logs` subcommands; kill-by-port
   via `lsof -sTCP:LISTEN`; auto-build of native binaries; per-
   process log files. Cleaner than juggling terminals.

### UX / data presentation

8. **Search-box token syntax with include/exclude.** `messages` /
   `-otlp` / `!chatgpt` / `claude -opus` (AND-composed). ~30 LOC in
   a pure `matchesFilter()` predicate, testable. Ariaflow could apply
   it to whatever indexable list it has.
9. **Filter persistence with versioned localStorage key.**
   `csp_admin_flags_v1`-style: explicit schema, per-field `??
   fallback`, parse-failure → return defaults. New fields don't
   crash old localStorage; schema bumps to `_v2` cleanly.
10. **Time formatting context-aware.** `fmtTimeLocal(ts)` shows
    `HH:MM:SS` for today, `MMM DD · HH:MM:SS` for older. Prevents
    confusion when the events ring spans days.
11. **Paused state indicator.** Visual amber pill on the status line
    when polling is off (auto-refresh unchecked). Avoids the "why
    isn't it updating" silence.
12. **Build-artifact identifier in the header.** Show the commit sha
    (or build timestamp) next to the version: `v2 aeefa13`. Removes
    the "am I seeing a stale bundle?" question.

### State / persistence

13. **Server-side single source of truth for aggregates.** Anything
    that's a sum, count, or accumulated total lives on the server,
    not in client localStorage. Clients are pure views, multi-tab
    safe by construction.
14. **Event ring snapshot persistence with monotonic ID continuity.**
    On graceful shutdown, write `{nextId, events}` to disk as JSON;
    restore at boot. The `nextId` field matters: admin clients use
    `since=N` cursors that would alias old + new events without it.
15. **`PRIVACY=1` env: explicit data-sensitivity mode.** Redact
    request previews, response captures, and log lines via
    heuristic regexes (Bearer / sk- / JWT-shaped). Optional, opt-in.
    Useful pattern even if ariaflow's domain is less sensitive — the
    *discipline* of having a named, env-flagged degraded mode is
    portable.

### Documentation discipline

16. **Living `DEEP_ANALYSIS.md` with dated passes.** Multi-pass code
    audits (HIGH / MED / LOW classification, items fixed vs items
    explicitly deferred with rationale). Forces honest pruning and
    documents *why* something wasn't fixed.
17. **Stack-comparison decision doc** (`docs/stack-comparison.md`).
    Articulates the maturity ladder L0/L1/L2/L3 (Alpine|Vanilla JS →
    TS modulaire → Preact → React+shadcn). Even keeping ariaflow at
    L1 (current — TS modulaire), having the doc clarifies *why* and
    what L2 would look like.
