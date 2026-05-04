# Freshness snapshot

Generated from `http://127.0.0.1:8000/api/_meta` and `http://127.0.0.1:8001/api/_meta` at 2026-05-04T20:44:58.674Z.
Do not edit by hand — run `npm run freshness:snapshot` to refresh.

| Host | Class | Method | Path | TTL (s) | Transport | Topics | Revalidate on |
|---|---|---|---|---|---|---|---|
| backend | bootstrap | GET | `/api/_meta` |  |  |  |  |
| backend | bootstrap | GET | `/api/health` |  |  |  |  |
| backend | bootstrap | GET | `/api/version` |  |  |  |  |
| backend | cold | GET | `/api/aria2/get_global_option` |  |  |  |  |
| backend | cold | GET | `/api/aria2/global_option` |  |  |  |  |
| backend | cold | GET | `/api/declaration` |  |  |  | POST /api/declaration<br>PUT /api/declaration<br>POST /api/declaration/preferences<br>PATCH /api/declaration/preferences |
| backend | live | GET | `/api/status` |  | sse | items, scheduler |  |
| backend | on-action | GET | `/api/bandwidth` |  |  |  | POST /api/bandwidth/probe |
| backend | swr | GET | `/api/downloads/archive` | 60 |  |  |  |
| backend | swr | GET | `/api/log` | 10 |  |  |  |
| backend | swr | GET | `/api/sessions` | 30 |  |  |  |
| backend | warm | GET | `/api/lifecycle` | 30 |  |  | POST /api/lifecycle/:target/:action |
| backend | warm | GET | `/api/peers` | 30 |  |  |  |
| backend | warm | GET | `/api/torrents` | 30 |  |  |  |
| dashboard | bootstrap | GET | `/api/_meta` |  |  |  |  |
| dashboard | warm | GET | `/api/discovery` | 30 |  |  |  |
| dashboard | warm | GET | `/api/web/log` | 30 |  |  |  |
