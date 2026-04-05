# Frontend Gaps

Remaining issues — features the backend provides but the frontend doesn't expose.

---

### FE-12: 22 backend response fields not consumed

Backend returns fields the frontend ignores. Grouped by endpoint:

**`/api/status` (items):**
- `allowed_actions` — could dynamically enable/disable action buttons
- `distribute_status`, `distribute_infohash` — seeding status per item
- `error_code` — only `error_message` is displayed
- `live_status` — only normalized status shown
- `paused_at` — timestamp not displayed

**`/api/bandwidth`:**
- `current_limit` — raw bytes/sec limit
- `down_cap_mbps`, `up_cap_mbps` — separate up/down caps (only `cap_mbps` used)
- `responsiveness_rpm` — network quality metric

**`/api/lifecycle`, `/api/log`:**
- `observation` — only outcome/reason shown

**`/api/sessions` + `/api/sessions/stats`:**
- `items_total`, `items_done`, `items_error`, `items_queued`, `items_active`, `bytes_completed` — session stats not displayed

**`/api/torrents`:**
- `seed_gid` — GID not shown in torrent panel

Full list tracked in `test_api_params.py::TestBackendFieldCoverage::KNOWN_UNUSED`.

---

## Resolved

| What | When |
|------|------|
| Broken scheduler endpoints (/api/run → /api/scheduler/*) | Phase 1 |
| Broken aria2 endpoint (/api/aria2/options → change_global_option) | Phase 1 |
| Item priority (move to top) | Phase 2 (removed — backend dropped endpoint) |
| 9 missing preferences (retry + distribution) | Phase 3 |
| Bonjour discovery (_ariaflow._tcp, multi-platform) | Earlier |
| FE-6: Endpoint paths renamed (API v2) | Phase 4 |
| FE-7: SSE full payload | Phase 5 |
| FE-8: PATCH preferences | Phase 3 |
| FE-9: moveToTop removed | Phase 4 |
| FE-3: Torrent distribution UI | Phase 6 |
| FE-4: Per-download aria2 option editing | Phase 6 |
| FE-5: aria2 set_limits | Phase 6 |
| FE-10: New Session button | Phase 1 v3 |
| FE-11: Download .torrent file | Phase 1 v3 |
