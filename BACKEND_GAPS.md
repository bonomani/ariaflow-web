# Backend Gaps

Missing features in `ariaflow/src/aria_queue/webapp.py`.
Based on a fresh scan of both codebases.

---

## GAP-1: No priority endpoint — BROKEN

Frontend `moveToTop()` calls `POST /api/item/{id}/priority`.
Backend `_post_item_action` (line 1228) only maps `pause|resume|remove|retry`.

**Fix:** Add `priority` case. Backend already has `_aria2_apply_priority()` in `queue_ops.py`.

**Effort:** Small | **Impact:** Critical

## GAP-2: SSE pushes rev-only

`_invalidate_status_cache()` (line 498) publishes:
```json
{"rev": <int>, "server_version": "<str>"}
```
Frontend must do a full `GET /api/status` after each event.

**Fix:** Push `_status_payload(force=True)` as SSE data.

**Effort:** Small | **Impact:** High

## GAP-3: No bulk item operations

No endpoint for multi-item actions.

**Needed:** `POST /api/items/bulk` with `{action, ids}`.

**Effort:** Medium | **Impact:** Medium

## GAP-4: No pagination on `/api/status`

Returns entire queue every call. No `offset`/`limit`.

**Needed:** `?offset=0&limit=50` → response includes `total_count`.

**Effort:** Medium | **Impact:** Medium

## GAP-5: No server-side search

No `?q=keyword` on `/api/status`.

**Effort:** Small | **Impact:** Small

## GAP-6: No PATCH for preferences

No `do_PATCH` method. Frontend does GET→merge→POST.

**Needed:** `PATCH /api/declaration/preferences` + add PATCH to CORS.

**Effort:** Small | **Impact:** Medium

## GAP-7: No per-item error in batch add

`_parse_add_items` fails entire batch on one bad item.

**Needed:** Per-item results in response.

**Effort:** Small | **Impact:** Small

## GAP-8: No retry policies

No auto-retry, no `max_retries` preference, no `retry_count` on items.

**Effort:** Medium | **Impact:** Medium

## GAP-9: No post-download hooks

`post_action_rule` field exists but nothing executes.

**Effort:** Large | **Impact:** Medium

## GAP-10: No webhooks

No server-side event notifications.

**Needed:** `GET/POST/DELETE /api/webhooks`.

**Effort:** Medium | **Impact:** Medium

## GAP-11: No speed history

Speed data is frontend-only, in-memory.

**Needed:** `GET /api/stats/speed?range=1h`.

**Effort:** Medium | **Impact:** Small

## GAP-12: No authentication

All endpoints open. `Access-Control-Allow-Origin: *`.

**Effort:** Medium | **Impact:** Medium

## GAP-13: No scheduling / time windows

No time-based bandwidth caps.

**Effort:** Large | **Impact:** Medium

## GAP-14: No item labels / categories

No tags on items, no `?tag=` filter.

**Effort:** Medium | **Impact:** Small

---

## Priority

### Must fix

| # | Gap | Effort |
|---|-----|--------|
| 1 | Priority endpoint (broken) | Small |
| 2 | SSE full payload | Small |
| 6 | PATCH preferences | Small |

### Should fix

| # | Gap | Effort |
|---|-----|--------|
| 3 | Bulk operations | Medium |
| 4 | Pagination | Medium |
| 7 | Batch add errors | Small |
| 8 | Retry policies | Medium |

### Nice to have

| # | Gap | Effort |
|---|-----|--------|
| 5 | Search | Small |
| 9 | Post-download hooks | Large |
| 10 | Webhooks | Medium |
| 11 | Speed history | Medium |
| 12 | Authentication | Medium |
| 13 | Scheduling | Large |
| 14 | Labels | Medium |

---

## Backend Endpoint Inventory

**17 GET:** `/api`, `/api/health`, `/api/status`, `/api/events`, `/api/scheduler`,
`/api/bandwidth`, `/api/declaration`, `/api/options`, `/api/lifecycle`, `/api/log`,
`/api/archive`, `/api/sessions`, `/api/session/stats`, `/api/item/{id}/files`,
`/api/docs`, `/api/openapi.yaml`, `/api/tests`

**14 POST:** `/api/add`, `/api/run`, `/api/pause`, `/api/resume`, `/api/session`,
`/api/declaration`, `/api/cleanup`, `/api/bandwidth/probe`, `/api/preflight`,
`/api/ucc`, `/api/lifecycle/action`, `/api/aria2/options`,
`/api/item/{id}/{action}` (pause/resume/remove/retry), `/api/item/{id}/files`

**Missing:** No PATCH/PUT/DELETE. No priority action. SSE is notification-only (no full payload).
