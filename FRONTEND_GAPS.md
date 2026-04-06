# Frontend Gaps

## Open

### FE-13: 18 backend fields not displayed

Auto-discovered by `tests/test_api_params.py::TestBackendFieldCoverage` after
the field coverage test was switched to auto-discover from `openapi.yaml`.
These fields are currently in `KNOWN_UNUSED` with reasons:

| Field | Source | Reason |
|-------|--------|--------|
| `endpoints` | `/api` | API catalog not displayed |
| `cap_bytes_per_sec`, `last_probe`, `last_probe_at` | `/api/bandwidth` | Probe diagnostics not shown |
| `updated_at` | `/api/declaration` | Declaration mtime not displayed |
| `bytes_received_total`, `bytes_sent_total`, `errors_total`, `requests_total`, `sse_clients`, `uptime_seconds` | `/api/health` | Server metrics not displayed |
| `homebrew` | `/api/lifecycle` | Homebrew provider details not displayed |
| `bytes_downloaded`, `bytes_uploaded` | `/api/sessions/stats` | We show `bytes_completed` instead |
| `returncode`, `stderr`, `stdout` | `/api/tests` | Summary only, not raw subprocess output |
| `active_url` | `EngineState` component | Per-item URL shown instead |

**Priority:** low — these are diagnostic/meta fields, no critical data loss.
Each is documented in `KNOWN_UNUSED` in `test_api_params.py`.

**Blocked by:** nothing (frontend-only work).

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
| FE-7: SSE full payload (paired with BG-1) | Phase 5 |
| FE-8: PATCH preferences (paired with BG-2) | Phase 3 |
| FE-9: moveToTop removed | Phase 4 |
| FE-3: Torrent distribution UI | Phase 6 |
| FE-4: Per-download aria2 option editing | Phase 6 |
| FE-5: aria2 set_limits | Phase 6 |
| FE-10: New Session button | Phase 10 |
| FE-11: Download .torrent file | Phase 10 |
| FE-12: 22 unused backend fields wired | Phase 12 |
