# Frontend Gaps

Remaining issues — features the backend provides but the frontend doesn't expose.

---

*No open gaps — all backend response fields are now consumed by the frontend.*

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
| FE-10: New Session button | Phase 10 |
| FE-11: Download .torrent file | Phase 10 |
| FE-12: 22 unused backend fields wired | Phase 12 |
