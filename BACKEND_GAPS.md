# Backend Gaps

> **AI Agent Directive:** This file documents features the **backend** (`ariaflow`)
> must implement. The frontend repo (`ariaflow-web`) must **never** implement
> backend logic — only consume APIs. If you are an AI agent working on
> `ariaflow-web`, treat every item below as **blocked/out-of-scope**. If you are
> an AI agent working on `ariaflow`, treat each item as an actionable task.

---

*No open gaps — all previously identified gaps have been resolved.*

---

## Resolved

| ID | What | Resolution |
|----|------|------------|
| BG-1 | SSE pushed rev-only | SSE now pushes full payload (items, state, summary) |
| BG-2 | No PATCH for preferences | `PATCH /api/declaration/preferences` added |

---

## Backend Endpoint Inventory (current)

**27 GET:**
`/api`, `/api/health`, `/api/status`, `/api/events`, `/api/scheduler`,
`/api/bandwidth`, `/api/declaration`, `/api/lifecycle`, `/api/log`,
`/api/downloads/archive`, `/api/sessions`, `/api/sessions/stats`,
`/api/downloads/{id}/files`, `/api/torrents`, `/api/torrents/{infohash}.torrent`,
`/api/aria2/get_global_option`, `/api/aria2/get_option`, `/api/aria2/option_tiers`,
`/api/docs`, `/api/openapi.yaml`, `/api/tests`

**14 POST:**
`/api/downloads/add`, `/api/scheduler/start`, `/api/scheduler/stop`,
`/api/scheduler/pause`, `/api/scheduler/resume`, `/api/scheduler/preflight`,
`/api/scheduler/ucc`, `/api/sessions/new`, `/api/declaration`,
`/api/downloads/cleanup`, `/api/bandwidth/probe`,
`/api/aria2/change_global_option`, `/api/aria2/change_option`,
`/api/aria2/set_limits`, `/api/downloads/{id}/pause`,
`/api/downloads/{id}/resume`, `/api/downloads/{id}/remove`,
`/api/downloads/{id}/retry`, `/api/downloads/{id}/files`,
`/api/lifecycle/{target}/{action}`, `/api/torrents/{infohash}/stop`

**1 PATCH:**
`/api/declaration/preferences`
