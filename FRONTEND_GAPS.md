# ariaflow-dashboard Frontend Gaps

## Open (2)

### FE-33: Finish live-contract release gate setup

The live-contract job in `.github/workflows/release.yml` (added in
d368f28) is currently **advisory only** — `continue-on-error: true`
and `build-release` no longer declares `needs: live-contract`.
Failures are visible in the run summary but don't block releases.

**Why advisory:** seven layered setup failures across one session
made the gate unreliable as a blocker:

1. `npm install -g @ariaflow/cli@latest` → 404 (package not on npm).
   Fixed: clone backend repo + pnpm build (40f4332).
2. `tests/conftest.py` imports `playwright` at module scope, fails
   under `[dev]`-only install. Fixed: lazy-import + skip fixture
   (54c5b80).
3. `/api/aria2/global_option` unreachable: aria2 installed but
   daemon not started. Fixed: `aria2c --enable-rpc --daemon` step
   (fb9a8b9).
4. `make verify` failed on `check-drift` (BGSPrivate repo not in
   CI). Fixed: new `make verify-ci` target without drift check
   (126ff2c). Drift is warning-only per FE-19, but the script
   hard-fails on missing repo.
5. `node --test` glob expansion failed on Node 20 (became native
   in Node 21+). Fixed: bumped CI to Node 22 (edfb3c6).
6. Five other test files import `playwright` at module scope. Fixed:
   `collect_ignore_glob` in conftest (7998c25).
7. `tests/test_static_serving.py` imports `bs4` (BeautifulSoup4),
   not in `pyproject [dev]`. **Not fixed.** This is where I gave up.

**To finish the gate properly:**

- ~~Add `bs4` (and audit the rest of `tests/` for undeclared deps) to
  `pyproject.toml [dev]`.~~ **Done.** `beautifulsoup4` and
  `jsonschema` added to `[dev]` and `[test-browser]`.
- ~~Patch `scripts/check_bgs_drift.py` to soft-fail on missing
  `BGSPrivate/` (warn instead of exit non-zero) so `make verify`
  works in CI without forking to `verify-ci`.~~ **Done.** Script
  prints a WARN and exits 0 when `../BGSPrivate` is absent. Local
  dev still hard-fails on real drift. `verify-ci` Make target
  removed; release.yml `build-release` now runs `make verify`
  directly.
- Restore `needs: live-contract` on `build-release` and drop
  `continue-on-error: true` on the live-contract job. Pending one
  green run of the new setup to confirm the gate is reliable.

**Why this hurts:** today the gate's purpose (catch backend contract
regressions like BG-38 before they ship) is intact in advisory form
— the assertions still run, failures are visible — but a backend
break can't actually stop a dashboard release. That's the gap to
close.

### FE-18: No schema/test oracle for `/api/events` (deferred)

SSE stream at `/api/events` is outside the contract layer. Add an
event-stream test strategy only if SSE payload drift causes a regression.

---

_End of open gaps._

## Resolved

