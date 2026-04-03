# Frontend Gaps — RESOLVED

All 13 frontend gaps have been wired in commit `b0437d1`.

| # | Feature | Backend endpoint | Status |
|---|---------|-----------------|--------|
| FE-1 | SSE real-time stream | `GET /api/events` | **Done** — EventSource in `init()`, fallback to polling |
| FE-2 | Server-side filtering | `GET /api/status?status=&session=` | **Done** — query params passed from `queueFilter`/`sessionFilter` |
| FE-3 | Scheduler stopping state | `state.stop_requested` | **Done** — "Stopping..." label, button disabled |
| FE-4 | Session history | `GET /api/sessions?limit=50` | **Done** — panel in Log tab |
| FE-5 | Per-session stats | `GET /api/session/stats?session_id=` | **Done** — click session to view stats |
| FE-6 | aria2 global options | `POST /api/aria2/options` | **Done** — UI in Developer tab |
| FE-7 | Configurable cleanup | `POST /api/cleanup` body params | **Done** — max age + max count inputs |
| FE-8 | Archive pagination | `GET /api/archive?limit=N` | **Done** — "Load more" button |
| FE-9 | Variable log limit | `GET /api/log?limit=N` | **Done** — dropdown (50/120/250/500) |
| FE-10 | Torrent/metalink upload | `POST /api/add` torrent_data/metalink_data | **Done** — file picker in advanced add |
| FE-11 | Per-item post_action_rule | `POST /api/add` post_action_rule field | **Done** — dropdown in advanced add |
| FE-12 | ETag / HTTP 304 | `If-None-Match` header | **Done** — `_statusETag` tracking |
| FE-13 | API self-discovery | `GET /api` | **Done** — endpoint catalog in Developer tab |
