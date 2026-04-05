# Frontend Gaps

Remaining issues — features the backend provides but the frontend doesn't expose.

---

### FE-1: SSE receives rev-only, needs extra fetch

SSE event only contains `{rev, server_version}`. Frontend must call `refresh()` per event.

**Blocked by:** Backend SSE full payload push

### FE-2: Preference writes use read-modify-write

`_flushPrefQueue()` does GET → merge → POST. Race-prone with multiple tabs.

**Blocked by:** Backend PATCH endpoint

### FE-3: 9 new preferences not exposed

Backend has retry + distribution preferences not in the UI:
`max_retries`, `retry_backoff_seconds`, `aria2_max_tries`, `aria2_retry_wait`,
`internal_tracker_url`, `distribute_completed_downloads`, `distribute_seed_ratio`,
`distribute_max_seed_hours`, `distribute_max_active_seeds`

### FE-4: Torrent distribution UI missing

Backend has: `GET /api/torrents`, `GET /api/torrents/{infohash}.torrent`,
`POST /api/torrents/{infohash}/stop`. No frontend UI for listing/stopping seeds.

### FE-5: Item priority endpoint available but not wired

Backend now has `POST /api/item/{id}/priority`. Could re-add move-to-top button.

---

## Resolved

| Commit | What |
|--------|------|
| Latest | Fixed broken scheduler endpoints (/api/run → /api/scheduler/start|stop) |
| Latest | Fixed /api/aria2/options → /api/aria2/change_global_option |
| Latest | Aligned Bonjour discovery (_ariaflow._tcp, multi-platform) |
