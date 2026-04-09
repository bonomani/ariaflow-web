# Contributing to ariaflow-dashboard

## Setup

```bash
git clone https://github.com/bonomani/ariaflow-dashboard.git
cd ariaflow-dashboard
pip install -e .
```

Python >= 3.10 required. Zero dependencies.

## Common Commands

```bash
make test       # run all tests
make check      # tests + lint
make lint       # ruff linter
make format     # ruff formatter
make clean      # remove caches and temp files
```

Or directly:

```bash
python -m pytest tests/ -x -q
ruff check src/ tests/
```

## Project Structure

```
src/ariaflow_dashboard/
  __init__.py     — version
  cli.py          — CLI entry point (argparse, serve)
  webapp.py       — HTTP server, static file serving
  bonjour.py      — mDNS service discovery
  static/
    index.html    — single-page app shell
    app.js        — Alpine.js reactive logic
    style.css     — UI styling
    alpine.min.js — framework library
```

## Code Style

- **Python:** PEP 8, enforced by `ruff`
- **JavaScript:** No build step. Plain Alpine.js in `app.js`
- **Preference names** must match `ariaflow/src/aria_queue/contracts.py` exactly
- **Alpine.js reactivity:** Use spread reassignment for state updates, never deep mutation

## Commits

- One logical change per commit
- Descriptive message: what and why, not how
- Run `make check` before committing
- Don't use `git add -A`

## Pull Requests

- Branch from `main`
- All tests must pass
- Update docs if behavior changes

## Release

Push to `main` triggers auto-release. Or use the helper:

```bash
python3 scripts/publish.py plan   # preview
python3 scripts/publish.py push   # push + auto-release
```

See [`RELEASE.md`](./RELEASE.md) for details.
