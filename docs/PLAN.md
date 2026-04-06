# Plan

## Goal

Make backend discovery feel instant, clean, honest, and verifiable.

Three independent problems solved by one coordinated change:

- **Instant display**: no 2-6s wait to see the local backend; never show `127.0.0.1` for self
- **No duplicates**: the local backend appears exactly once in the dropdown
- **Explicit Bonjour health signal**: distinguish "mDNS broken" from "no peers found"

---

## Phase 1: Instant LAN IP display (no Bonjour wait)

Already implemented in `webapp.py` via `local_identity()` injection. Just surface it in `backendDisplayName`.

### 1a — Restore IP in parens for the selector

`backendDisplayName(url)` should always return `hostname (host:port)` or `name (host:port)`:

- **Default backend**: `bcs-Mac-mini (192.168.1.10:8000)` — hostname from `window.__ARIAFLOW_WEB_HOSTNAME__`, IP from `window.__ARIAFLOW_WEB_LOCAL_MAIN_IP__` (Google UDP trick at page load, ~1ms)
- **Discovered backend** (Bonjour metadata present): `bc's Mac AriaFlow (192.168.2.15:8000)` — name from `backendMeta[url].name` (strip `(N)` suffix), address from URL host
- **Manual URL** (no metadata): `192.168.1.20:8000` — just the URL's host
- **Edge case**: 0 interfaces → default falls back to `bcs-Mac-mini (127.0.0.1:8000)`

No changes to webapp.py — globals already injected.

---

## Phase 2: Skip self-discoveries from the dropdown

### 2a — Expose local hostname to the frontend

Already done: `window.__ARIAFLOW_WEB_HOSTNAME__` contains the short hostname. Also expose the `.local` form for matching Bonjour records: inject `window.__ARIAFLOW_WEB_LOCAL_DOT_LOCAL__` = `"<hostname>.local"`.

### 2b — Filter self-entries in `mergeDiscoveredBackends`

In the filter step, drop any discovered item whose:
- `host` field equals `local_hostname() + ".local"` (case-insensitive), OR
- `ip` field is in `window.__ARIAFLOW_WEB_LOCAL_IPS__`, OR
- URL resolves to a loopback address

Still store these in `backendMeta` for their presence to count as "Bonjour verified" (see Phase 3), but don't add their URLs to `backends`.

### 2c — Edge case: multi-interface peer dedup

When Bonjour finds the same remote instance on multiple interfaces (happens with `avahi-browse -rpt` on Linux), we currently add both. Dedupe by instance name: keep only the first occurrence per `backendMeta.name`. User sees one entry per remote machine.

---

## Phase 3: Explicit Bonjour health indicator

### 3a — New Alpine state

- `bonjourState: 'pending' | 'ok' | 'broken' | 'unavailable'`
  - `'pending'` — initial state, discovery hasn't completed yet (the 2s defer window)
  - `'ok'` — discovery returned ≥1 item (self or remote), mDNS stack works
  - `'broken'` — discovery ran, returned 0 items, but `available: true` from the backend (stack exists, found nothing)
  - `'unavailable'` — discovery returned `available: false` (no dns-sd/avahi on this machine)

### 3b — Update in `discoverBackends`

After `data = await r.json()`:
- `data.available === false` → `bonjourState = 'unavailable'`
- `data.items.length === 0` → `bonjourState = 'broken'`
- `data.items.length > 0` → `bonjourState = 'ok'`

### 3c — UI indicator

Replace the current two chips (`No backend discovered (local fallback)` / `Discovered N backend services`) with a single mDNS chip:

| State | Display | Color |
|-------|---------|-------|
| `pending` | `mDNS …` | neutral |
| `ok` | `mDNS ✓` | good (green) |
| `broken` | `mDNS ✗` | warn |
| `unavailable` | `mDNS N/A` | muted |

Tooltip on hover explains what the state means.

The separate "Discovered N backends" text, if wanted, can stay as a smaller muted line below showing the count of *remote* entries (excluding self).

---

## Phase 4: System Info interface list (already done in previous phase)

The `<details>` System Info block already lists all local IPs from `window.__ARIAFLOW_WEB_LOCAL_IPS__` with a `main` badge on `window.__ARIAFLOW_WEB_LOCAL_MAIN_IP__`. No changes needed.

Verify:
- 0 interfaces → list shows `127.0.0.1 main` only (fallback)
- 1 interface → one chip, marked `main`
- 2+ interfaces → all chips, one marked `main`

---

## Phase 5: Verify

- Run fast tests (96 expected)
- Run mypy clean
- Manually verify on macOS:
  - Dropdown shows `bcs-Mac-mini (192.168.1.10:8000)` immediately on page load
  - After 2-3s, `mDNS ✓` badge appears
  - Dropdown has no duplicate entries from Bonjour self-discovery
  - System Info lists all interfaces with `main` badge on primary
