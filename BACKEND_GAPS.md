# Backend Gaps

Features the frontend would benefit from but the backend doesn't provide yet.

---

### BG-1: SSE pushes rev-only

`_invalidate_status_cache()` publishes `{rev, server_version}` only.
Frontend must fetch full status after each event.

### BG-2: No PATCH for preferences

Frontend does GET→merge→POST. Backend should support
`PATCH /api/declaration/preferences` for atomic updates.

---

## Backend Endpoint Inventory

**21 GET:** `/api`, `/api/health`, `/api/status`, `/api/events`, `/api/scheduler`,
`/api/bandwidth`, `/api/declaration`, `/api/lifecycle`, `/api/log`, `/api/archive`,
`/api/sessions`, `/api/session/stats`, `/api/item/{id}/files`, `/api/torrents`,
`/api/torrents/{infohash}.torrent`, `/api/aria2/get_global_option`,
`/api/aria2/get_option`, `/api/aria2/option_tiers`,
`/api/docs`, `/api/openapi.yaml`, `/api/tests`

**20 POST:** `/api/add`, `/api/scheduler/start`, `/api/scheduler/stop`,
`/api/scheduler/pause`, `/api/scheduler/resume`, `/api/session`,
`/api/declaration`, `/api/cleanup`, `/api/bandwidth/probe`, `/api/preflight`,
`/api/ucc`, `/api/lifecycle/action`, `/api/aria2/change_global_option`,
`/api/aria2/change_option`, `/api/aria2/set_limits`,
`/api/item/{id}/pause`, `/api/item/{id}/resume`, `/api/item/{id}/remove`,
`/api/item/{id}/retry`, `/api/item/{id}/priority`,
`/api/item/{id}/files`, `/api/torrents/{infohash}/stop`
