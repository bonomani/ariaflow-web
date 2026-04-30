# ariaflow-dashboard Plan

## Done (history in git)

- Contract-governance migration (BGS, UCC, schemas, alignment tests).
- Header / tabs separation refactor (fragment includes, LOADERS manifest, CSS tokens).
- Cross-platform installation (PyPI, optional `[local]` dep, per-platform aria2 docs).
- Rename to ariaflow-dashboard (module, package, CLI, UI, GitHub repo, Homebrew formula).

## Open gaps

| Gap | Status | Notes |
|---|---|---|
| FE-18 | Deferred | SSE smoke test — add when/if payload drift causes a regression |
| FE-21 | Resolved | Bonjour service type fixed |
| FE-22 | Blocked by BG-15 | Fallback to `/api/peers` when local mDNS unavailable (WSL, containers) |

Resolved gaps (BG-12–14, FE-15–20) — see git history and `FRONTEND_GAPS.md`.

## Done (cont.)

- Governance alignment: Makefile (`check-drift`, `verify`, `ci` targets),
  `scripts/check_bgs_drift.py`, `.github/workflows/test.yml` (CI gate),
  BGS files moved to `docs/governance/`.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.

## Active: Download state machine consistency (BG-30)

Goal: align item-status vocabulary across **aria2 → backend → frontend**
on aria2's six canonical statuses, plus two backend-only pre-aria2
states. Today three layers use three vocabularies; phantom states exist
in code with no producer; `paused` is overloaded across scheduler vs
item; `waiting` is dropped on the floor.

**Canonical states (target):**
- aria2-native: `active`, `waiting`, `paused`, `error`, `complete`, `removed`
- backend-only (pre-aria2): `discovering`, `queued`

Diagram: `discovering → queued → (active ⇄ waiting ⇄ paused) → {complete, error, removed}`

### Backend (paired-repo, file as BG-30)

1. **Persist `waiting`.** When `pollActiveItems` sees aria2's `live_status="waiting"`, transition `item.status` to `waiting` (today only cached in `live_status`). Add `waiting` to `summarizeQueue` buckets.
2. **Rename `stopped` → `removed`.** Match aria2's vocabulary. Ship dual-keyed for one release (`status: "removed"`, alias counter `summary.stopped` mirrors `summary.removed`), then drop alias.
3. **Delete `cancelled`.** Unreachable in `ITEM_STATUSES` — no producer. Remove from policy + types.
4. **Disambiguate scheduler pause.** Rename `state.paused` → `state.dispatch_paused` (item-level `paused` keeps its name). Endpoints stay `/api/scheduler/{pause,resume}` but the JSON field renames. Dual-key for one release.
5. **`active_gid` derived, not stored.** Compute from `aria2.tellActive()` on `/api/status` read instead of stamping in `tick`/`poll`. Removes stale-after-crash class.
6. **Document the state diagram** in `ariaflow-server/docs/STATE_MACHINE.md` (8 states, transitions, who can trigger each).

### Frontend (this repo, after backend ships)

1. **Drop phantom statuses.** Remove `recovered`, `failed`, `downloading` from `filters.ts normalizeStatus`. Use `paused`/`error`/`active` directly.
2. **Drop bucket aliases.** `done` → `complete`, `downloading` → `active` in filter labels. Update tab counts and badges.
3. **Wire `waiting` bucket.** Remove the always-zero counter once backend emits it.
4. **Rename `state.paused` → `state.dispatch_paused`** in `app.ts` reads. Update `schedulerOverviewLabel`.
5. **Update `formatters.ts` badge map.** Add `removed` (yellow), drop `stopped` once backend cuts over.
6. **Update tests** in `filters.test.ts` / `lifecycle.test.ts` for new vocabulary.

### Sequence
- BG-30 filed (frontend) → backend lands #1–6 dual-keyed → frontend lands #1–6 → backend drops aliases.

## Active: Freshness axis (BG-31) + visibility-aware refresh

Goal: replace the current "SSE tick → refetch everything" pattern with
per-endpoint freshness classes declared by the backend, modulated by
tab/host visibility. Design captured in `docs/FRESHNESS_AXIS.md`
(seven classes, visibility table, prior-art comparison, upstream-push
venues).

