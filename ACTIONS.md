# ariaflow-web — Actionable Elements Reference

Complete inventory of all triggers in the UI.

---

## Internal / Automatic Triggers

| Trigger | When | Endpoint |
|---------|------|----------|
| `init()` | Page load | varies |
| `_initSSE()` | init + backend switch | `GET /api/events` |
| `popstate` | Browser back/forward | varies via `_loadPageData()` |
| Polling (`refresh()`) | Fallback every N seconds | `GET /api/status` (with ETag, backoff) |
| Health check | SSE error fallback | `GET /api/health` |
| `loadScheduler()` | On dashboard load | `GET /api/scheduler` |
| `refreshBandwidth()` | On bandwidth page | `GET /api/bandwidth` |
| `_flushPrefQueue()` | 400ms after pref change | `PATCH /api/declaration/preferences` |
| `discoverBackends()` | 2s after init | `GET /api/discovery` |
| `checkNotifications()` | Every status update | Browser Notification API |
| `recordSpeed()` / `recordGlobalSpeed()` | Every status update | — (in-memory sparklines) |

### Data loaded per page

| Page | Calls |
|------|-------|
| dashboard | `refresh()`, `loadDeclaration()` |
| bandwidth | `loadDeclaration()` |
| lifecycle | `loadLifecycle()` |
| options | `loadDeclaration()`, `loadAria2Options()`, `loadTorrents()` |
| log | `loadDeclaration()`, `refreshActionLog()`, `loadSessionHistory()` |
| dev | `loadApiDiscovery()` |
| archive | `loadArchive()` |

---

## Global

| Element | Handler | Endpoint |
|---------|---------|----------|
| Tab links (7) | `navigateTo(target)` | — |
| Refresh interval | `setRefreshInterval($el.value)` | — (localStorage) |
| Theme toggle | `toggleTheme()` | — (localStorage) |
| Add backend | `addBackend()` | — (localStorage + SSE reconnect) |
| Select backend | `selectBackend(backend)` | — (localStorage + `_initSSE()` + `deferRefresh()`) |
| Remove backend | `removeBackend(backend)` | — (localStorage + `deferRefresh()`) |

---

## Dashboard

### Queue Controls

| Element | Handler | Endpoint |
|---------|---------|----------|
| Add URLs | `add()` | `POST /api/downloads/add` |
| Start / Stop scheduler | `toggleScheduler()` | `POST /api/scheduler/resume` or `/api/scheduler/pause` |
| Pause / Resume queue | `schedulerAction(action)` | `POST /api/scheduler/pause` or `/api/scheduler/resume` |
| New session | `newSession()` | `POST /api/sessions/new` |
| Cleanup | `cleanup()` | `POST /api/downloads/cleanup` |

### Per-Item Actions

| Element | Handler | Endpoint |
|---------|---------|----------|
| Pause | `itemAction(id, 'pause')` | `POST /api/downloads/{id}/pause` |
| Dequeue | `itemAction(id, 'pause')` | `POST /api/downloads/{id}/pause` |
| Resume | `itemAction(id, 'resume')` | `POST /api/downloads/{id}/resume` |
| Retry | `itemAction(id, 'retry')` | `POST /api/downloads/{id}/retry` |
| Remove | `itemAction(id, 'remove')` | `POST /api/downloads/{id}/remove` |
| File select (open) | `openFileSelection(id)` | `GET /api/downloads/{id}/files` |
| File select (save) | `saveFileSelection()` | `POST /api/downloads/{id}/files` |
| File select (close) | `closeFileSelection()` | — |

### Filtering & Search

| Element | Handler | Notes |
|---------|---------|-------|
| Filter chips | `setQueueFilter(f)` | `?status=` mapped to backend names |
| Search input | `x-model="queueSearch"` | client-side |

---

## Bandwidth

| Element | Handler | Preference |
|---------|---------|------------|
| Run probe | `runProbe()` | `POST /api/bandwidth/probe` |
| Downlink free (%) | `setBandwidthPref(...)` | `bandwidth_down_free_percent` |
| Downlink free (abs) | `setBandwidthPref(...)` | `bandwidth_down_free_absolute_mbps` |
| Uplink free (%) | `setBandwidthPref(...)` | `bandwidth_up_free_percent` |
| Uplink free (abs) | `setBandwidthPref(...)` | `bandwidth_up_free_absolute_mbps` |
| Probe interval | `setBandwidthPref(...)` | `bandwidth_probe_interval_seconds` |
| Simultaneous downloads | `setSimultaneousLimit(...)` | `max_simultaneous_downloads` |
| Duplicate transfer | `setDuplicateAction(...)` | `duplicate_active_transfer_action` |

---

## Service Status

