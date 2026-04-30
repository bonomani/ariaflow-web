# ariaflow-dashboard Frontend Gaps

## Open (3)

### FE-23: Align item-status vocabulary on aria2 (paired with BG-30)

Three layers (aria2 → backend → frontend) use three different vocabularies
for the same download states. Concrete drift:

- `done` (frontend bucket) vs `complete` (backend, aria2)
- `downloading` (frontend bucket) vs `active` (backend, aria2)
- `stopped` (backend, frontend) vs `removed` (aria2)
- `failed` / `recovered` / `downloading` (frontend `normalizeStatus`) — no producer
- `cancelled` (backend `ITEM_STATUSES`) — no producer
- `waiting` (aria2 status) — backend caches in `live_status` but never persists; frontend counter always 0
- `state.paused` (scheduler-wide) overloads the word with `item.status="paused"` (single download)

Blocked by: BG-30 (backend persists `waiting`, renames `stopped`→`removed` and `state.paused`→`state.dispatch_paused`, drops `cancelled`, makes `active_gid` derived).

Once BG-30 ships dual-keyed, frontend cuts over: drop phantom statuses
in `filters.ts normalizeStatus`, drop bucket aliases (`done`→`complete`,
`downloading`→`active`), wire the `waiting` counter, rename
`state.paused` reads to `state.dispatch_paused`, update `formatters.ts`
badge map (`removed`), update tests. Then backend drops aliases.



### FE-18: No schema/test oracle for `/api/events` (deferred)

SSE stream at `/api/events` is outside the contract layer. Add an
event-stream test strategy only if SSE payload drift causes a regression.

### FE-22: Fallback to `/api/peers` when local mDNS unavailable

When the dashboard runs in environments without mDNS (WSL NAT, containers,
VMs), `discoverBackends()` gets no results from local browse. The backend's
`/api/peers` endpoint can provide peer info as a fallback.

Blocked by: BG-15 (backend discovery uses stale service type, so
`/api/peers` returns nothing).

Once BG-15 is fixed, the frontend should:
1. Try local mDNS browse first (current behavior).
2. If local browse returns nothing, fall back to `GET /api/peers` on the
   current backend and merge results into `mergeDiscoveredBackends()`.

---

_End of open gaps._

## Resolved

| ID | Summary | Date |
|----|---------|------|
| FE-21 | Bonjour service type fixed (`_ariaflow-server._tcp` / `_ariaflow-dashboard._tcp`) | 2026-04-09 |
| FE-20 | Archive button uses `archivable_count` from backend | 2026-04-09 |
| FE-19 | BGS SHA drift — warning-only, accepted | 2026-04-07 |
| FE-17 | No CI for BGS — won't-fix (BGSPrivate is private) | 2026-04-07 |
| FE-16 | Health from `/api/status.health`, no separate timer | 2026-04-06 |
| FE-15 | Log tab uses SSE `action_logged` events | 2026-04-06 |

Details for all resolved entries are preserved in git history.