### Backend (paired-repo, file as BG-31)

1. Add a `meta` block to every JSON endpoint: `{ freshness, ttl_s?, revalidate_on? }`.
2. Default unknown endpoints to `warm` + `ttl_s: 30` so the rollout is incremental.
3. Document the vocabulary in `ariaflow-server/docs/FRESHNESS.md` (server-side mirror of the frontend design note).
4. Validate at test time: `bootstrap` endpoints must return identical bodies across calls; `live` endpoints must declare a transport.

### Frontend (this repo, after backend ships meta)

1. **`FreshnessRouter` module.** Single `setVisible(bool)` entry, maps class → strategy (SSE subscribe / setInterval / on-mount fetch / SWR cache / no-op).
2. **Replace eager SSE-tick refetch.** Today every `state_changed` triggers a full `/api/status` GET; route per-class instead.
3. **Visibility wiring.** Listen to `document.visibilitychange` + `postMessage({type:'visibility'})` from host shell; first event wins, both call `setVisible`.
4. **`revalidate_on` interceptor.** After any `_fetch` POST returns 2xx, invalidate endpoints whose `meta.revalidate_on` matches `<METHOD> <path>`.
5. **Tests.** Pure unit tests on the router (input: class + visibility + tick → output: action). No timer-based integration tests in this repo.

### Discoverability — `/api/_meta` index + Dev-tab panel