| Element | Handler | Endpoint |
|---------|---------|----------|
| Refresh | `loadLifecycle()` | `GET /api/lifecycle` |
| Install/Update ariaflow | `lifecycleAction(...)` | `POST /api/lifecycle/ariaflow/install` |
| Remove ariaflow | `lifecycleAction(...)` | `POST /api/lifecycle/ariaflow/uninstall` |
| Load aria2 autostart | `lifecycleAction(...)` | `POST /api/lifecycle/aria2-launchd/install` |
| Unload aria2 autostart | `lifecycleAction(...)` | `POST /api/lifecycle/aria2-launchd/uninstall` |

---

## Options

| Element | Handler | Preference |
|---------|---------|------------|
| Auto preflight | `setAutoPreflightPreference(...)` | `auto_preflight_on_run` |
| Post-action rule | `setPostActionRule(...)` | `post_action_rule` |
| Max retries | `setRetryPref(...)` | `max_retries` |
| Retry backoff | `setRetryPref(...)` | `retry_backoff_seconds` |
| aria2 max tries | `setRetryPref(...)` | `aria2_max_tries` |
| aria2 retry wait | `setRetryPref(...)` | `aria2_retry_wait` |
| Distribute enabled | `setDistributePref(...)` | `distribute_completed_downloads` |
| Seed ratio | `setDistributePref(...)` | `distribute_seed_ratio` |
| Max seed hours | `setDistributePref(...)` | `distribute_max_seed_hours` |
| Max active seeds | `setDistributePref(...)` | `distribute_max_active_seeds` |
| Tracker URL | `setDistributePref(...)` | `internal_tracker_url` |

### aria2 Options (Options tab)

| Element | Handler | Endpoint |
|---------|---------|----------|
| Load global options | `loadAria2Options()` | `GET /api/aria2/get_global_option` |
| Load option tiers | `loadAria2Options()` | `GET /api/aria2/option_tiers` |
| Set global option | `setAria2Option()` | `POST /api/aria2/change_global_option` |
| Set per-item option | `setItemAria2Option()` | `POST /api/aria2/change_option` |
| Set limits | `setAria2Limits()` | `POST /api/aria2/set_limits` |
| Load per-item options | `loadItemOptions(gid)` | `GET /api/aria2/get_option?gid=X` |

### Active Seeds (Options tab, when distribution enabled)

| Element | Handler | Endpoint |
|---------|---------|----------|
| Load torrents | `loadTorrents()` | `GET /api/torrents` |
| Stop seeding | `stopTorrent(infohash)` | `POST /api/torrents/{infohash}/stop` |
| Download .torrent | link | `GET /api/torrents/{infohash}.torrent` |

---

## Log

| Element | Handler | Endpoint |
|---------|---------|----------|
| Run contract | `uccRun()` | `POST /api/scheduler/ucc` |
| Preflight | `preflightRun()` | `POST /api/scheduler/preflight` |
| Action filter | `refreshActionLog()` | — (client-side) |
| Target filter | `refreshActionLog()` | — (client-side) |
| Session filter | `refreshActionLog()` | — (client-side) |
| Log limit | `refreshActionLog()` | `GET /api/log?limit=N` |
| Load declaration | `loadDeclaration(true)` | `GET /api/declaration` |
| Save declaration | `saveDeclaration()` | `POST /api/declaration` |
| Session history | auto-loaded | `GET /api/sessions?limit=50` |
| Session stats | `loadSessionStats(id)` | `GET /api/sessions/stats?session_id=X` |

---

## Developer

| Element | Handler | Endpoint |
|---------|---------|----------|
| Swagger UI | `openDocs()` | opens `{backend}/api/docs` |
| OpenAPI spec | `openSpec()` | opens `{backend}/api/openapi.yaml` |
| Run tests | `runTests()` | `GET /api/tests` |
| API catalog | auto-loaded | `GET /api` |

---

## Archive

| Element | Handler | Endpoint |
|---------|---------|----------|
| Auto-load | `loadArchive()` | `GET /api/downloads/archive?limit=N` |
| Load more | `loadMoreArchive()` | `GET /api/downloads/archive?limit=N` |

---

## Add Form (Advanced Options)

| Element | Binding | Sent in `POST /api/downloads/add` |
|---------|---------|-----------------------------------|
| URL textarea | `x-model="urlInput"` | `items[].url` |
| Output filename | `x-model="addOutput"` | `items[].output` |
| Priority | `x-model="addPriority"` | `items[].priority` |
| Mirrors | `x-model="addMirrors"` | `items[].mirrors` |
| .torrent file | `handleFileUpload($event, 'torrent')` | `items[].torrent_data` (base64) |
| .metalink file | `handleFileUpload($event, 'metalink')` | `items[].metalink_data` (base64) |
| Post-action rule | `x-model="addPostActionRule"` | `items[].post_action_rule` |

---

## Dropped Features

| Feature | Reason |
|---------|--------|
| Move to top button | Backend removed `/api/item/{id}/priority` |
| Bandwidth floor input | `bandwidth_floor_mbps` preference does not exist in backend |
