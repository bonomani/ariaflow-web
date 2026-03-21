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