Rule: one declaration site (the endpoint's own `meta`), two read paths
(runtime router + dev panel). No hand-maintained parallel registry.

**Backend (BG-31, additional items):**

7. **Single registry on the server.** Wrap responses through one helper
   (e.g. `withMeta(endpoint, body)`) that pulls `freshness`/`ttl_s`/
   `revalidate_on` from a per-endpoint registration so the same source
   feeds both the per-call `meta` block and the index.
8. **`GET /api/_meta`** — returns `{ endpoints: [{ method, path, freshness, ttl_s, revalidate_on, transport? }] }` derived from that registry. `meta.freshness: "bootstrap"` itself.
9. **Runtime validator (test-only).** A test asserts that every route handler is registered (no implicit endpoints) and that `bootstrap` endpoints return byte-identical bodies across calls.

**Frontend (this repo, paired):**

6. **Consume `/api/_meta` at boot.** Cache the index (it's `bootstrap`); `FreshnessRouter` reads classes from there instead of from each response's inline meta. Inline `meta` stays as a per-response confirmation but the router doesn't depend on it.
7. **Dev-tab "Freshness map" panel.** Live table: endpoint · declared class · last fetch · next scheduled · visibility state · subscriber count. Plus a runtime warning row when an inline `meta` disagrees with the index (drift detector).
8. **No separate doc to maintain.** A static snapshot for review (PR descriptions, audit) is generated at build time from `/api/_meta`, never hand-edited. Add `npm run freshness:snapshot` that writes `docs/FRESHNESS_SNAPSHOT.md` from a running backend.

### Push upstream (only after second consumer proves the taxonomy)

- Propose `x-freshness` as OpenAPI vendor extension.
- JSON:API meta extension proposal.
- HTTP `Freshness-Class:` response header alongside `Cache-Control`.
- Blog post / ADR comparing to TanStack Query / SWR / Apollo policy locations.

Sequence: file BG-31 → backend lands `meta` on `/api/status`, `/api/lifecycle`, `/api/bandwidth` first → frontend ships `FreshnessRouter` consuming those three → expand backend coverage → consider upstream.

## Active: TypeScript migration of frontend JS

Migrate `src/ariaflow_dashboard/static/*.js` (1853 LOC across `app.js`,
`formatters.js`, `sparkline.js`) to TypeScript. `alpine.min.js` stays
vendored. Python is out of scope.

Steps:

1. **Toolchain.** Add `package.json`, `tsconfig.json` (strict), devDeps
   (`typescript`, `esbuild`, `@types/alpinejs`). Add `static/dist/` and
   `node_modules/` to `.gitignore`.
2. **Source layout.** New `src/ariaflow_dashboard/static/ts/` for `.ts`
   sources. Bundle to `static/dist/app.js`. Update `index.html`.
3. **Build integration.** `npm run build` (esbuild) and `npm run dev`
   (watch). Wire `make build-frontend` into `make verify` / `make ci`.
   Ensure `pyproject.toml` ships `static/dist/` in package data.
4. **Migrate file-by-file** (smallest first): `sparkline.ts` →
   `formatters.ts` → split `app.js` into `types.ts` / `api.ts` /
   `state.ts` / `components/*.ts` / `main.ts`.
5. **Backend DTO types.** Hand-write interfaces matching JSON
   endpoints from `../ariaflow-server`. Log shape gaps in
   `FRONTEND_GAPS.md`.
6. **Strictness ramp.** Land migration with `strict: false`, then
   enable `noImplicitAny` → `strictNullChecks` → full `strict` in
   small follow-up PRs.
7. **Lint & format.** ESLint + `@typescript-eslint` + Prettier; hook
   into `make ci`.
8. **Tests.** Port any JS tests (or add a smoke test with `node:test`
   + `tsx`) for pure modules. Manual browser smoke per AGENTS policy.
9. **Cleanup.** Remove old `.js` sources once `.ts` ships and
   `index.html` points at `dist/`. Update `ARCHITECTURE.md`.
10. **CI.** `make ci` runs `npm ci && tsc --noEmit && npm run build`
    before push.

## To study — patterns from `claude-sub-proxy/ui` worth borrowing

Comparative review captured 2026-04-26 against `claude-sub-proxy` commit
`aeefa13`. Each item is **research-only** for now — no code change in
ariaflow-dashboard until/unless we decide to adopt. Listed roughly from
"highest leverage" to "cosmetic".

### Architecture & language

1. **TypeScript end-to-end with esbuild bundle.** Replace `app.js`,
   `formatters.js`, `sparkline.js` with `.ts` modules; bundle via
   esbuild (~5 ms cold, ~9 MB dev-dep). Strict typing
   (`noUncheckedIndexedAccess`, `strict`) catches the bug class we
   currently rely on humans to spot. Source maps inline → real stack
   traces in devtools. Coverage gate becomes meaningful.
2. **Mini reactive store + pure `render(parent, state)` functions.**
   Replace Alpine's Proxy-magic reactivity with an explicit
   `createStore<S>()` (~40 LOC) plus per-view render fns. Wins:
   testable in isolation under happy-dom, every state mutation is a
   breakpoint-able call site, no "I mutated a nested object and the
   view didn't refresh" surprises. Cost: write `store.subscribe(...)`
   and `replaceChildren(parent, …)` plumbing manually.
3. **Build-time constants injected via esbuild `define`.** Inject
   `__BACKEND__` (URL of the backend the UI talks to) and `__COMMIT__`
   (`git rev-parse --short HEAD`) into the bundle. Show the commit sha
   in the header (`v2 aeefa13`). Saved hours of "is the new bundle
   loaded" debugging during claude-sub-proxy's recent passes.

### Quality & testing

4. **Unit tests on the UI layer.** Use `node:test` + `tsx --test` on
   pure functions only (formatters, predicate matchers, store
   derivations). Claude-sub-proxy has 64 UI tests at
   ~5 LOC each; the formatters file feels like documentation by
   example. Zero framework dep (node:test is stdlib).
5. **Defensive runtime asserts.** Patterns like
   `if (inflight < 0) { log("BUG: …"); inflight = 0 }` and a
   process-level `uncaughtException` handler that logs + survives
   instead of dying. Loud-but-recover.

### Embedded-mode discipline

6. **`?embedded=1` flag + postMessage handshake (UbiX-style).** Detect
   embedded mode at boot; emit `{type:"ready", minSize, preferredSize,
   title}` to `window.parent`; listen for `visibility` / `theme` /
   `state` from the host. Standalone path is unchanged (every
   `parent.postMessage` is a no-op when `parent === window`). Makes
   ariaflow-dashboard droppable into any future shell aggregator
   without retrofit. ~80 LOC, see
   `claude-sub-proxy/ui/src/shell-handshake.ts`.
7. **CSS scoped under a single root class** (e.g. `.ariaflow-app`).
   Today everything in `style.css` is global; if/when same-document
   embedding lands, every selector is a collision risk. Even without
   embedding, this is hygiene that prevents future bugs at zero cost.
   One pass of CSS-nesting under one wrapper.
8. **Visibility-aware polling using BOTH `document.visibilitychange`
   AND postMessage `visibility`.** Whichever fires first wins; the
   other becomes a no-op until next change. Works standalone (tab
   switch / minimize) AND embedded (shell hides the iframe). Pattern
   in `ui/src/shell-handshake.ts`.

### Deploy flexibility

9. **Three deploy modes via `BACKEND_URL` build env + `CORS_ORIGIN`
   runtime env.** Single-host (default, same-origin), split-host (UI
   on a CDN, backend on a VPS), embedded (iframe behind reverse
   proxy). Same bundle, different envs. Today ariaflow assumes the
   Python server hosts both; this would let the UI deploy to
   Cloudflare Pages / Vercel.
10. **Three-process orchestration script.** `scripts/dev.sh` with
    `start / stop / restart / status / logs` subcommands; kill-by-port
    via `lsof -sTCP:LISTEN`; auto-build of native binaries; per-
    process log files. Cleaner than juggling terminals.

### UX / data presentation

11. **Search-box token syntax with include/exclude.** `messages` /
    `-otlp` / `!chatgpt` / `claude -opus` (AND-composed). ~30 LOC in
    a pure `matchesFilter()` predicate, testable. Ariaflow could apply
    it to whatever indexable list it has.
12. **Filter persistence with versioned localStorage key.**
    `csp_admin_flags_v1`-style: explicit schema, per-field `??
    fallback`, parse-failure → return defaults. New fields don't
    crash old localStorage; schema bumps to `_v2` cleanly.
13. **Time formatting context-aware.** `fmtTimeLocal(ts)` shows
    `HH:MM:SS` for today, `MMM DD · HH:MM:SS` for older. Prevents
    confusion when the events ring spans days.
14. **Paused state indicator.** Visual amber pill on the status line
    when polling is off (auto-refresh unchecked). Avoids the "why
    isn't it updating" silence.
15. **Build-artifact identifier in the header.** Show the commit sha
    (or build timestamp) next to the version: `v2 aeefa13`. Removes
    the "am I seeing a stale bundle?" question.

### State / persistence

16. **Server-side single source of truth for aggregates.** Anything
    that's a sum, count, or accumulated total lives on the server,
    not in client localStorage. Clients are pure views, multi-tab
    safe by construction. (Claude-sub-proxy did this in G2 — Phase
    G of the project plan).
17. **Event ring snapshot persistence with monotonic ID continuity.**
    On graceful shutdown, write `{nextId, events}` to disk as JSON;
    restore at boot. The `nextId` field matters: admin clients use
    `since=N` cursors that would alias old + new events without it.
18. **`PRIVACY=1` env: explicit data-sensitivity mode.** Redact
    request previews, response captures, and log lines via
    heuristic regexes (Bearer / sk- / JWT-shaped). Optional, opt-in.
    Useful pattern even if ariaflow's domain is less sensitive — the
    *discipline* of having a named, env-flagged degraded mode is
    portable.

### Documentation discipline

19. **Living `DEEP_ANALYSIS.md` with dated passes.** Multi-pass code
    audits (HIGH / MED / LOW classification, items fixed vs items
    explicitly deferred with rationale). Forces honest pruning and
    documents *why* something wasn't fixed.
20. **Stack-comparison decision doc** (`docs/stack-comparison.md`).
    Articulates the maturity ladder L0/L1/L2/L3 (Alpine|Vanilla JS →
    TS modulaire → Preact → React+shadcn). Even keeping ariaflow at
    L0 (current), having the doc clarifies *why* and what L1 would
    look like.

---

**How to use this list.** When ariaflow-dashboard hits a real pain
point — bug that types would have caught, a need to embed elsewhere,
a regression that tests would have prevented — pick the relevant item
and graduate it from "to study" to a real plan entry. Don't port them
en bloc; port reactively, when the cost stops being theoretical.
