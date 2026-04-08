# Plan

Current work in `ariaflow-web` is a contract-governance migration, not a
feature sprint. The goal is to make the frontend's backend assumptions
explicit, machine-checked, and reviewable.

## Current migration

- Move BGS decision detail out of `BGS.md` into `docs/bgs-decision.yaml`.
- Treat `docs/ucc-declarations.yaml` as the canonical declaration for:
  endpoint coverage, action coverage, expected preferences, and known-unused
  backend fields.
- Add frontend-owned JSON schemas under `docs/schemas/` for the subset of
  backend response shapes the UI actually consumes.
- Add tests that verify:
  mock fixtures match the frontend schemas,
  frontend schemas are a subset of backend OpenAPI,
  the UCC declaration artifact is well-formed,
  the BGS claim passes the local validator.

## Next steps

- Run and stabilize the new test set:
  `tests/test_api_response_shapes.py`
  `tests/test_openapi_alignment.py`
  `tests/test_ucc_declarations_schema.py`
  `tests/test_bgs_compliance.py`
  `tests/test_bgs_sha_drift.py`
  plus the existing contract tests in `tests/test_api_params.py` and
  `tests/test_coverage_check.py`.
- Verify that the new docs and tests are internally consistent:
  `BGS.md`, `docs/bgs-decision.yaml`, `docs/ucc-declarations.yaml`,
  `docs/schemas/`, `.pre-commit-config.yaml`.
- Decide whether the migration lands as one commit series now or is dropped
  entirely. The partial state is the only bad state.

## Open items

- **No CI enforcement for BGS compliance.** The validator depends on the
  private `../BGSPrivate` sibling checkout, so this currently runs only
  locally and via pre-commit.
- **No schema oracle for `/api/events` yet.** SSE uses `text/event-stream`,
  so it needs a different test strategy than the JSON endpoints.
- **Pinned BGS SHAs must be maintained manually.** `tests/test_bgs_sha_drift.py`
  warns when `docs/bgs-decision.yaml` lags behind `../BGSPrivate/bgs`.

## Header / tabs separation refactor

Goal: split `src/ariaflow_web/static/index.html` so the header (nav + hero) and
each tab become independent units. Analysis shows zero tab-conditional logic in
the header and zero header references inside tabs — only four shared values
couple them: `page`, `selectedBackend`/`backendReachable`, `refreshInterval`,
and the global transfer metrics (`transferSpeedText`, `globalSparklineSvg`).

### Timer model (3 timers, today in `app.js`)

| Tier | Field | Interval | Selectable? | Drives |
|---|---|---|---|---|
| Fast | `refreshTimer` | `refreshInterval` (1.5s / 3s / 5s / 10s / 30s / Off, default 10s) | **yes — user-selectable in header** | `refresh()` → global status + sparklines, consumed by **header transfer graph** and **dashboard queue items** |
| Medium | `_mediumTimer` | `MEDIUM_INTERVAL=30s`, clamped to ≥ fast | no | per-tab methods in `_TAB_MEDIUM` (log, bandwidth, lifecycle) |
| Slow | `_slowTimer` | `SLOW_INTERVAL=120s`, clamped to ≥ fast | no | per-tab methods in `_TAB_SLOW` (dashboard, log, options, bandwidth) |

Implications for the refactor:
- The **fast** timer is the only cross-cutting one — it feeds both header
  (sparkline/transfer chip) and the active tab. It must live in the store,
  not in any single template, and `refreshInterval=0` ("Off") must continue
  to suppress all three timers.
- The **medium** and **slow** timers are tab-scoped: their method lists
  (`_TAB_MEDIUM`, `_TAB_SLOW`) key by `page`. After the split, each tab
  fragment should declare its own medium/slow methods (e.g. via a tab-local
  config object the store reads), instead of the central maps in `app.js`.
  That way adding a tab does not require editing two dictionaries in core.
- Visibility-pause logic (`_onVisibilityChange`, app.js:347) currently
  knows about all three timers + SSE + defer timer. It should stay
  centralized in the store after the refactor — one owner for "pause/resume
  all background activity".

Steps:
1. Introduce an Alpine store (`Alpine.store('app', { page, backend, reachable,
   refreshInterval })`); migrate header bindings to read/write the store.
2. Watch `page` and `refreshInterval` in the store and call
   `_updateTabTimers(page)` from there, so tabs no longer need to know that
   bridge exists (currently in `app.js:303,910`).
3. Extract `index.html` lines 15–94 into `_header.html` (nav + hero) and split
   each `x-show="page === '<name>'"` block into `tab_<name>.html`
   (dashboard, bandwidth, lifecycle, options, log, dev, archive).
4. Server- or template-include the fragments from `index.html`; keep a single
   `x-data="ariaflow"` root so existing methods/state still resolve.
5. Keep global transfer metrics (`transferSpeedText`, `globalSparklineSvg`)
   in the header — they are global and consumed by the fast timer, not
   dashboard-specific.
6. Smoke-test each tab (switch, refresh interval change, backend switch,
   offline/online transition) to confirm no regressions in timer wiring.

Out of scope: no behavioral changes, no backend calls, no styling rework.

## Deferred

- **Mock fixtures (DEFAULT_STATUS etc.) → YAML.** Not worth the churn.
- **Generated `BGS.md`.** Too small to justify generation.
- **BGS Grade-2 style profiles/policies.** No clear value for this repo.
