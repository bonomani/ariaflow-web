# Backend Gaps — Missing from ariaflow backend

Features that require backend code changes in `ariaflow/webapp.py` (or core modules).
These cannot be solved by frontend wiring alone.

---

## GAP-1: No `POST /api/item/{id}/priority` endpoint

**Status: BROKEN** — the frontend calls this endpoint but it doesn't exist.

`moveToTop()` sends `POST /api/item/{id}/priority` with `{priority: max+1}`.
Backend `_post_item_action` only maps `pause|resume|remove|retry`.

**Fix:** Add `priority` handler using existing `_aria2_apply_priority()` helper in `queue_ops.py`.

**Effort:** Small | **Impact:** Critical

---

## GAP-2: SSE pushes rev only, not full payload

`_sse_publish()` sends `{rev, server_version}`. The frontend (now wired for SSE)
handles both modes: full payload → assign directly, rev-only → fetch on change.
Pushing full payload would eliminate the extra round-trip.

**Fix:** In `_invalidate_status_cache()`, include `_status_payload(force=True)` in SSE data.

**Effort:** Small | **Impact:** High (zero-polling mode)

---

## GAP-3: No bulk item operations

No endpoint to act on multiple items at once.

**What's needed:**
```
POST /api/items/bulk
{"action": "pause|resume|retry|remove", "ids": ["id1", "id2"]}
```

**Effort:** Medium | **Impact:** Medium

---

## GAP-4: No pagination on `/api/status` items

Backend returns the entire queue. No `offset`/`limit` on items.

**What's needed:** `GET /api/status?offset=0&limit=50` → `{items, total_count, offset, limit}`.

**Effort:** Medium | **Impact:** Medium (matters above ~100 items)

---

## GAP-5: No server-side search

No `?q=keyword` on `/api/status`.

**What's needed:** Match against item URL, output, and GID.

**Effort:** Small | **Impact:** Small

---

## GAP-6: No PATCH for individual preferences

Frontend does read-modify-write for every preference change.

**What's needed:** `PATCH /api/declaration/preferences` with `{name: value}` pairs.

**Effort:** Small | **Impact:** Medium

---

## GAP-7: No per-item error reporting in batch add

Whole batch fails if one item is invalid.

**What's needed:** Per-item results: `{results: [{url, status, error?}]}`.

**Effort:** Small | **Impact:** Small

---

## GAP-8: No retry policy configuration

No max retries, backoff, or auto-retry.

**What's needed:** Declaration preferences `max_retries`, `retry_backoff_seconds`. Item field `retry_count`. Scheduler auto-retries.

**Effort:** Medium | **Impact:** Medium

---

## GAP-9: No post-download hooks

`post_action_rule` field exists but no actions are defined or executed.

**What's needed:** Hook types: move file, run command, extract, notify. Definitions in declaration.

**Effort:** Large | **Impact:** Medium

---

## GAP-10: No webhooks

Notifications are browser-only.

**What's needed:** `GET/POST/DELETE /api/webhooks`. Backend fires HTTP POST on events.

**Effort:** Medium | **Impact:** Medium

---

## GAP-11: No transfer speed history

Speed data is ephemeral (frontend memory only).

**What's needed:** `GET /api/stats/speed?range=1h` with timestamped samples.

**Effort:** Medium | **Impact:** Small

---

## GAP-12: No authentication

All endpoints open. `Access-Control-Allow-Origin: *`.

**What's needed:** API key header, CORS restrictions, optional roles.

**Effort:** Medium | **Impact:** Medium

---

## GAP-13: No scheduling / time windows

No time-based bandwidth caps or download scheduling.

**What's needed:** Declaration rules: `{start: "22:00", end: "06:00", cap_mbps: 0}`.

**Effort:** Large | **Impact:** Medium

---

## GAP-14: No item labels / categories

No tagging or grouping.

**What's needed:** `tags` field on items, `?tag=` filter param.

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
| 5 | Server-side search | Small |
| 9 | Post-download hooks | Large |
| 10 | Webhooks | Medium |
| 11 | Speed history | Medium |
| 12 | Authentication | Medium |
| 13 | Scheduling | Large |
| 14 | Labels/categories | Medium |
