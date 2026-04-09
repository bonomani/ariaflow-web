# ariaflow-dashboard

Local dashboard frontend for `ariaflow`.

```bash
ariaflow-dashboard --host 127.0.0.1 --port 8001
```

Expects an `ariaflow` backend at `http://127.0.0.1:8000` (configurable in UI).

## Installation

### macOS (Homebrew)

```bash
brew tap bonomani/ariaflow
brew install ariaflow-dashboard   # installs ariaflow + aria2 automatically
brew services start ariaflow
brew services start ariaflow-dashboard
```

### All platforms (pip / pipx)

```bash
# 1. Install aria2 (system dependency — not a Python package)
#    macOS:   brew install aria2
#    Ubuntu:  sudo apt install aria2
#    Fedora:  sudo dnf install aria2
#    Arch:    sudo pacman -S aria2
#    Windows: winget install aria2

# 2. Install ariaflow-dashboard (dashboard only)
pipx install ariaflow-dashboard

# Or include the ariaflow backend in one command:
pipx install "ariaflow-dashboard[local]"

# 3. Start the backend, then the dashboard
ariaflow &
ariaflow-dashboard --host 127.0.0.1 --port 8001
```

### Windows

```powershell
# aria2 via winget
winget install aria2

# ariaflow + dashboard via pipx
pipx install ariaflow
pipx install ariaflow-dashboard

# Start both
Start-Process ariaflow
ariaflow-dashboard --host 127.0.0.1 --port 8001
```

### Development (git install)

```bash
git clone https://github.com/bonomani/ariaflow-dashboard.git
cd ariaflow-dashboard
pip install -e ".[dev,local]"    # editable install + test deps + backend
pytest                           # run all unit/contract tests
pytest -m slow                   # run browser tests (needs playwright)
```

The app auto-detects a git checkout (`ariaflow_dashboard.__install_mode__ == "git"`)
vs a PyPI release (`"release"`). This lets tests and dev tooling know whether
the full source tree (docs, schemas, paired repo) is available.

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
| `../ariaflow-server/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md` | Missing backend features (authoritative copy in backend repo) |
| [`RELEASE.md`](./RELEASE.md) | Release workflow |

## Release

Push to `main` auto-releases via GitHub Actions: bumps version, runs tests,
builds sdist, publishes to PyPI, creates GitHub release, updates Homebrew tap.

```bash
python3 scripts/publish.py plan    # preview
python3 scripts/publish.py push    # push to main
```
