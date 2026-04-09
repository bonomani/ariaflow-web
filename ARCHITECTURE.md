# ariaflow-dashboard Architecture

## 1. Overview

`ariaflow-dashboard` is the browser UI for `ariaflow`.
It reads the backend API, renders engine state, and sends user actions back.
It does not own engine truth.

## 2. Technology

- **Framework:** Alpine.js — single `Alpine.data('ariaflow', ...)` on `<body>`
- **Rendering:** Reactive DOM patching via `x-text`, `x-show`, `:class`, `x-for`
- **No build step:** Plain JS + HTML, no bundler
- **State:** One flat object with computed getters. All state derives from `lastStatus`
- **HTML assembly:** `index.html` is split into `_fragments/header.html` + 7 `tab_*.html` files. `webapp.py` expands `<!--INCLUDE:-->` markers at startup via `_expand_includes()`, so the browser receives a single merged page.

## 3. Data Flow

```
Backend API → _fetch() / SSE → this.lastStatus → Alpine re-renders DOM
User click → handler → POST → SSE push or polling updates state
```

### Timer model

Polling cadence is driven by a single `LOADERS` manifest in `app.js`.
Each entry declares `{fn, k}` where the effective interval is `k * refreshInterval`.
`_refreshAll()` fires every loader (used on init, resume, and backend switch).
`_refreshTabOnly()` fires only the current tab's loaders (used by `navigateTo`).

### Real-time updates

1. **SSE primary:** `EventSource` to `GET /api/events` (rev-only events currently)
2. **Polling fallback:** configurable interval (1.5s–30s), 2s debounce on SSE disconnect
3. **ETag caching:** `If-None-Match` header, skip on 304
4. **Revision skip:** `_rev` field avoids unnecessary DOM updates
5. **Exponential backoff:** polling interval doubles on failures (cap 60s), resets on success
6. **Failure dampening:** offline shown only after 3 consecutive failures

### Optimistic UI

Item actions snapshot state, update immediately via spread reassignment
(Alpine-safe), rollback on API failure. Fetch wrapped in try/catch for
timeout/network errors.

### Preference writes

Debounced read-modify-write: queue changes → 400ms → GET declaration → merge → POST.
Preference names match `ariaflow/src/aria_queue/contracts.py` exactly.

## 4. Item States (from backend)

9 states: `discovering`, `queued`, `waiting`, `active`, `paused`,
`complete`, `error`, `stopped`, `cancelled`.

Display mapping: `active` → "downloading", `complete` → "done", `waiting` → "waiting".

## 5. Scheduler States (from backend)

4 states: `idle`, `running`, `paused`, `stop_requested` (shown as "stopping").

## 6. UI Pages

| Page | Route | Data source |
|------|-------|-------------|
| Dashboard | `/` | `GET /api/status` |
| Bandwidth | `/bandwidth` | `GET /api/declaration` |
| Service Status | `/lifecycle` | `GET /api/lifecycle` |
| Options | `/options` | `GET /api/declaration` |
| Log | `/log` | `GET /api/log`, `/api/sessions`, `/api/sessions/stats` |
| Developer | `/dev` | `GET /api/tests`, `/api`, `POST /api/aria2/change_global_option` |
| Archive | `/archive` | `GET /api/downloads/archive` |

## 7. Backend Preferences (declaration)

| Name | Default | Tab |
|------|---------|-----|
| `auto_preflight_on_run` | false | Options |
| `post_action_rule` | "pending" | Options |
| `duplicate_active_transfer_action` | "remove" | Bandwidth |
| `max_simultaneous_downloads` | 1 | Bandwidth |
| `bandwidth_down_free_percent` | 20 | Bandwidth |
| `bandwidth_down_free_absolute_mbps` | 0 | Bandwidth |
| `bandwidth_up_free_percent` | 50 | Bandwidth |
| `bandwidth_up_free_absolute_mbps` | 0 | Bandwidth |
| `bandwidth_probe_interval_seconds` | 180 | Bandwidth |

## 8. Backend Selection

- Default: `http://127.0.0.1:8000`
- Selected backend in localStorage
- Bonjour discovery merges found backends
- SSE reconnects on backend switch

## 9. CSS Design System

CSS uses a unified xs/sm/md/lg/xl token scale across 4 axes (radius, gap, pad, font) plus 7 composable design axes as utility classes: emphasis, status, shape, state, elevation, density, breakpoint.

Nav tabs follow a Material style (text label + accent underline) with per-tab badges. The filter bar reuses the same pattern in a compact variant.

## 10. Packaging & Install Mode

`__install_mode__` in `__init__.py` detects whether the package was installed from git (editable/dev) or from a release (PyPI). The release GitHub Actions workflow includes a PyPI publishing step.

## 11. Design Rules

- Backend owns truth. UI owns presentation.
- Do not duplicate backend state in browser.
- Show backend failure states clearly.
- Keep debug near the object it explains.
- Preference names must match `contracts.py` exactly.