| ID | Summary | Date |
|----|---------|------|
| FE-34 | Scheduler badge in System Health → ariaflow-server now renders `state.scheduler_status` (5-state enum from BG-40) with a wait-reason sub-label (e.g. "idle · queue empty"). New getters `schedulerBadgeText` / `schedulerBadgeClass` / `schedulerWaitReasonText` in `app.ts` map the backend enum + `state.wait_reason` to label/class; fall back to inferred values for backends older than v0.1.252 | 2026-05-05 |
| FE-22 | `discoverBackends()` (`app.ts:764`) now falls back to `GET /api/peers` on the current backend when the local mDNS browse returns zero items (WSL NAT / containers / VMs without mDNS). Peer rows map to discovery-item shape (`url` ← `base_url || http://host:port`, `name` ← `instance \|\| host`, `role: 'backend'`, `source: 'peers'`) and merge through the existing `mergeDiscoveredBackends()` path. `discoveryText` reflects the source ("…via /api/peers fallback" when only the fallback fired). New e2e regression test asserts the fallback fires + populates state when discovery is empty | 2026-05-04 |
| FE-27 | Negative-snapshot tests added in `static/ts/status_legacy_keys.test.ts`. Four assertions scan `static/ts/*.ts` source for forbidden patterns: top-level `data.dispatch_paused` reads (canonical: `state.dispatch_paused`), `state.paused` (BG-33), `summary.stopped` (BG-33), and `.filtered` reads on a status payload (BG-35). Verified live 2026-05-04 against running backend: `/api/status` has `dispatch_paused` only on `state` and no `filtered` key anywhere — BG-35's effect shipped, even though the backend agent's Resolved table doesn't list it explicitly | 2026-05-04 |
| FE-24 | Per-endpoint freshness routing + Dev-tab map shipped end-to-end. `FreshnessRouter` (`static/ts/freshness.ts`) consumes BG-31's `/api/_meta`, dispatches per class (live/warm/swr/cold/on-action/bootstrap/derived), ref-counts subscribers, and exposes `status()` for the Dev tab Freshness map (HTML rendered in `_fragments/tab_dev.html`, columns: Endpoint / Class / TTL / Subscribers / Host visibility / Last fetch / Active). Visibility wiring (`wireHostVisibility` in `freshness-bootstrap.ts`) hooks `document.visibilitychange` + host postMessage. `npm run freshness:snapshot` (`scripts/freshness-snapshot.mjs`) writes a build-time markdown audit. Followups (FE-26 TAB_SUBS migration, FE-31 host-aware fetcher) closed the original LOCAL_METAS sync hazards | 2026-05-04 |
| FE-31 | FreshnessRouter is now host-aware. `EndpointMeta.host: 'backend' \| 'dashboard'` plumbed through `runFetch` → `RouterAdapters.fetchJson(method, path, params, host)`. `bootstrapFreshnessRouter` takes optional `dashboardMetaUrl` and fetches both `/api/_meta` documents, tagging each endpoint with its origin. The app-level fetcher branches on `host`: `'dashboard'` fetches same-origin (port 8001), `'backend'` (default) routes via `apiPath()` to the selected backend. `LOCAL_METAS` shrinks to just `/api/aria2/option_tiers`. New e2e test asserts `/api/web/log` is fetched same-origin and never reaches the backend mock | 2026-05-04 |
| FE-32 | Playwright e2e smoke harness (`e2e/ui-smoke.spec.ts`): six tests covering header webVersion/webPid injection, dev tab Runtime/Spec version chips + drift badge, archive `'removed'` fallback, freshness map render, lifecycle row paint. `init()` now calls `loadSpecVersion()` for direct `/dev` loads. Drive-by: `canonical-routes.spec.ts` `selectedBackend` localStorage typo fixed and its `/api/_meta` mock seeded with the endpoints the test asserts (`/api/aria2/global_option`, `/api/declaration` with revalidate triggers); all 9 e2e tests now green | 2026-05-04 |
| FE-30 | Archive tab badge fallback `item.status \|\| 'cancelled'` replaced with `'removed'` (canonical post-BG-30 terminal status) in `static/_fragments/tab_archive.html`. `cancelled` was removed from `ITEM_STATUSES` by BG-30 as unreachable, so the literal was dead | 2026-05-04 |
| FE-29 | Dev tab surfaces OpenAPI/runtime version drift: new `loadSpecVersion()` fetches `/api/openapi.yaml` on dev-tab nav, parses `info.version`, exposes `specVersion` + `specVersionMismatch` getter; tab_dev.html renders Runtime/Spec chips and a `version drift` warn badge when they differ. Backend pairing dropped (BG-37 not accepted upstream); the chip is purely an observability surface so any future stamp drift is visible at a glance | 2026-05-04 |
| FE-28 | Migrated off 5 backend aliases: `POST /api/downloads/add` → `POST /api/downloads`; `POST /api/declaration` → `PUT /api/declaration`; `GET /api/aria2/get_global_option` → `GET /api/aria2/global_option`; `GET /api/aria2/get_option` → `GET /api/aria2/option`. (`/api/declaration/preferences` was already `PATCH`.) Updates: `app.ts` 4 sites, `actions.ts` urlAria2GetOption builder, `actions.test.ts` expected URL, `tests/conftest.py` mock backend (canonical paths + new `do_PUT` handler), `tests/test_api_params.py` (`_put` helper, `TestPostDeclaration` uses PUT, aria2 GET tests use new paths), `docs/ucc-declarations.yaml` (4 entries renamed). Pairs with backend BG-36 — wait one full release cycle before backend deletes the alias handlers (old browser tabs still hit old paths) | 2026-05-01 |
| FE-26 | LOADERS manifest replaced by `TAB_SUBS` declarations driven by `FreshnessRouter`. All six tabs (dashboard, bandwidth, lifecycle, options, log, archive) subscribe through the router; per-tab `k` multipliers gone. Two prereqs landed first: `onUpdate` notify hook (commit 6777814) and `subscribe(params)` for query-stringed endpoints (`?limit=` on archive/sessions). Synthetic meta registered for `/api/web/log` and `/api/aria2/option_tiers` (not in `/api/_meta`). Loader functions kept as `_apply<X>(data)` helpers + thin fetch wrappers for explicit-call paths (e.g. `loadLifecycle()` after a lifecycle action). `_startTabPollers`/`_stopTabPollers` retained as harness; LOADERS now empty for every tab — follow-up commit can remove them outright | 2026-05-01 |
| FE-25 | Dropped legacy alias fallbacks (paired with BG-33): `state.dispatch_paused ?? state.paused` collapsed to `dispatch_paused` only, `s.removed ?? s.stopped` to `removed`, `'stopped'` removed from `itemCanRetry` allow-list and `formatters.badgeClass` bad-list. Earlier this session: `lifecycle.ts` `labelFromLegacy` + axes-absent fallbacks deleted | 2026-04-30 |
| FE-23 | Aria2-aligned item-status vocabulary (BG-30 cutover): dropped phantom statuses (recovered/failed/downloading/done/cancelled), switched filter buckets to canonical names (active/complete/removed), wired waiting counter, switched to `state.dispatch_paused` reads | 2026-04-30 |
| FE-21 | Bonjour service type fixed (`_ariaflow-server._tcp` / `_ariaflow-dashboard._tcp`) | 2026-04-09 |
| FE-20 | Archive button uses `archivable_count` from backend | 2026-04-09 |
| FE-19 | BGS SHA drift — warning-only, accepted | 2026-04-07 |
| FE-17 | No CI for BGS — won't-fix (BGSPrivate is private) | 2026-04-07 |
| FE-16 | Health from `/api/status.health`, no separate timer | 2026-04-06 |
| FE-15 | Log tab uses SSE `action_logged` events | 2026-04-06 |

Details for all resolved entries are preserved in git history.
