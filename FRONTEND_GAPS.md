# ariaflow-dashboard Frontend Gaps

## Open (3)

### FE-27: Snapshot test asserting unread `/api/status` payload keys are gone (paired with BG-35)

After BG-35 ships, add a frontend snapshot regression test asserting
that `dispatch_paused` (top-level) and `filtered` no longer appear in
the `/api/status` response shape consumed by this dashboard. Mirrors
the BG-33 negative-snapshot pattern (`state.paused`, `summary.stopped`,
`status:"stopped"`) on the FE side so any future drift is caught
before it lands.

Blocked by: BG-35.

### FE-18: No schema/test oracle for `/api/events` (deferred)

SSE stream at `/api/events` is outside the contract layer. Add an
event-stream test strategy only if SSE payload drift causes a regression.

### FE-22: Fallback to `/api/peers` when local mDNS unavailable

When the dashboard runs in environments without mDNS (WSL NAT, containers,
VMs), `discoverBackends()` gets no results from local browse. The backend's
`/api/peers` endpoint can provide peer info as a fallback.

BG-15 resolved 2026-04-30 (TS port `discovery/parse.ts` uses the canonical
`_ariaflow-server._tcp` service type), so this is no longer blocked — only
unimplemented. `discoverBackends()` (`app.ts:764`) calls `/api/discovery`
on the dashboard server and stops there; no `/api/peers` merge.

Once picked up, the frontend should:
1. Try local mDNS browse first (current behavior).
2. If local browse returns nothing (`bonjourState === 'broken'`), fall
   back to `GET /api/peers` on the current backend and merge results
   into `mergeDiscoveredBackends()`.

---

_End of open gaps._

## Resolved

| ID | Summary | Date |
|----|---------|------|
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
