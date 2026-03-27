# ariaflow-web

Local dashboard frontend for `ariaflow`.

It expects an `ariaflow` backend running on the same machine, reachable via:

```bash
ARIAFLOW_API_URL=http://127.0.0.1:8000
```

## Run

```bash
ariaflow-web --host 127.0.0.1 --port 8001
```

## Homebrew

When installed from the tap, the service is intended to run alongside the
`ariaflow` backend:

```bash
brew services start ariaflow
brew services start ariaflow-web
```

Stable GitHub releases now update `bonomani/homebrew-ariaflow/Formula/ariaflow-web.rb`
automatically. The generated formula also depends on `ariaflow`, so a fresh
`brew install ariaflow-web` pulls in the backend package.

## Architecture

The canonical UI architecture is documented in:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Release

The release checklist lives in:

- [`RELEASE.md`](./RELEASE.md)

Prefer the helper:

```bash
python3 scripts/publish.py plan
python3 scripts/publish.py push
```
