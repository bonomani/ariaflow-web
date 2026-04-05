# Frontend Gaps

Remaining issues — features the backend provides but the frontend doesn't expose.

---

### FE-1: SSE receives rev-only

**Blocked by:** Backend SSE full payload push

### FE-2: Preference writes use read-modify-write

**Blocked by:** Backend PATCH endpoint

### FE-3: Torrent distribution UI missing

Backend has: `GET /api/torrents`, `GET /api/torrents/{infohash}.torrent`,
`POST /api/torrents/{infohash}/stop`. No frontend panel for listing/stopping seeds.

### FE-4: aria2 per-download options (`POST /api/aria2/change_option`)

Backend supports changing options per-GID. Frontend only reads them.

### FE-5: aria2 set_limits (`POST /api/aria2/set_limits`)

Dedicated endpoint for speed/seed limits. Frontend uses change_global_option instead.

---

## Resolved

| What | When |
|------|------|
| Broken scheduler endpoints (/api/run → /api/scheduler/*) | Phase 1 |
| Broken aria2 endpoint (/api/aria2/options → change_global_option) | Phase 1 |
| Item priority (move to top) | Phase 2 |
| 9 missing preferences (retry + distribution) | Phase 3 |
| Bonjour discovery (_ariaflow._tcp, multi-platform) | Earlier |
