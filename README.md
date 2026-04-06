# ariaflow-web

Local dashboard frontend for `ariaflow`.

```bash
ariaflow-web --host 127.0.0.1 --port 8001
```

Expects an `ariaflow` backend at `http://127.0.0.1:8000` (configurable in UI).

## Homebrew

```bash
brew tap bonomani/ariaflow
brew install ariaflow-web
brew services start ariaflow
brew services start ariaflow-web
```

## Features

- **7 tabs:** Dashboard, Bandwidth, Service Status, Options, Log, Developer, Archive
- **Real-time:** SSE with polling fallback, exponential backoff, ETag caching
- **9 item states:** discovering, queued, waiting, active, paused, complete, error, stopped, cancelled
- **4 scheduler states:** idle, running, paused, stopping
- **Bandwidth controls:** Downlink/uplink reservation (% and absolute), probe interval
- **Torrent/metalink:** File upload via base64, file selection picker
- **Session tracking:** History and per-session stats
- **Multi-backend:** Switch between backends, Bonjour discovery
- **aria2 options:** Direct tuning of global aria2 settings
- **Browser notifications:** On download complete or failure

## Architecture

Alpine.js single-page app — no build step. See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Documentation

| File | Content |
|------|---------|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Design, data flow, preference names |
| [`ACTIONS.md`](./ACTIONS.md) | All UI actions by tab with endpoints |
| [`FRONTEND_GAPS.md`](./FRONTEND_GAPS.md) | Remaining gaps (blocked by backend) |
| `../ariaflow/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md` | Missing backend features (authoritative copy in backend repo) |
| [`RELEASE.md`](./RELEASE.md) | Release workflow |

## Release

Push to `main` auto-releases via GitHub Actions: bumps version, runs tests,
builds sdist, creates GitHub release, updates Homebrew tap.

```bash
python3 scripts/publish.py plan    # preview
python3 scripts/publish.py push    # push to main
```
