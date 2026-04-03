# Frontend Gaps

Remaining issues in `app.js` and `index.html` after all wiring work.
Based on a fresh scan of the current codebase.

---

## Blocked by Backend

These cannot be fixed without backend changes.

### FE-1: Move-to-top calls non-existent endpoint

`moveToTop()` (line 1021) calls `POST /api/item/{id}/priority`.
Backend `_post_item_action` only handles `pause|resume|remove|retry` — returns 400.

**Blocked by:** Backend GAP-1

### FE-2: SSE receives rev-only, needs extra fetch

SSE `state_changed` event only contains `{rev, server_version}`.
The frontend (line 754) must call `refresh()` on each event — one extra round-trip.

**Blocked by:** Backend GAP-2

### FE-3: Preference writes use read-modify-write

`_flushPrefQueue()` (line 880) does `GET /api/declaration` → merge → `POST` for every preference change. Race-prone with multiple tabs.

**Blocked by:** Backend GAP-6 (PATCH endpoint needed)

### FE-4: No bulk action UI

No "Retry all errors" or "Remove all done" buttons.
Each item action is a separate POST call.

**Blocked by:** Backend GAP-3

### FE-5: No pagination UI

All queue items loaded at once. Backend doesn't support `offset`/`limit` on `/api/status`.

**Blocked by:** Backend GAP-4

### FE-6: Speed sparklines lost on reload

`speedHistory` and `globalSpeedHistory` are in-memory only.

**Blocked by:** Backend GAP-11

---

## Frontend-only Issues

These can be fixed without backend changes.

### FE-7: No abort/timeout recovery on itemAction

`itemAction()` (line 1031) has no abort mechanism. If the fetch hangs,
the optimistic UI stays diverged from backend indefinitely.

**Fix:** Add timeout or abort controller. On timeout, rollback + show error.

### FE-8: No exponential backoff on failures

`_consecutiveFailures` counter (line 802) triggers offline state after 3 failures
but polling continues at the same interval. Should back off.

**Fix:** Increase polling interval on consecutive failures, reset on success.

### FE-9: SSE/polling overlap during reconnection

When SSE disconnects (line 773), polling resumes. When SSE reconnects (line 747),
polling stops. During the transition, both can run simultaneously.

**Fix:** Add a small delay before resuming polling, or use a single timer that
checks SSE state before fetching.

### FE-10: Silent error swallowing

Multiple `.catch(() => {})` suppress errors (lines 291, 307, 318).
`discoverBackends()`, `loadDeclaration()` failures are invisible to the user.

**Fix:** Log to console or show a transient status message on failure.

---

## Summary

| # | Gap | Type | Severity |
|---|-----|------|----------|
| 1 | Move-to-top broken | Backend blocked | Critical |
| 2 | SSE rev-only | Backend blocked | High |
| 3 | RMW preferences | Backend blocked | Medium |
| 4 | No bulk actions | Backend blocked | Medium |
| 5 | No pagination | Backend blocked | Medium |
| 6 | Sparklines ephemeral | Backend blocked | Low |
| 7 | No itemAction timeout | Frontend fix | Medium |
| 8 | No backoff on failures | Frontend fix | Low |
| 9 | SSE/polling overlap | Frontend fix | Low |
| 10 | Silent error swallowing | Frontend fix | Low |
