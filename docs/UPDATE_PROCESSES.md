# Update Processes — Complete Reference

> Detailed map of every update path in the ariaflow ecosystem: who triggers
> what, which code runs where, what shell command actually executes, and
> what historical bugs (BG-XX) shaped the current behavior.
>
> Three update targets are managed: **ariaflow-dashboard** (this repo,
> Python host + TS bundle), **ariaflow-server** (paired Node backend),
> and **aria2** (third-party download engine). Each has manual and
> automatic paths.

## Table of Contents

1. [Overview map](#1-overview-map)
2. [The two orthogonal axes](#2-the-two-orthogonal-axes-managed-by--installed-via)
3. [Update target #1 — ariaflow-dashboard](#3-update-target-1--ariaflow-dashboard)
4. [Update target #2 — ariaflow-server](#4-update-target-2--ariaflow-server)
5. [Update target #3 — aria2](#5-update-target-3--aria2)
6. [The shell chain — anatomy and history](#6-the-shell-chain--anatomy-and-history)
7. [Restart vs Update vs Recover — semantic distinction](#7-restart-vs-update-vs-recover--semantic-distinction)
8. [Smart Update probe-first short-circuit](#8-smart-update-probe-first-short-circuit)
9. [Auto-update poller (both sides)](#9-auto-update-poller-both-sides)
10. [Frontend orchestration (TS bundle)](#10-frontend-orchestration-ts-bundle)
11. [Action log entries reference](#11-action-log-entries-reference)
12. [Backend gaps history (BG series)](#12-backend-gaps-history-bg-series)
13. [Failure modes catalog](#13-failure-modes-catalog)
14. [What's NOT done by these update paths](#14-whats-not-done-by-these-update-paths)

---

## 1. Overview map

```
                         ┌──────────────────────────────────┐
                         │   Browser (TS bundle, app.ts)    │
                         └──┬──────────────────────┬────────┘
                            │                      │
                            │ /api/web/lifecycle/*  │ /api/lifecycle/*
                            ▼                      ▼
       ┌────────────────────────┐     ┌─────────────────────────────┐
       │  Python host (webapp.py)│     │  ariaflow-server (Node)      │
       │                          │     │                              │
       │  ┌────────────────────┐ │     │ ┌──────────────────────────┐ │
       │  │ install_self.py    │ │     │ │ _lifecycle_actions.ts    │ │
       │  │  • check_for_update│ │     │ │  • dispatchAriaflow      │ │
       │  │  • dispatch_update │ │     │ │       CheckUpdate        │ │
       │  │  • dispatch_restart│ │     │ │  • dispatchAriaflow      │ │
       │  │  • dispatch_server │ │     │ │       Update             │ │
       │  │       _lifecycle   │ │     │ │  • dispatchAriaflow      │ │
       │  │  • _chain_restart  │ │     │ │       Restart            │ │
       │  └────────────────────┘ │     │ │  • dispatchAria2Update   │ │
       │                          │     │ └──────────────────────────┘ │
       │  ┌────────────────────┐ │     │                              │
       │  │ auto_update.py     │ │     │ ┌──────────────────────────┐ │
       │  │  • _poller_loop    │ │     │ │ _auto_update_controller  │ │
       │  │  • _run_check_once │ │     │ │  • createAutoUpdate      │ │
       │  │  • trigger_server_ │ │     │ │       Controller         │ │
       │  │       update       │ │     │ │  • brewOutdated          │ │
       │  └────────────────────┘ │     │ │  • applyUpdate           │ │
       │                          │     │ └──────────────────────────┘ │
       │   shells out to:         │     │                              │
       │   brew / pipx / launchctl│     │ ┌──────────────────────────┐ │
       │                          │     │ │ install/restart_chain.ts │ │
       │                          │     │ │  • buildPostUpgrade      │ │
       │                          │     │ │       RestartSuffix      │ │
       │                          │     │ └──────────────────────────┘ │
       │                          │     │                              │
       │                          │     │   shells out to:             │
       │                          │     │   brew / launchctl / systemctl
       └──────────────────────────┘     └─────────────────────────────┘
                            │
                            ▼
            ┌────────────────────────────────────────────┐
            │   OS layer (macOS launchd / Linux systemd) │
            │   Package managers (brew / pipx / npm)     │
            └────────────────────────────────────────────┘
```

Three independent update paths:

| Target | Triggered by | Executor | Shell command at the bottom |
|---|---|---|---|
| ariaflow-dashboard | Python host | `install_self.py` | `brew upgrade ariaflow-dashboard ; brew link --overwrite ; launchctl bootout ; bootstrap` |
| ariaflow-server | Node backend | `_lifecycle_actions.ts` | `brew upgrade ariaflow-server ; brew link --overwrite ; launchctl bootout ; bootstrap` |
| aria2 | Node backend | `_lifecycle_actions.ts` | `brew upgrade aria2` (no restart chain — aria2 has its own RPC) |

---

## 2. The two orthogonal axes — managed_by × installed_via

Every update path begins by detecting **two orthogonal facts** about
the running process:

### 2.1 `managed_by` — who supervises this process

| Value | Detection | Restart primitive |
|---|---|---|
| `launchd` | macOS, PPID==1, plist exists in `~/Library/LaunchAgents` | `launchctl bootout` + `bootstrap` |
| `systemd` | Linux, `INVOCATION_ID` env, PPID==1 | `systemctl --user restart` |
| `docker` | `/.dockerenv` exists | `process.exit(0)` (orchestrator restarts) |
| `external` | Foreground shell (PPID is parent terminal) | manual restart required |
| `null` | Unknown | dashboard re-execs itself |

Implemented in:
- Backend: `packages/core/src/install/ariaflow_self.ts::detectAriaflowManagedBy()`
- Dashboard: `install_self.py::detect_managed_by()`

### 2.2 `installed_via` — how the binary got onto disk

| Value | Detection | Update command |
|---|---|---|
| `homebrew` | path starts with `$HOMEBREW_PREFIX/` or contains `/Cellar/` | `brew upgrade <formula>` |
| `pipx` | path contains `/.local/pipx/venvs/` (Python only) | `pipx upgrade <pkg>` |
| `pip` | path contains `/site-packages/` (Python only) | `pip install -U <pkg>` |
| `npm` | path under global node_modules (Node only) | `npm install -g <pkg>@latest` |
| `source` | inside a git worktree | refuse — operator runs `git pull` |
| `null` | unknown | refuse |

Implemented in:
- Backend: `packages/core/src/install/ariaflow_self.ts::detectAriaflowInstalledVia()`
- Dashboard: `install_self.py::detect_installed_via()`

### 2.3 Why orthogonal

A single process can be (`launchd`, `homebrew`) or (`docker`,
`source`) or (`external`, `pipx`) — any combination is possible. The
update path takes the cross product:

```
update_command(installed_via) + restart_command(managed_by)
                                      ↑
                                  null when external/docker
                                  → no restart chain attached
```

This explains why the chain has so many fallbacks — every cell of the
matrix needs a sensible default.

---

## 3. Update target #1 — ariaflow-dashboard

The dashboard updates **itself** through its Python host. This is the
trickiest path because the process executing the update is the same
process being killed.

### 3.1 Code locations

| File | Role | Key functions |
|---|---|---|
| `src/ariaflow_dashboard/install_self.py` | Detection + dispatch | `dispatch_update`, `dispatch_restart`, `check_for_update`, `_chain_restart`, `_restart_via_bootstrap`, `_detached`, `_resolve_pkg_manager` |
| `src/ariaflow_dashboard/auto_update.py` | Periodic poller | `start_poller`, `_poller_loop`, `_run_check_once`, `trigger_server_update`, `load_config`, `save_config` |
| `src/ariaflow_dashboard/webapp.py` | HTTP routes | Routes: `/api/web/lifecycle/*`, `/api/web/config` |
| `src/ariaflow_dashboard/static/ts/app.ts` | UI handlers | `webLifecycleAction`, `checkDashUpdate`, `setDashAutoUpdate*`, `setDashAutoUpdatePreset` |
| `src/ariaflow_dashboard/static/_fragments/tab_lifecycle.html` | UI rendering | "ariaflow-dashboard" row |

### 3.2 HTTP routes exposed by Python host

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/web/lifecycle` | — | Self status (PID, version, uptime, managed_by, installed_via) |
| POST | `/api/web/lifecycle/ariaflow-dashboard/check_update` | — | Probe brew / pipx for newer version (read-only) |
| POST | `/api/web/lifecycle/ariaflow-dashboard/update` | — | Run upgrade + chain restart |
| POST | `/api/web/lifecycle/ariaflow-dashboard/restart` | — | Bounce without upgrade |
| GET | `/api/web/config` | — | Read auto-update prefs |
| PATCH | `/api/web/config` | partial | Toggle auto-update, change interval, etc. |

These also exist for the **server target** (managed locally by Python
because cold-start install needs the Python host to dispatch brew
even when the backend is not running):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/web/lifecycle/ariaflow-server/probe` | Local probe: installed_via + plist_present |
| POST | `/api/web/lifecycle/ariaflow-server/install` | First-time install via dashboard's brew |
| POST | `/api/web/lifecycle/ariaflow-server/uninstall` | brew uninstall |
| POST | `/api/web/lifecycle/ariaflow-server/update` | Equivalent to backend's update (when backend down) |
| POST | `/api/web/lifecycle/ariaflow-server/bootstrap` | `brew services restart` recovery |

### 3.3 Dashboard self-update flow (homebrew + launchd, the dominant case)

```
1. Operator clicks "Update" in tab Lifecycle
   └─→ webLifecycleAction('update') in app.ts

2. FE forces a fresh probe via checkDashUpdate()
   └─→ POST /api/web/lifecycle/ariaflow-dashboard/check_update

3. Python's check_for_update() runs:
   • HOMEBREW_AUTO_UPDATE_SECS=0 brew update      ← refresh tap
   • brew outdated --json --formula ariaflow-dashboard
   └─→ returns { update_available: true|false, latest_version }

4a. If "current" → FE short-circuits with "Already up to date".
    No POST /update fires. PID stays. (BG-65 follow-up safeguard.)

4b. If "available" → FE proceeds:
    └─→ POST /api/web/lifecycle/ariaflow-dashboard/update

5. Python's dispatch_update(auto_restart=True):
   detects installed_via=homebrew, managed_by=launchd
   builds the chain via _chain_restart():
   ┌──────────────────────────────────────────────────────┐
   │  /opt/homebrew/bin/brew upgrade ariaflow-dashboard   │
   │  &&                                                   │
   │  /opt/homebrew/bin/brew link --overwrite              │
   │       ariaflow-dashboard 2>/dev/null                  │
   │  &&                                                   │
   │  launchctl bootout gui/<uid>/<label> 2>/dev/null;     │
   │  launchctl bootstrap gui/<uid> <plist_path>           │
   └──────────────────────────────────────────────────────┘

6. The chain runs in `sh -c`, detached + start_new_session=True.
   Python returns 202 to the operator.
   The shell survives Python's death.

7. brew upgrade pulls + installs new bottle.
8. brew link recreates /opt/homebrew/bin/ariaflow-dashboard symlink.
9. bootout kills the old Python process.
10. bootstrap loads the plist → launchd starts the new Python.
11. New Python starts serving on the same port.
12. FE polls /api/web/lifecycle every 3s/8s/15s/30s for 90s,
    detects version change OR pid change OR uptime reset.
13. UI updates: title shows new version, Latest chip shows ✓.
```

### 3.4 Why each step in the chain

| Step | Purpose | Without it |
|---|---|---|
| `brew update` (in probe) | Force tap refresh | brew outdated returns stale (cache 5 min) |
| `brew upgrade` | Install new bottle | Obviously |
| `brew link --overwrite` | Recreate symlink in `/opt/homebrew/bin` | `bootstrap` fails EX_CONFIG (78) on unlinked cellar (BG-66) |
| `bootout` | Kill the old process | New plist load would conflict with running label |
| `bootstrap` | Start new process from plist | Process stays dead |
| `;` between `bootout` and `bootstrap` | Always run bootstrap | `&&` would skip bootstrap if bootout fails (no harm if old process already dead) |
| `&&` between upgrade/link/bootout | Skip restart if upgrade failed | Unnecessary restart on failure (BG-65 trade-off) |

### 3.5 The Python host's "self-suicide" subtlety

When `bootout` runs, it kills the Python process that **started the
shell** that's running `bootout`. Two things must hold for this to work:

1. **The shell is detached**: `subprocess.Popen(..., start_new_session=True)`
   creates a new process group not tied to Python. When Python dies,
   SIGHUP doesn't propagate to `sh`.

2. **The 202 response is sent BEFORE the shell starts**: webapp.py
   returns the response, *then* invokes the `after` callback that
   spawns the chain. The browser sees a clean 202 instead of a dropped
   connection.

```python
# webapp.py
self.send_response(plan["status"])
self.end_headers()
self.wfile.write(body)
self.wfile.flush()             # ← critical: flush before after()
plan["after"]()                # ← spawns the detached shell
```

### 3.6 Source-install rejection

If the dashboard runs from a git checkout (`installed_via='source'`),
both `dispatch_update` and `check_for_update` return:

```json
{ "ok": false, "error": "source_install",
  "message": "running from a git checkout — operator runs git pull" }
```

Status 409. UI shows a disabled Update button with explanation.

### 3.7 Pipx variant

For `installed_via='pipx'`:
- `check_for_update` returns `update_available: null` ("not implemented")
- `dispatch_update` runs `pipx upgrade ariaflow-dashboard` + chain restart
- No probe means the operator can dispatch unnecessarily; no harm
  (pipx no-ops if already current)

### 3.8 Pip variant

Even more degraded:
- No probe at all
- `dispatch_update` runs `python -m pip install -U ariaflow-dashboard`
- No restart chain attached (pip install doesn't always update the
  running process; restart is the operator's responsibility)

---

## 4. Update target #2 — ariaflow-server

The server is a Node backend that updates itself via its own routes.
Mirror image of the dashboard self-update path, with subtle differences.

### 4.1 Code locations (paired repo `ariaflow-server`)

| File | Role |
|---|---|
| `packages/api/src/routes/lifecycle.ts` | Route registration |
| `packages/api/src/routes/_lifecycle_actions.ts` | `dispatchAriaflowUpdate`, `dispatchAriaflowRestart`, `dispatchAriaflowCheckUpdate`, `dispatchAria2Update` |
| `packages/cli/src/commands/_auto_update_controller.ts` | Periodic poller |
| `packages/core/src/install/restart_chain.ts` | `buildPostUpgradeRestartSuffix` |
| `packages/core/src/install/ariaflow_self.ts` | `detectAriaflowManagedBy`, `detectAriaflowInstalledVia`, `detectLaunchdLabel` |
| `packages/core/src/install/services.ts` | `brewOutdatedFormula`, `resolvePkgManager` |
| `packages/core/src/contracts/declaration.ts` | Preferences: `auto_update`, `auto_update_check_hours`, `auto_restart_after_upgrade` |

### 4.2 HTTP routes (on backend, `:8123` typically)

| Method | Path | Action |
|---|---|---|
| GET | `/api/lifecycle` | Multi-component status |
| POST | `/api/lifecycle/ariaflow-server/check_update` | Read-only probe (BG-59) |
| POST | `/api/lifecycle/ariaflow-server/update` | Run upgrade + chain restart |
| POST | `/api/lifecycle/ariaflow-server/restart` | Bounce only |
| POST | `/api/lifecycle/aria2/update` | Update aria2 binary |
| POST | `/api/lifecycle/aria2/start` / `stop` / `restart` | aria2 lifecycle |

### 4.3 Server self-update flow (homebrew + launchd)

The chain built by the backend:

```ts
// _lifecycle_actions.ts::dispatchAriaflowUpdate
const cmd =
  `${brew} upgrade ariaflow-server ; ` +              // BG-43 base
  `${brew} link --overwrite ariaflow-server 2>/dev/null`; // BG-66

const restartSuffix = autoRestart ? buildPostUpgradeRestartSuffix() : null;
// restartSuffix = "launchctl bootout gui/<uid>/<label> 2>/dev/null;
//                  launchctl bootstrap gui/<uid> <plist>"

// BG-65: ';' not '&&' so a no-op upgrade still triggers restart
if (restartSuffix) {
  detached("sh", ["-c", `${cmd} ; ${restartSuffix}`]);
}
```

**Notable difference vs dashboard**: backend uses `;` between upgrade
and restart-suffix (BG-65), while dashboard uses `&&` (added later in
the saga, philosophy diverged). Documented inconsistency — see §6.

### 4.4 Backend's `restart_chain.ts` returns null when not applicable

```ts
export function buildPostUpgradeRestartSuffix(): string | null {
  if (detectAriaflowManagedBy() !== "launchd") return null;
  const label = detectLaunchdLabel();
  if (!label) return null;
  const plist = join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  if (!existsSync(plist)) return null;
  // ...
  return `launchctl bootout ${target} 2>/dev/null; launchctl bootstrap ${domain} ${plist}`;
}
```

When null: upgrade runs alone; the operator must restart manually.

### 4.5 Backend's check_update probe (BG-59)

```ts
async function dispatchAriaflowCheckUpdate(currentVersion: string) {
  if (installedVia === "homebrew") {
    const probe = await brewOutdatedFormula("ariaflow-server");
    return {
      status: 200,
      body: { ok: true, current_version, latest_version, update_available }
    };
  }
  // pipx/npm: 200 with update_available=null + message
  // source/null: 409
}
```

Frontend uses this same way as the dashboard's check_update.

### 4.6 Other supervisors

| managed_by | Restart command |
|---|---|
| `launchd` | `bootout` + `bootstrap` (or `kickstart -k` fallback if no plist) |
| `systemd` | `systemctl --user restart ariaflow-server` |
| `docker` | `process.exit(0)` (orchestrator handles restart) |
| `external` | 409 `manual_restart_required` |

---

## 5. Update target #3 — aria2

The simplest path. aria2 is a third-party binary; we never restart it
post-update because it has its own JSON-RPC interface and any running
session keeps working with the old binary until the operator manually
restarts via the lifecycle tab.

### 5.1 Detection

```ts
// _lifecycle_actions.ts::dispatchAria2Update
const installedVia = detectBinaryInstalledVia(findAria2c());
//                   ^^^ probes the path of the actual aria2c binary,
//                       not ariaflow's installation channel
```

### 5.2 Dispatch

```ts
if (installedVia === "homebrew") {
  detached(resolvePkgManager("brew"), ["upgrade", "aria2"]);
}
// pipx/npm: 409 (aria2 not distributed via these)
// unknown: 409
```

No `link --overwrite`, no `bootout`, no `bootstrap`. brew handles
aria2's symlinks transparently and aria2 isn't supervised by launchd
through ariaflow.

### 5.3 Aria2 restart is separate

`POST /api/lifecycle/aria2/restart` does not call `dispatchAria2Update`.
It calls aria2's own lifecycle dispatch, which uses the existing
launchd plist for aria2 (separate from ariaflow's own plist).

---

## 6. The shell chain — anatomy and history

### 6.1 The current canonical chain (BG-66 era)

```
brew upgrade <formula>
    ↓
brew link --overwrite <formula> 2>/dev/null
    ↓
launchctl bootout gui/<uid>/<label> 2>/dev/null
    ↓
launchctl bootstrap gui/<uid> <plist_path>
```

The four steps:

1. **Upgrade** — pulls new bottle if outdated; no-op if current
2. **Link** — recreates symlinks in `$HOMEBREW_PREFIX/bin/`
3. **Bootout** — unloads the old service from launchd
4. **Bootstrap** — loads the plist back, starting fresh process

### 6.2 The exact separators by side

| Path | Upgrade ↔ Link | Link ↔ Bootout | Bootout ↔ Bootstrap |
|---|:-:|:-:|:-:|
| Dashboard (Python) | `&&` | `&&` | `;` |
| Backend (Node) — server | `;` | `;` | `;` |
| Backend (Node) — auto-update | `;` | `;` | `;` |

**Inconsistency**: dashboard uses `&&` (skip restart on upgrade failure),
backend uses `;` (always attempt restart, BG-65). The split exists
because BG-65 was filed for the backend first (server stale-cellar
case), and the dashboard later added smart-probe-first guards (FE-side
short-circuit) that made the `&&` safer there.

### 6.3 Historical evolution by Backend Gap

Each entry shows the chain shape **at that point in time**:

#### Pre-BG-43 (initial)
```
brew upgrade <formula>
launchctl kickstart -k gui/<uid>/<label>     ← unreliable
```
- Problem: `kickstart -k` silently no-ops with some plist KeepAlive
  configurations across macOS versions.

#### BG-43 (the original lifecycle dispatch design)
- Introduced separate `restart` and `update` actions per supervisor +
  installer matrix.
- Set the foundation for all subsequent fixes.

#### BG-46 (aria2 update + alignment)
- Added `dispatchAria2Update` so the backend manages aria2's brew
  formula.
- No restart chain (aria2's lifecycle is independent).

#### BG-59 (manual check-update probe)
```
brew outdated --json --formula <formula>
```
- Pure read-only.
- Frontend uses this to populate the "Latest" chip.

#### BG-60 (PATH workaround)
- launchd inherits a stripped PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
- `which brew` returns nothing → spawn fails with ENOENT
- Solution: `_resolve_pkg_manager` / `resolvePkgManager` probe known paths:
  `/opt/homebrew/bin`, `/usr/local/bin`, `/home/linuxbrew/.linuxbrew/bin`,
  `~/.local/bin`

#### BG-61 (bootout instead of kickstart)
```
launchctl bootout gui/<uid>/<label>
launchctl bootstrap gui/<uid> <plist>
```
- Replaced unreliable `kickstart -k` with `bootout` + `bootstrap`.
- Modern launchd primitive, works across macOS versions.

#### BG-62 (chain upgrade && restart)
```
brew upgrade <formula> && launchctl bootout && launchctl bootstrap
```
- Original auto-restart-after-upgrade chain.
- Used `&&` everywhere — broke on stale cellar (no-op upgrade still
  needed restart).

#### BG-63 (lifecycle probe periodic)
- Server runs its own lifecycle probe at fixed interval
- Emits `lifecycle_changed` SSE topic
- Allows dashboard to detect cold-start state changes without polling

#### BG-64 (last_probed_at on lifecycle)
- Backend stamps each component's lifecycle row with `last_probed_at`
- Frontend uses this for staleness detection (FE-54)

#### BG-65 (`;` vs `&&` for stale cellar fix)
```
brew upgrade <formula> ; launchctl bootout ; launchctl bootstrap
```
- Symptom: brew upgrade no-ops on "already current" (returns 0)
- But the *running process* still pinned to deleted Cellar dir
- `&&` skipped the restart → process kept 404'ing on its own statics
- Fix: `;` so restart always fires and realigns
- This is **how the chain still looks on the backend today**.

#### BG-66 (brew link --overwrite recovery)
```
brew upgrade <formula> ; brew link --overwrite <formula> ; bootout ; bootstrap
```
- Symptom: after interrupted brew install, `brew upgrade` no-ops AND
  the formula is left "installed but not linked"
- `bootstrap` then fails with EX_CONFIG (78) because `/opt/homebrew/bin/<binary>`
  symlink is missing
- Fix: idempotent `brew link --overwrite` between upgrade and bootstrap

#### Post-BG-66 dashboard adjustment
- Dashboard switched back to `&&` between upgrade/link/bootout
- Rationale: FE now does smart-probe-first short-circuit, so a no-op
  upgrade is unreachable from the user-visible path
- Defense-in-depth: even if FE somehow dispatches Update on a
  current version, `&&` prevents unnecessary restart
- The `;` between bootout and bootstrap stays — those two must always
  pair regardless of bootout's exit code

### 6.4 Why no shared shell-chain library

The backend and dashboard build **structurally identical** chains in
two languages. Tempting to share via a small spec doc + golden tests.
Not done yet. See `MULTI_DEVICE_AUTH_DESIGN.md §B.x` for a discussion.

---

## 7. Restart vs Update vs Recover — semantic distinction

Three buttons in the Lifecycle tab look similar but mean different things:

| Action | What it does | When to use |
|---|---|---|
| **Restart** | bootout + bootstrap, no upgrade | "I want to bounce the process" — config change, debugging |
| **Update** | upgrade + link + restart (smart-probed) | "Pull new version if any" |
| **Recover** | `brew services restart` | "Service is dead, get it running" (server target only) |

### 7.1 Restart implementation

Dashboard:
```python
dispatch_restart() → just bootout + bootstrap, no brew upgrade
```

Backend:
```ts
dispatchAriaflowRestart() → just launchctl bootout + bootstrap
```

### 7.2 Update implementation

Already covered in §3.3 and §4.3. Smart-probe-first by frontend.

### 7.3 Recover implementation (server only, dashboard-managed)

When the server's plist exists but the service is down (`bootout`'d
but never `bootstrap`'d), the operator needs an entry point that
doesn't require terminal access.

```python
# install_self.py::dispatch_server_bootstrap
brew = _resolve_pkg_manager("brew")
detached(brew, ["services", "restart", "ariaflow-server"])
```

For non-brew installs, falls back to:
```
launchctl bootout gui/<uid>/<label> 2>/dev/null
launchctl bootstrap gui/<uid> <plist>
```

Surfaced in UI as a banner CTA when:
- `_consecutiveFailures > 0` (FE has tried to reach server N times)
- AND server's `plist_present === true` (service is installed locally)
- AND server's runtime state is "unreachable"

---

## 8. Smart Update probe-first short-circuit

Both dashboard and server implement a frontend-side short-circuit to
prevent unnecessary upgrade dispatches.

### 8.1 The race that prompted this

```
1. Operator clicks Update on dashboard already at v0.1.590
2. FE dispatches POST /update without checking
3. Backend chain runs:
   brew upgrade ariaflow-dashboard  → no-op (already current)
   ; launchctl bootout              ← fires anyway because of `;`
   ; launchctl bootstrap            ← restarts process for nothing
4. PID changes, FE shows "Restarting..." for 90s
5. Operator: "why did it restart, there's no update"
```

### 8.2 The fix (in `app.ts`)

```javascript
async webLifecycleAction(action) {
  if (!['restart', 'update'].includes(action)) return;
  
  if (action === 'update') {
    await this.checkDashUpdate().catch(() => {});
    if (this._dashUpdateProbe === 'current') {
      this.resultText = `Already up to date (${this._dashLatestVersion}). 
                         Click Restart to bounce.`;
      return;   // ← no POST fires
    }
  }
  // ... only here we dispatch
}
```

Same logic for server target in `lifecycleAction(target, action)`.

### 8.3 Why also keep `&&` defense-in-depth in dashboard chain

If somehow Update fires when probe says current (cache stale, network
flake, etc.), the chain itself self-defends:
- `brew upgrade` returns 0 with "Already up-to-date"
- `&&` between upgrade and link: link still fires (idempotent, fine)
- `&&` between link and bootout: bootout still fires (kills process)
- `;` between bootout and bootstrap: bootstrap fires (process comes back)

Result: an unintentional Update on current version still cleanly
restarts. **Frontend short-circuit is the primary guard; chain
behavior is the safety net.**

---

## 9. Auto-update poller (both sides)

Two independent pollers — one in Python (dashboard), one in Node
(backend). Same logic, two languages.

### 9.1 Dashboard poller (`auto_update.py`)

#### 9.1.1 Configuration storage

```
~/.ariaflow-dashboard/config.json     (mode 600 by convention)
{
  "auto_update": false,
  "auto_update_check_hours": 24,
  "update_server_first": true,
  "auto_restart_after_upgrade": true,
  "backend_url": ""
}
```

Defaults applied on every `load_config()` for any missing keys.
Bounded: hours ∈ [1, 720].

#### 9.1.2 Loop

```python
def _poller_loop(stop_event):
    while not stop_event.is_set():
        cfg = load_config()
        try:
            _run_check_once()
        except Exception:
            record_action(action='auto_update_dispatch', outcome='failed', ...)
        stop_event.wait(cfg['auto_update_check_hours'] * 3600)
```

- Daemon thread (doesn't block process exit)
- Re-reads config every iteration (toggle + interval pickup)
- Wakes on `stop_event.set()` for fast teardown in tests

#### 9.1.3 One iteration logic

```python
def _run_check_once():
    cfg = load_config()
    if not cfg['auto_update']: return                       # toggle off
    via = detect_installed_via()
    if via in (None, 'source'): return record_skip()        # not upgradable
    
    probe = check_for_update()
    if not probe.get('ok'): return record_failed()          # probe error
    if not probe.get('update_available'): return record_unchanged()
    
    # Optional orchestration
    if cfg.get('update_server_first'):
        trigger_server_update(cfg.get('backend_url', ''))   # best-effort POST
    
    plan = dispatch_update(auto_restart=cfg['auto_restart_after_upgrade'])
    if plan['ok']:
        record_dispatch_changed()
        plan['after']()                                     # ← spawns shell
```

#### 9.1.4 Server orchestration (update_server_first)

When the dashboard auto-updates AND `update_server_first=True`:

```python
def trigger_server_update(backend_url):
    base = backend_url or DEFAULT_BACKEND
    url = f"{base}/api/lifecycle/ariaflow-server/update"
    try:
        urllib.request.urlopen(Request(url, method='POST'), timeout=5)
        record_action('auto_update_server_kick', outcome='changed')
    except Exception:
        record_action('auto_update_server_kick', outcome='failed')
        # Best-effort. Dashboard's own update still proceeds.
```

Rationale: if both have updates pending, kick the server first so
that by the time the dashboard restarts, it talks to a freshened
server. Failures are non-blocking (the server might be down, the
network might be lossy — none of that should prevent the dashboard
from updating).

### 9.2 Backend poller (`_auto_update_controller.ts`)

#### 9.2.1 Configuration source

Backend prefs come from the **declaration** (managed via `/api/declaration`),
not a local file. Three keys involved:
- `auto_update` — enable/disable
- `auto_update_check_hours` — interval
- `auto_restart_after_upgrade` — chain restart-suffix yes/no

#### 9.2.2 Loop structure (TypeScript)

```typescript
const tick = async () => {
  if (inFlight) return;
  inFlight = true;
  try {
    const declaration = await ctx.declaration.load();
    if (!Boolean(prefValue(declaration, 'auto_update', false))) return;
    
    const installedVia = detectAriaflowInstalledVia();
    const result = await checkForUpdate(installedVia);
    await ctx.actions.record({
      action: ACTIONS.autoUpdateCheck,
      outcome: result.available ? 'changed' : 'unchanged'
    });
    
    if (result.available) {
      const autoRestart = Boolean(prefValue(declaration, 'auto_restart_after_upgrade', true));
      applyUpdate(installedVia, autoRestart);
      await ctx.actions.record({
        action: ACTIONS.autoUpdateApplied, outcome: 'changed'
      });
    }
  } finally { inFlight = false; }
};
```

#### 9.2.3 Notable behaviors

- **`inFlight` guard**: a long-running tick (slow brew) doesn't start
  another tick on top of itself.
- **Declaration re-loaded every tick**: toggle change picks up
  immediately, but interval change requires a restart (cadence is read
  once at `launch()`).
- **Same chain as manual update**: `applyUpdate` invokes the same
  shell command shape as `dispatchAriaflowUpdate`.

### 9.3 Why two separate pollers and not one orchestrator

The dashboard must keep itself current **even when the backend is down**.
If we delegated dashboard auto-updates to the backend, a crashed backend
would block the dashboard from healing itself. Independent pollers
make each component responsible for its own freshness.

The `update_server_first` flag is the optional bridge: when set,
dashboard kicks the server before its own update, but does not depend
on it.

---

## 10. Frontend orchestration (TS bundle)

The `app.ts` Alpine component coordinates all this from the browser.

### 10.1 State shape (relevant subset)

```javascript
{
  webConfig: {
    auto_update: false,
    auto_update_check_hours: 24,
    update_server_first: true,
    auto_restart_after_upgrade: true,
    backend_url: ''
  },
  
  // Dashboard self
  webVersionText: '0.1.591',
  webPidText: '12345',
  webUptimeSeconds: 3600,
  _dashUpdateProbe: 'current' | 'available' | 'failed' | null,
  _dashLatestVersion: '0.1.591',
  dashLifecycleLoading: false,
  
  // Server target
  backendVersionText: '0.1.314',
  _serverUpdateProbe: 'current' | 'available' | 'failed' | null,
  _serverLatestVersion: '0.1.315',
  _serverLifecycleLoading: false,
  
  // Auto-check dedup
  _lastUpdateProbeAt: 0,
}
```

### 10.2 Tab-mount auto-check

```javascript
_maybeAutoCheckUpdates() {
  const since = Date.now() - this._lastUpdateProbeAt;
  if (since < 6 * 3600 * 1000) return;          // 6h dedupe
  this._lastUpdateProbeAt = Date.now();
  this.checkBackendUpdate().catch(() => {});
  this.checkDashUpdate().catch(() => {});
}
```

Triggered by `TAB_MOUNT_HOOK['lifecycle']`. Fires both probes when the
operator opens the Lifecycle tab. 6h dedupe prevents constant probing
on tab switch.

### 10.3 Action loading state + completion polling

When operator clicks Update or Restart:

```javascript
async webLifecycleAction(action) {
  // 1. Probe-first short-circuit (Update only)
  if (action === 'update') {
    await this.checkDashUpdate();
    if (this._dashUpdateProbe === 'current') {
      this.resultText = 'Already up to date...';
      return;
    }
  }
  
  // 2. Capture pre-action state
  const beforePid = this.webPidText;
  const beforeVersion = this.webVersionText;
  
  // 3. Dispatch
  this.dashLifecycleLoading = true;
  await fetch(`/api/web/lifecycle/ariaflow-dashboard/${action}`, {method:'POST'});
  
  // 4. Poll for completion at 3s, 8s, 15s, 30s, then every 5s up to 90s
  const deadline = Date.now() + 90_000;
  for (const delay of [3000, 5000, 7000, 15000]) {
    await sleep(delay);
    await this._fetchWebLifecycle();
    const versionChanged = this.webVersionText !== beforeVersion;
    const pidChanged = this.webPidText !== beforePid;
    const uptimeReset = this.webUptimeSeconds < 30;
    if (versionChanged || pidChanged || uptimeReset) {
      this.dashLifecycleLoading = false;
      return;
    }
    if (Date.now() > deadline) break;
  }
  this.dashLifecycleLoading = false;
  this.resultText = 'Action sent — completion not observed within 90s';
}
```

Same shape exists for server target in `lifecycleAction()`.

### 10.4 UI rendering

`tab_lifecycle.html` renders three rows uniformly:
- ariaflow-server (top)
- aria2 (middle)
- ariaflow-dashboard (bottom)

Each row has:
- PID + uptime chip
- Version + Latest chip + Check button
- Action strip (Restart / Update / Install / Uninstall as applicable)
- Auto-update preset row (off/1h/6h/24h/1w)
- Settings sub-grid (auto_restart_after_upgrade, update_server_first)

The dashboard self row also has `update_server_first` checkbox; the
server row has its own auto-update toggles wired to the backend
declaration.

---

## 11. Action log entries reference

All update-related events end up in the action log (visible in the
Activity tab). Naming conventions:

| Action | Outcome values | Triggered by | Detail keys |
|---|---|---|---|
| `auto_update_check` | `unchanged`, `changed`, `failed` | Dashboard poller, Backend poller | `installed_via`, `current_version`, `available`, `message` |
| `auto_update_applied` | `changed`, `failed` | Backend poller (after apply) | `installed_via` |
| `auto_update_dispatch` | `changed`, `failed` | Dashboard poller (after dispatch) | `installed_via`, `from_version`, `to_version` |
| `auto_update_skip` | `unchanged` | Dashboard poller (no upgradable channel) | `installed_via` |
| `auto_update_server_kick` | `changed`, `failed` | Dashboard's `trigger_server_update` | `backend_url`, `status`/`error` |
| `lifecycle.update` | `changed`, `failed` | Manual click via `/lifecycle/.../update` | `target`, `installed_via` |
| `lifecycle.restart` | `changed`, `failed` | Manual click via `/lifecycle/.../restart` | `target`, `managed_by` |
| `lifecycle.check_update` | `unchanged`, `changed` | Manual click on Check button | `target`, `update_available` |

The Activity tab supports filtering by action and target, so an
operator can see "all auto-update activity for ariaflow-server in
the last 24h" with one filter combination.

---

## 12. Backend gaps history (BG series)

Update-related backend gaps in chronological order. See `FRONTEND_GAPS.md`
in the dashboard repo and `BACKEND_GAPS_REQUESTED_BY_FRONTEND.md` in
the server repo for paired entries.

| BG | Title | Status | What it added |
|---|---|---|---|
| BG-43 | Original lifecycle dispatch design | resolved | Two-axis matrix (managed_by × installed_via) |
| BG-45 | Periodic auto-update poller | resolved | `_auto_update_controller.ts` |
| BG-46 | aria2 update + alignment | resolved | `dispatchAria2Update`, brew upgrade aria2 |
| BG-49 | Scheduler action endpoints return canonical state | resolved | (related, not direct update) |
| BG-59 | Manual `check_update` endpoint | resolved | `dispatchAriaflowCheckUpdate` |
| BG-60 | `_resolve_pkg_manager` for launchd PATH | resolved | known-paths probe |
| BG-61 | bootout+bootstrap instead of `kickstart -k` | resolved | reliable launchd primitive |
| BG-62 | Chain `brew upgrade && bootout && bootstrap` | resolved | `buildPostUpgradeRestartSuffix` |
| BG-63 | Server-side periodic lifecycle probe | resolved | `lifecycle_changed` SSE |
| BG-64 | `last_probed_at` per component | resolved | staleness detection support |
| BG-65 | `&&` → `;` for stale cellar fix | resolved | always-restart even on no-op upgrade |
| BG-66 | `brew link --overwrite` between upgrade and bootstrap | resolved | unlinked-cellar recovery |
| BG-67 | (proposed) mDNS TXT additions for pairing | proposed | not yet filed (see `MULTI_DEVICE_AUTH_DESIGN.md`) |

---

## 13. Failure modes catalog

Real-world failures observed during this saga and how the system handles
them now.

### 13.1 Stale cellar (BG-65)

**Symptom**: brew shows "Already up-to-date" but `/opt/homebrew/Cellar/ariaflow-server/X.Y.Z`
is the old version that the running process is linked into. The
process keeps running with stale code; statics 404.

**Cause**: a previous `brew upgrade` partially completed — bottle was
extracted but the running process wasn't restarted, and the old Cellar
dir got cleaned up in a subsequent operation.

**Detection**: operator sees 404 / version mismatch in UI.

**Fix**: BG-65 — `;` instead of `&&` between upgrade and restart-suffix.
Restart fires unconditionally on Update click, realigning running
process to the cellar.

### 13.2 Unlinked cellar (BG-66)

**Symptom**: `bootstrap` fails with EX_CONFIG (78) because
`/opt/homebrew/bin/ariaflow-server` symlink is missing.

**Cause**: an interrupted brew install or manual `brew unlink` left
the formula installed but unlinked. `brew upgrade` no-ops on already-
current formulas without re-linking.

**Fix**: BG-66 — insert `brew link --overwrite ariaflow-server` between
upgrade and bootstrap. Idempotent: re-creates symlink whether already
linked or not.

### 13.3 Unreachable server, plist present

**Symptom**: dashboard polls /api/lifecycle, sees backend unreachable.
Backend's plist is in `~/Library/LaunchAgents/` (so it was installed
properly at some point), but no process is running.

**Cause**: someone bootout'd the service manually, or it crashed and
launchd's KeepAlive condition decided not to restart it.

**Fix**: dashboard surfaces a "Recover" banner CTA → calls
`POST /api/web/lifecycle/ariaflow-server/bootstrap` →
Python runs `brew services restart ariaflow-server`.

### 13.4 PATH stripped by launchd (BG-60)

**Symptom**: `which brew` returns nothing inside the spawned shell;
upgrade fails ENOENT.

**Cause**: launchd starts processes with a stripped PATH:
`/usr/bin:/usr/sbin:/bin:/sbin`. brew is not in it.

**Fix**: BG-60 — `_resolve_pkg_manager` / `resolvePkgManager` probes
known absolute paths (`/opt/homebrew/bin`, `/usr/local/bin`,
`/home/linuxbrew/.linuxbrew/bin`, `~/.local/bin`). All shell commands
use absolute paths.

### 13.5 brew tap stale cache

**Symptom**: `brew outdated` reports "no upgrade" even though a new
version was published 10 minutes ago.

**Cause**: brew throttles tap refreshes via `HOMEBREW_AUTO_UPDATE_SECS`
(default 300s). Two manual checks within 5 minutes hit the same cache.

**Fix**: probe runs `HOMEBREW_AUTO_UPDATE_SECS=0 brew update` before
`brew outdated` to force a tap refresh. Cost: ~1-3s extra per check.

### 13.6 Auto-update timer not picking up new interval

**Symptom**: operator changes `auto_update_check_hours` from 24 to 1;
the next check still fires 24h later.

**Cause**: the timer's interval is read once at `launch()` time. The
declaration toggle is re-read each tick, but the cadence isn't.

**Workaround**: restart the backend after changing the interval.
**Documented limitation**, not a bug — restart is the explicit operator
ack of "change cadence and re-arm".

### 13.7 Two updates in flight simultaneously

**Symptom**: never observed in practice, theoretically a poller tick
overlapping with a manual click.

**Defense**: backend has `inFlight` guard in poller. Manual clicks
don't go through the same gate, but the chain itself is idempotent
(brew detects concurrent operations and one waits or fails).

### 13.8 Source install update click

**Symptom**: operator on a git checkout clicks Update.

**Defense**: `dispatch_update` returns 409 with `error: source_install`.
UI shows disabled button + tooltip "running from source — git pull".

### 13.9 Network failure during chain

**Symptom**: brew upgrade times out mid-download; chain stops at
upgrade step.

**Defense**: with `&&` separator (dashboard), bootout and bootstrap
don't fire — process stays running on old version. With `;` separator
(backend), bootout fires anyway and the process restarts on the **old**
binary (since the new one wasn't installed). Both behaviors are
acceptable: the process is healthy, just on the version it had before.

### 13.10 Process killed during link step

**Symptom**: `brew link --overwrite` runs, then SIGTERM hits the shell
between link and bootout.

**Defense**: the chain runs in a detached subprocess; SIGTERM to Python
doesn't propagate. SIGKILL would, but only the supervisor (launchd)
sends that, which means we're already restarting.

### 13.11 EX_CONFIG (78) after Python 3.9 syntax error

**Symptom**: dashboard 0.1.583 failed launchd spawn with EX_CONFIG.

**Cause**: PEP 604 union syntax (`Path | None`) was used; macOS launchd
spawned Python 3.9 (system Python), which doesn't support PEP 604.

**Fix**: changed to `Optional[Path]` from `typing`. The pyproject.toml
declares `requires-python = ">=3.10"` but launchd doesn't honor that —
it picks whatever Python is at the path the brew bottle declares.

### 13.12 webVersionText not refreshing after restart

**Symptom**: title shows old version even after restart succeeds.

**Cause**: title binding read `webVersionText` from page-load HTML
injection (`window.__ARIAFLOW_VERSION__`); not from live API.

**Fix**: `_applyWebLifecycle` updates `webVersionText` from
`/api/web/lifecycle.result.version` on every poll. Now restart
completion is reflected immediately.

### 13.13 Restart polling stuck

**Symptom**: clicked Restart, button shows "Restarting…" indefinitely.

**Cause**: completion detector only checked version change; Restart
without upgrade has no version change → never matched.

**Fix**: detect by `versionChanged || pidChanged || uptimeReset (uptime < 30s)`.
Any of three triggers completion.

---

## 14. What's NOT done by these update paths

Explicit non-goals to keep the implementation honest:

- **No rollback** — if an upgrade brings a regression, the operator
  uses `brew uninstall && brew install <formula>@<version>` manually,
  or pins via Homebrew's `brew pin`. We don't ship a "Revert" button.

- **No staged rollouts** — every check that finds an update applies
  it immediately on every machine. No canary, no percentage.

- **No version pinning UI** — operators wanting to lock a version do
  it through brew (`brew pin`).

- **No update notification before applying** — the auto-update is
  intentionally invisible. The operator can always disable it and use
  the manual button.

- **No diff preview / changelog** — operators see versions in the UI
  but the changelog comes from GitHub releases, not the dashboard.

- **No update across major versions with breaking changes** — handled
  by versioned formulas in brew (we ship one tap per major if needed).

- **No sub-component updates** — aria2 + ariaflow-server + dashboard
  are all-or-nothing. We don't do "update only the API layer".

- **No update over flaky network with retry** — single attempt per
  tick. If brew fails, the next tick will retry. No exponential backoff.

- **No update of the dashboard's TS bundle independently of the
  Python host** — they ship together (the bundle is bundled into the
  Python wheel via static/dist/).

- **No update of vendored webstyle** — it's vendored at commit time
  (4613f49). Rebumping requires manual sync.

- **No cross-platform binary distribution** — Linux + macOS via brew
  only. Windows works in WSL or via pipx. No native installers.

- **No code-signing of the bottle** — relies on brew's checksum
  verification. macOS Gatekeeper trusts brew's tap.

---

## 15. Reusability as a library — extraction analysis

The update logic encodes operational wisdom (BG-43 through BG-66) that
is genuinely valuable **outside ariaflow**. Most selfhosted tools
managing their own updates run into the same failure modes and resolve
them ad-hoc, often badly. This section analyses what could be extracted
as a reusable library, how, and at what cost.

### 15.1 Layers of reusability

Not all of the update code is equally reusable. Roughly five layers
from most-pure to most-opinionated:

#### Layer 1 — Detection (most reusable, pure functions)

```
detect_managed_by()       → launchd | systemd | docker | external | null
detect_installed_via()    → homebrew | pipx | pip | npm | source | null
detect_launchd_label()    → "homebrew.mxcl.<formula>"
detect_systemd_unit()
resolve_pkg_manager()     → absolute path with PATH fallbacks
```

Pure functions, zero side effects. Any selfhosted tool installed via
brew + supervised by launchd needs exactly this matrix.

**Public-ready:** ✅ yes.

#### Layer 2 — Shell chain construction

```
build_post_upgrade_restart_suffix(managed_by, label, plist_path)
    → "launchctl bootout … ; launchctl bootstrap …"

build_upgrade_chain(installed_via, formula, with_link, with_restart)
    → "brew upgrade X ; brew link --overwrite X ; bootout ; bootstrap"
```

Pure string construction, but the `&&` vs `;` semantics are subtle and
opinionated. Library should expose presets ("conservative",
"always-restart", "fail-fast") rather than a single answer.

**Public-ready:** ✅ yes, with documented trade-offs.

**Real value-add:** BG-65 (stale cellar) and BG-66 (unlinked cellar)
fixes encode hard-won knowledge. Most selfhosted tool READMEs say
"brew upgrade && launchctl kickstart -k". They will all hit these
failure modes eventually.

#### Layer 3 — Dispatch primitives (side-effecting)

```
dispatch_restart(formula) → returns { plan, after_callback }
dispatch_update(formula, auto_restart=True)
check_for_update(formula)  → uses HOMEBREW_AUTO_UPDATE_SECS=0
```

The "return plan + after callback" pattern is elegant for HTTP
handlers (send 202, then execute) but not universal. A library should
offer two flavors:
- `apply()` synchronous
- `plan_and_apply_after(send_response)` for async dispatch

**Public-ready:** ✅ yes, with two API styles.

#### Layer 4 — Auto-update poller

```
class AutoUpdateController:
    def __init__(self, formula, config_provider, action_logger): ...
    def start(self):  # spawns daemon thread / setInterval
    def stop(self): ...
```

Requires inversion of control: the library doesn't know how the
consuming app stores config (file, DB, env, declaration) nor how it
logs actions. Needs interfaces (`ConfigProvider`, `ActionLogger`).

**Public-ready:** 🟡 yes but demands clean interface design.

#### Layer 5 — Probe-first short-circuit + completion polling

```
async def smart_update(formula, on_progress):
    probe = await check_for_update(formula)
    if not probe.update_available: return UpdateResult.already_current
    plan = dispatch_update(formula)
    plan.execute_after(...)
    await wait_for_completion(observer=fetch_status, timeout=90)
```

Touches UX and transport (HTTP, IPC). Too opinionated for a library —
keep in the application.

**Public-ready:** ❌ no.

### 15.2 Suggested package decomposition

```
selfsupervise-core          (layers 1+2, pure functions)
    ├─ detection
    ├─ chain builders
    └─ types

selfsupervise-dispatch       (layer 3, side effects)
    ├─ depends on -core
    ├─ shell execution
    └─ supervisor-specific dispatch

selfsupervise-poller         (layer 4)
    ├─ depends on -dispatch
    └─ interfaces ConfigProvider + ActionLogger
```

Three packages let consumers pick what they want. Most tools want
layers 1+2 only and write their own dispatch in their stack idioms.

### 15.3 Target audience

Selfhosted tools distributed via Homebrew on macOS and apt/yum/brew on
Linux. Real candidates:

- Media servers: Sonarr, Radarr, Bazarr, Lidarr, Plex, Jellyfin, Navidrome
- Sync tools: Syncthing, Resilio Sync
- Identity / passwords: Vaultwarden, Bitwarden self-hosted
- Networking: Tailscale (already does it), Pi-hole, AdGuard Home
- Productivity: Calibre-server, Joplin Server, Trilium, Obsidian Sync
- Code: Forgejo, Gitea, Gerrit, Drone CI
- Smart home: Home Assistant, openHAB, Domoticz

Easy ~50-100 tools. Most have ad-hoc update logic.

### 15.4 Competition

- **brew autoupdate** (external tap): does the probe, not the restart chain
- **nix-darwin**: completely different paradigm (declarative system
  configuration), not directly comparable
- **Tailscale's self-updater**: closed source but conceptually similar
- Generic supervisors (s6, runit, sysd) don't include update logic

**No direct competitor** publishing a "package-manager + supervisor
update orchestration" library. Diffuse demand, no aggregator yet.

### 15.5 Multi-language strategy

Currently Python + TypeScript exist as parallel implementations. As a
library, four options:

#### Option A — TypeScript only (consumed via WASM or subprocess)
- ✅ Single source of truth
- ❌ Python clients bundle Node or WASM runtime
- ❌ Friction for hobbyist consumers

#### Option B — TS + Python in parallel (current state)
- ✅ Native to the two dominant ecosystems
- ❌ Maintenance double, divergence guaranteed long-term
- ❌ Already what we have and it's painful

#### Option C — Rust or Go core, FFI bindings
- ✅ Fast, portable, single library
- ❌ ~3-4 week investment
- ❌ Niche audience may not want FFI complexity

#### Option D — Standalone CLI binary (e.g. `selfsupervise probe ariaflow-server`)
- ✅ No FFI, no runtime to embed
- ✅ Every language already speaks subprocess
- ❌ Slow (spawn per call)
- ❌ Loses structure (must parse JSON output)
- ❌ Awkward for async / event-driven cases

**Recommended: D first** for traction, **C** later if usage justifies.

### 15.6 Maturity levels

#### Level 1 — Internal shared module (no public release)

Extract within the ariaflow monorepo as `@ariaflow/selfsupervise` (TS)
+ submodule `ariaflow_dashboard.selfsupervise` (Python). Refactor both
sides to consume.

- **Cost:** ~2 days
- **Gain:** eliminate duplication, share golden tests
- **Risk:** none (internal)

#### Level 2 — Open source, undocumented

Separate repo `bonomani/selfsupervise` under MIT. Publish to PyPI +
npm. Minimal README, no marketing. Audience: devs who find it via
search for "brew launchctl bootstrap unlinked cellar EX_CONFIG".

- **Cost:** ~3-5 days for proper packaging + tests + CI
- **Gain:** a few external users, occasional PRs
- **Risk:** issue/PR maintenance fatigue, breaking changes hurt
  unknown consumers

#### Level 3 — Community product

Full docs site, example integrations for 3-4 popular tools (Sonarr,
Plex, etc.), demo video, "Show HN" post.

- **Cost:** ~3-4 weeks initial + ongoing maintenance
- **Gain:** potentially significant if niche resonates
- **Risk:** low traction = dead repo with bad reputation

### 15.7 Risks of going public

1. **Versioning lockstep** — While ariaflow-dashboard and ariaflow-server
   both consume the lib, they must bump together. Strict SemVer + long
   deprecation cycles required.

2. **API churn** — New cases will surface (Linux+user-namespaced systemd,
   Windows via Scoop, FreeBSD rc.d). Each addition risks breaking
   existing consumers.

3. **Test surface explodes** — Today we test ariaflow. A library tests
   every cell of `managed_by × installed_via × failure_mode`. Easily
   ~20 minimum cases.

4. **Shell injection security** — `shell=True` with formula names from
   non-validated input = injection vector. Library must enforce strict
   argument whitelisting (regex, strict escape).

5. **Maintenance fatigue** — Open-source repo attracts issues + PRs +
   questions. No bandwidth = repo rots = bad reputation for ariaflow.

### 15.8 Concrete migration plan (Level 1)

If we go ahead with internal extraction:

```
Day 1 — TS side
  • Create packages/selfsupervise/ in ariaflow-server monorepo
  • Move detection (ariaflow_self.ts → selfsupervise/detect.ts)
  • Move restart_chain.ts → selfsupervise/chain.ts
  • Generalize "ariaflow-server" formula to a parameter
  • Move pkg-manager resolver (services.ts) → selfsupervise/pkg.ts
  • Re-export through public surface
  • Existing _lifecycle_actions.ts imports from new package

Day 2 — Python side
  • Create src/ariaflow_dashboard/selfsupervise/ package
  • Mirror module structure: detect.py, chain.py, pkg.py
  • Move detection + chain construction from install_self.py
  • install_self.py becomes thin wrapper passing formula="ariaflow-dashboard"
  • Add tests parity: golden tests on chain output match TS counterpart
```

Done = zero behavior change, just better-factored code, with both
Python and TS versions sharing the same module structure and test
fixtures.

### 15.9 Honest recommendation

**Level 1 unconditionally** — the duplication-elimination payoff alone
is worth ~2 days. Internal hygiene win, no public commitment.

**Level 2 cautiously** — wait 6 months living with Level 1, observe
which features get added naturally, **then** consider extracting with
a mature API rather than the first cut.

**Level 3 only if it becomes a primary project** — not as a side effect
of "we should reuse this". Genuine open-source projects need owners
with bandwidth.

### 15.10 The bigger reusable insight

If only one thing were extracted and shared, it should not be the code
but the **mental model of two orthogonal axes**:

```
Updates = (installed_via, managed_by) → upgrade_cmd × restart_cmd
```

Plus the cross-product table. This applies beyond brew/launchd:
Snap+systemd, Windows MSI+services, Docker+orchestrator, ChromeOS,
Android packages. A blog post titled "How to write a self-updating
service" with this framing might be more impactful than any lib.

---

## 16. Problem catalog by case — what went wrong, why, and how we fixed it

This section groups every observed problem by use-case and traces the
root cause through to the resolution. Each entry follows the same shape:
**Symptom → Trigger → Root cause → Fix → Test/verification**.

Cases are grouped by the layer where the problem manifests:

- §16.1 Process supervision (launchd / systemd)
- §16.2 Package manager interaction (brew)
- §16.3 Shell chain construction
- §16.4 Frontend orchestration
- §16.5 Auto-update poller
- §16.6 Cross-component (dashboard ↔ server)
- §16.7 Python runtime quirks
- §16.8 UX / reporting

---

### 16.1 Process supervision (launchd / systemd)

#### 16.1.1 `launchctl kickstart -k` silently no-ops

- **Symptom:** Click "Restart" → `launchctl kickstart -k gui/<uid>/<label>`
  returns 0, but the running process is still the old one. Operator
  retries, no effect.
- **Trigger:** Some plist `KeepAlive` configurations (specifically
  `KeepAlive: false` with `RunAtLoad: true`) cause `kickstart -k` to be a
  no-op on certain macOS versions. `kickstart` semantics changed across
  macOS 11 → 13 → 14.
- **Root cause:** `kickstart` is supposed to "kill and restart the
  service." With certain plist configs, launchd interprets this as
  "service has KeepAlive=false, so don't auto-restart" — the kill
  succeeds but the process doesn't come back.
- **Fix (BG-61):** Switch to `bootout` + `bootstrap` primitives:
  ```
  launchctl bootout gui/<uid>/<label> 2>/dev/null
  launchctl bootstrap gui/<uid> <plist_path>
  ```
  These are deterministic across macOS versions: `bootout` unloads,
  `bootstrap` re-loads from the plist. They don't depend on KeepAlive
  semantics.
- **Verification:** Manual restart on macOS 13 + 14, observed PID change
  and process logs.

#### 16.1.2 Plist not in `~/Library/LaunchAgents`

- **Symptom:** `bootstrap` fails with `Bootstrap failed: 5: Input/output error`
  or "service not found".
- **Trigger:** Operator installed via brew but moved the plist to
  `/Library/LaunchAgents` (system-wide) or somewhere custom.
- **Root cause:** Our chain hardcoded
  `~/Library/LaunchAgents/<label>.plist` for the bootstrap target.
- **Fix:** `buildPostUpgradeRestartSuffix()` returns null when the plist
  isn't where expected. The chain falls back to upgrade-only and the
  operator must restart manually. Documented limitation: "we don't
  second-guess your plist layout."
- **Verification:** Test added in `restart_chain.test.ts` simulating
  the plist-not-present case.

#### 16.1.3 Process not under launchd at all

- **Symptom:** Running from a terminal, click Restart → 409
  `manual_restart_required`.
- **Trigger:** Developer running `pnpm start` or `python -m ariaflow_dashboard`
  in a foreground shell.
- **Root cause:** `detectAriaflowManagedBy()` returns `external`. No
  supervisor to delegate to.
- **Fix:** Backend returns 409 with explanatory error. Dashboard falls
  back to `os.execv(sys.executable, [sys.executable, *sys.argv])`
  (Python can re-exec itself; Node can't easily).
- **Verification:** Run from terminal, observe 409 with sensible
  message. Python re-exec verified by PID change while keeping the
  same parent shell.

#### 16.1.4 systemd user session restart on Linux

- **Symptom:** Restart didn't take effect on Linux user-systemd.
- **Trigger:** Detection said `systemd`, but `systemctl restart ariaflow-server`
  needed the `--user` flag.
- **Root cause:** Default `systemctl` targets the system instance, not
  the per-user one. ariaflow runs as a user service.
- **Fix:** Use `systemctl --user restart ariaflow-server` explicitly.
- **Verification:** Manual test on Ubuntu 22.04 with user-systemd.

---

### 16.2 Package manager interaction (brew)

#### 16.2.1 brew not on launchd's PATH (BG-60)

- **Symptom:** Auto-update poller fires, log shows `brew: command not found`,
  exit code 127.
- **Trigger:** Process spawned by launchd inherits stripped PATH:
  `/usr/bin:/bin:/usr/sbin:/sbin`. brew lives at `/opt/homebrew/bin/brew`
  (Apple Silicon) or `/usr/local/bin/brew` (Intel), neither on launchd's
  default PATH.
- **Root cause:** `which brew` returns nothing in the spawned subprocess.
- **Fix (BG-60):** `_resolve_pkg_manager(name)` probes a known list of
  paths if `shutil.which` fails:
  ```
  /opt/homebrew/bin
  /usr/local/bin
  /home/linuxbrew/.linuxbrew/bin
  ~/.local/bin
  ```
  All shell commands use the absolute path returned, never bare `brew`.
- **Verification:** Restart laptop (cold launchd), trigger update,
  observe brew runs correctly.

#### 16.2.2 brew tap stale cache (HOMEBREW_AUTO_UPDATE_SECS)

- **Symptom:** `brew outdated` returns "no upgrade" minutes after a new
  bottle was published.
- **Trigger:** brew throttles tap refreshes via `HOMEBREW_AUTO_UPDATE_SECS`
  (default 300s). Two probes within 5 min → second one reads cached
  formula.
- **Root cause:** This is brew's intentional behavior to avoid
  hammering GitHub.
- **Fix:** `check_for_update()` runs `HOMEBREW_AUTO_UPDATE_SECS=0 brew update`
  before `brew outdated` to force a real tap refresh. Cost: ~1-3s
  extra per check.
- **Verification:** Push a new tap, click Check within 30s, observe
  the new version appear.

#### 16.2.3 Stale Cellar — running version ≠ installed version (BG-65)

- **Symptom:** `brew upgrade` says "Already up-to-date", but the running
  process is still on the old version. Statics 404 because Cellar
  directory referenced in `__file__` paths was cleaned up.
- **Trigger:** A previous `brew upgrade` extracted the new bottle but
  the running process never restarted. A subsequent `brew cleanup`
  deleted the old Cellar dir.
- **Root cause:** brew's bottles are extracted to `Cellar/<formula>/<version>/`
  with each version in its own dir. The old version was removed by
  cleanup, but the running process still has open file descriptors and
  paths into the deleted dir.
- **Fix (BG-65):** Change the chain separator from `&&` to `;` between
  upgrade and the restart suffix. With `;`, the restart fires
  unconditionally — even on a no-op upgrade, the running process gets
  realigned to the actually-installed cellar.
- **Verification:** Manually delete the Cellar dir of an old version,
  click Update, observe restart fires and statics resolve.

#### 16.2.4 Unlinked Cellar — installed but not linked (BG-66)

- **Symptom:** `bootstrap` fails with EX_CONFIG (78). The launchd plist
  references `/opt/homebrew/bin/ariaflow-dashboard` but the symlink
  doesn't exist.
- **Trigger:** A previous interrupted `brew install` (e.g. SIGKILL
  during install, network blip, install.sh racing with other operations)
  left the formula installed in `Cellar/` but the symlink in `bin/`
  was never created. Or `brew unlink <formula>` was run manually for
  some reason.
- **Root cause:** `brew upgrade` on an already-current formula no-ops
  WITHOUT re-linking. The chain proceeded to bootstrap, which failed
  because the launchd plist points to a non-existent binary path.
- **Fix (BG-66):** Insert `brew link --overwrite <formula> 2>/dev/null`
  between upgrade and bootstrap. `link --overwrite` is idempotent:
  succeeds whether already linked, just installed, or relinking.
  `2>/dev/null` because brew prints noise on the no-op path.
- **Verification:** `brew unlink ariaflow-dashboard`, click Update,
  observe full recovery.

#### 16.2.5 Source install rejected

- **Symptom:** Operator running from `git clone` clicks Update, expects
  it to work.
- **Trigger:** `detect_installed_via()` returns `source` (path inside
  a git tree).
- **Root cause:** Git checkouts can't be "upgraded" — the operator
  must `git pull && pnpm build` themselves.
- **Fix:** Return 409 with `error: source_install` + clear message.
  UI shows disabled Update button with tooltip explaining.
- **Verification:** Run from `git clone`, observe Update disabled.

#### 16.2.6 pipx upgrade probe not implemented

- **Symptom:** Probe returns `update_available: null` for pipx installs.
- **Trigger:** No `pipx outdated` equivalent that returns parseable output.
- **Root cause:** pipx doesn't have a stable JSON output for the
  outdated check. We deliberately don't implement a heuristic.
- **Fix:** Return 200 with `update_available: null` and a message
  `"pipx update probe not implemented; run \`pipx upgrade <pkg>\`
  manually"`. Update dispatch still works (pipx no-ops if current).
- **Verification:** Install via pipx, click Check, observe message.

---

### 16.3 Shell chain construction

#### 16.3.1 Self-suicide of the dispatching process

- **Symptom:** Click Update → response gets dropped before the body is
  fully written. Browser sees ERR_EMPTY_RESPONSE.
- **Trigger:** `bootout` killed the Python process before it finished
  flushing the HTTP response.
- **Root cause:** The chain ran in a subprocess attached to the parent
  Python's process group. SIGTERM from launchd's bootout propagated to
  the shell.
- **Fix:** Two combined measures:
  1. `subprocess.Popen(..., start_new_session=True)` — creates a new
     process group not tied to Python.
  2. webapp.py flushes the HTTP response BEFORE invoking the `after`
     callback that spawns the chain.
- **Verification:** Click Update, observe clean 202 in browser before
  process restart.

#### 16.3.2 `&&` short-circuits restart on no-op upgrade

- **Symptom:** brew upgrade says "Already up-to-date", chain stops at
  `&&`, restart doesn't fire, stale-cellar issue persists.
- **Trigger:** This was the original chain shape pre-BG-65. brew exits
  0 on no-op, but the operator wanted the restart anyway.
- **Root cause:** `&&` in shell only chains on the previous command's
  success-with-changes. brew "no-op" returns 0 (success) but the user
  intent was "always restart."
- **Fix (BG-65):** Switch to `;` separator (always fires).
- **Trade-off:** A no-op upgrade now triggers an unnecessary restart.
  Mitigated by frontend probe-first short-circuit (see §16.4.2).

#### 16.3.3 Inconsistent separators between dashboard and backend

- **Symptom:** Reading the code, dashboard uses `&&` between
  upgrade/link/bootout, backend uses `;` everywhere.
- **Trigger:** BG-65 was filed for the backend first. Later, the
  dashboard added FE-side probe-first short-circuit, which made `&&`
  safe again (no no-op upgrade reachable from UI).
- **Root cause:** Architectural divergence — both made independent
  decisions reasonable in isolation.
- **Fix:** Documented the discrepancy in §6.2. Not yet unified —
  candidate for §15 library extraction, where a shared `chain_builder`
  would force a single answer.

#### 16.3.4 `2>/dev/null` swallows useful diagnostics

- **Symptom:** When brew link fails for some reason, no error visible
  in the action log.
- **Trigger:** We added `2>/dev/null` to `brew link` to silence
  no-op diagnostics ("X is already linked to /opt/homebrew/...").
- **Root cause:** `2>/dev/null` is a bludgeon — silences all stderr,
  including legitimate errors.
- **Fix:** Accepted trade-off. The chain runs detached; we have no
  good way to surface stderr through the response anyway. Operator
  can inspect with `brew link --overwrite <formula>` manually if
  symptoms suggest link failure.
- **Future improvement candidate:** capture stderr to a known log
  file (`~/.ariaflow-dashboard/last_chain.log`) for diagnostics.

---

### 16.4 Frontend orchestration

#### 16.4.1 webVersionText not refreshing after restart

- **Symptom:** After successful restart, the Lifecycle tab title shows
  the old version. The Latest chip shows the new version. Operator
  confused: "did it update or not?"
- **Trigger:** Two sources of truth for the version. Title bound to
  `webVersionText` set from `window.__ARIAFLOW_DASHBOARD_VERSION__`
  injected at HTML render time. Latest chip bound to live API.
- **Root cause:** Page-load injection captures the version at the
  moment Python rendered index.html. After restart, the new Python
  process serves a new HTML with the new version, but the browser
  still has the old HTML cached for the current session.
- **Fix:** `_applyWebLifecycle()` updates `webVersionText` from the
  live `/api/web/lifecycle` response on every poll. Now restart
  completion reflects in title within ~3s.
- **Verification:** Click Restart, observe title updates without
  manual refresh.

#### 16.4.2 Update button restarts even when already current

- **Symptom:** Operator on v0.1.590 (latest) clicks Update. PID
  changes, "Restarting…" for 90s. Operator: "why did it restart,
  there's no update?"
- **Trigger:** FE dispatched `POST /update` without checking probe state
  first. Chain ran: `brew upgrade` no-op, but `;` separator + chain
  semantics meant bootout+bootstrap fired anyway.
- **Root cause:** Two independent design choices interacting badly:
  BG-65's `;` (always-restart safety) + lack of probe-first guard.
- **Fix:** Smart Update probe-first short-circuit:
  ```javascript
  if (action === 'update') {
    await this.checkDashUpdate();
    if (this._dashUpdateProbe === 'current') {
      this.resultText = `Already up to date (${vX}). Click Restart to bounce.`;
      return;  // ← no POST fires
    }
  }
  ```
- **Defense-in-depth:** Even if probe is stale and Update dispatches
  on a current version, the chain self-defends with `&&` between
  upgrade and link/bootout (dashboard) — won't restart on actual
  no-op.
- **Verification:** Click Update on current → no PID change. Click
  Update with real upgrade waiting → expected restart.

#### 16.4.3 Restart polling stuck on "Restarting…"

- **Symptom:** Click Restart, button shows spinner forever even though
  PID actually changed.
- **Trigger:** Completion detector only checked version change.
- **Root cause:** Restart-without-upgrade has no version change → never
  matches → loop times out at 90s.
- **Fix:** Detect completion by `versionChanged || pidChanged ||
  uptimeReset (uptime < 30s)`. Any of three triggers exit.
- **Verification:** Click Restart on a current version, observe
  spinner clears within ~10s.

#### 16.4.4 Auto-check race on cold tab visit

- **Symptom:** Operator opens Lifecycle tab cold, `_maybeAutoCheckUpdates`
  fires, but `webInstalledVia` is still null (lifecycle hasn't loaded
  yet) → check methods short-circuit silently.
- **Trigger:** `_maybeAutoCheckUpdates` was gated on `webUpdateSupported`,
  which depends on `webInstalledVia`. The lifecycle fetch is async
  and hasn't completed when the tab mounts.
- **Root cause:** Race condition between tab-mount hook and lifecycle
  data hydration.
- **Fix:** Remove the gate. Both `checkBackendUpdate()` and
  `checkDashUpdate()` are called unconditionally in
  `_maybeAutoCheckUpdates`; they themselves handle missing detection
  state gracefully (return null verdict).
- **Verification:** Cold-load tab, observe both probes fire and
  populate Latest chips.

#### 16.4.5 Loading state stuck on dashboard self after spawn

- **Symptom:** Click Update → button stays in spinner after Python
  process restarts (a new Python takes over but FE doesn't know).
- **Trigger:** FE polls `/api/web/lifecycle` but the connection drops
  during restart. Timeout is 90s.
- **Root cause:** WS reconnection + freshness-router needed re-bootstrap
  after the new Python took over.
- **Fix:** Polling at 3s/8s/15s/30s captures the new Python typically
  within 8-15s on a normal machine. Detection by version OR PID OR
  uptime reset means "first thing that changes" exits the loop.
- **Verification:** Click Update with simulated slow restart (10s
  delay), observe spinner clears as expected.

---

### 16.5 Auto-update poller

#### 16.5.1 Poller never fires

- **Symptom:** Auto-update toggled on, days pass, no `auto_update_check`
  entries in action log.
- **Trigger:** Daemon thread crashed silently on first iteration.
- **Root cause:** Initial implementation didn't catch exceptions inside
  the loop; an unhandled exception killed the thread.
- **Fix:** Wrap the iteration body in `try/except Exception` and log
  the error as `auto_update_dispatch / failed / poller_error`.
  Loop continues on next interval.
- **Verification:** Inject a bug deliberately (raise inside
  `_run_check_once`), observe action log entry + loop survives.

#### 16.5.2 Interval change doesn't take effect

- **Symptom:** Operator changes `auto_update_check_hours` from 24 to 1;
  next check still 24h later.
- **Trigger:** Backend timer reads cadence at `launch()` time; doesn't
  re-arm on declaration patch.
- **Root cause:** Documented design: `setInterval(tick, ms)` fires at
  fixed cadence; changing it requires restart.
- **Fix:** Documented limitation. Operator restarts the backend after
  changing the interval. The toggle (on/off) IS picked up at each
  tick (declaration is re-loaded inside `tick()`).
- **Future improvement candidate:** Store a `nextTick = now + interval`
  computed from the latest declaration; tick checks the wall clock and
  re-arms if interval changed.

#### 16.5.3 Two updates in flight (theoretical race)

- **Symptom:** Never observed. Theoretical: poller tick during a manual
  update click.
- **Trigger:** Concurrent dispatches.
- **Root cause:** Each tick / click independently spawns a detached
  shell.
- **Defense:** Backend has `inFlight` guard in poller. Manual clicks
  bypass this guard. The chain itself is idempotent (brew detects
  concurrent operations and one waits or fails clean).
- **Verification:** Stress-tested: 5 simultaneous Update clicks ⇒ one
  succeeds, others see "Operation in progress" or fail clean.

#### 16.5.4 No-upgrade-channel skip not logged

- **Symptom:** Operator on a `pip` install (no probe wired), confused
  why poller seems silent.
- **Trigger:** Poller short-circuited on `installed_via in (None, 'source')`
  without recording an action.
- **Fix:** Added `record_action('auto_update_skip', outcome='unchanged',
  reason='no_upgrade_channel', detail={installed_via})`. Operator
  sees explicit skip entries every poll, can diagnose.
- **Verification:** Install via pip, enable auto-update, observe skip
  entries in action log every interval.

---

### 16.6 Cross-component (dashboard ↔ server)

#### 16.6.1 Dashboard updates faster than server, version mismatch

- **Symptom:** Dashboard shows "server is on old version" because
  ariaflow-server didn't auto-update first.
- **Trigger:** Both have auto-update enabled, but cadences are
  unsynchronized. Dashboard's poller fires 30 min before the backend's.
- **Fix (orchestration):** `update_server_first` config flag (default
  `True`). When enabled, dashboard's poller calls
  `POST /api/lifecycle/ariaflow-server/update` BEFORE its own
  dispatch_update. Best-effort: failure is non-blocking.
- **Verification:** Dashboard 5h interval, backend 6h interval, both
  at "available" → operator sees server upgrade ~1s before dashboard.

#### 16.6.2 Server unreachable during update_server_first

- **Symptom:** Dashboard auto-update fires, server is down, dashboard
  hangs on the orchestration call.
- **Trigger:** `urllib.request.urlopen()` without timeout.
- **Fix:** `timeout=5` on the HTTP request. If 5s no response, log as
  `auto_update_server_kick / failed / server_unreachable` and proceed
  with dashboard's own update.
- **Verification:** Stop backend, trigger dashboard auto-update,
  observe 5s pause + skip + dashboard update proceeds.

#### 16.6.3 Server's update endpoint returns 404 (route changed)

- **Symptom:** Dashboard logs `auto_update_server_kick / failed / status:404`.
- **Trigger:** Backend version older than the route was added.
- **Root cause:** No handshake between dashboard and backend on
  supported routes.
- **Fix:** Treat 404 as "best-effort failure", continue dashboard's
  own update. Operator sees the entry in action log; if persistent,
  they upgrade the server manually.
- **Future improvement candidate:** Discovery via `/api/_meta` (BG-?)
  that lists supported routes; dashboard skips orchestration calls
  for routes the backend doesn't know.

#### 16.6.4 Dashboard installs server but server fails to start

- **Symptom:** Click Install (server cold-start), server installed
  but Restart Recovery loop fails.
- **Trigger:** brew install creates the plist, but launchd doesn't
  auto-bootstrap until next login or operator action.
- **Fix:** Recovery banner CTA ("Recover") visible when
  `_consecutiveFailures > 0 && plist_present === true`. Click
  triggers `brew services restart ariaflow-server`.
- **Verification:** Fresh install in CI, click Install, observe banner
  appearing within ~10s, click Recover, observe service starts.

---

### 16.7 Python runtime quirks

#### 16.7.1 EX_CONFIG (78) on Python 3.9 from PEP 604 syntax

- **Symptom:** Dashboard 0.1.583 failed launchd spawn with EX_CONFIG.
  No stderr output (launchd discards stderr by default).
- **Trigger:** Code used `def f(x: Path | None) -> ...:` (PEP 604).
  macOS launchd spawned with system Python 3.9, which doesn't support
  PEP 604.
- **Root cause:** `pyproject.toml` declares `requires-python = ">=3.10"`,
  but launchd doesn't honor that. It picks whatever Python is at the
  brew bottle's declared shebang. The brew bottle was built with
  python@3.10 but the bottle's symlinks resolved to system python@3.9
  on some machines.
- **Fix:** Use `Optional[Path]` from `typing` instead of `Path | None`.
  Documented in `install_self.py:50-55` to prevent regression.
- **Recovery:** Operator had to manually run
  `brew link --overwrite ariaflow-dashboard && brew upgrade
  ariaflow-dashboard && brew services restart ariaflow-dashboard`.
- **Verification:** CI now runs Python 3.9 import smoke test on
  install_self.py.

#### 16.7.2 `os._exit(0)` vs `sys.exit(0)` in docker case

- **Symptom:** In docker mode, restart didn't trigger orchestrator
  rebuild.
- **Trigger:** Used `sys.exit(0)`, which raises SystemExit. Some
  exception handlers caught it.
- **Fix:** `os._exit(0)` — bypasses exception handlers and Python
  cleanup. Direct OS exit, orchestrator sees clean exit code 0.
- **Verification:** Docker restart policy `on-failure`, observe
  container restart on click.

#### 16.7.3 `os.execv` re-exec keeps same PID but loses connections

- **Symptom:** "external" supervisor mode, click Restart, FE polling
  detects no PID change → assumes restart didn't happen.
- **Trigger:** `os.execv` keeps the same PID by design.
- **Fix:** FE detection includes `uptimeReset` (uptime < 30s) as a
  signal. After execv, uptime resets to 0, which the FE picks up.
- **Verification:** Run from terminal (`external` mode), click Restart,
  observe spinner clears.

---

### 16.8 UX / reporting

#### 16.8.1 "Already up to date" misleading after just-completed update

- **Symptom:** Just clicked Update, upgrade completed, UI shows v0.1.589
  but says "Up to date (0.1.589)" with stale-feeling phrasing.
- **Trigger:** webVersionText updated to v0.1.589 + Latest chip says
  "current". Looks redundant / stale.
- **Fix:** Action's resultText updated to mention "Already up to date
  (0.1.589). Click Restart to bounce." only when probe-first
  short-circuited. After successful upgrade, resultText is set from
  completion detection ("Update completed: v0.1.588 → v0.1.589").
- **Verification:** Two flows tested: click Update on current vs click
  Update with real upgrade.

#### 16.8.2 Polling intervals too aggressive (3s) for slow restarts

- **Symptom:** Operator on slow disk, restart takes 25s; FE polls 3s,
  8s, 15s — first two return old version, gives up at 30s mark before
  restart actually completes.
- **Trigger:** Aggressive early polling expects restart < 15s.
- **Fix:** Extended polling: 3s, 8s, 15s, 30s, then every 5s up to 90s
  total. Captures both fast and slow restarts.
- **Verification:** Simulate slow restart (sleep 25s in plist), observe
  detection at ~30s mark.

#### 16.8.3 Action log noise from "no_upgrade_channel" skips every interval

- **Symptom:** Operator on `pip` install enables auto-update;
  action log shows `auto_update_skip` every 24h ad infinitum.
- **Trigger:** Poller logs every iteration.
- **Trade-off:** This is by design — operator can audit the poller is
  alive. Without these entries, "is it broken or just sleeping?" is
  ambiguous.
- **Future improvement candidate:** Log only state-change ("now
  skipping" / "now polling"), not every tick.

#### 16.8.4 "Recover" banner shown spuriously on stale state

- **Symptom:** Recovery banner appears for ~3s on tab open before FE
  has fetched fresh data.
- **Trigger:** `lifecycleStaleOverlay` returned true while initial
  fetch was in flight.
- **Fix:** Gate banner on `_consecutiveFailures > 0` (FE must have
  attempted at least once and failed). Skips the false-positive on
  cold load.
- **Verification:** Cold load, observe no banner; force backend down,
  observe banner after first failed poll.

---

### 16.9 Lessons distilled

Looking back across all these problems, several patterns emerge:

1. **Two sources of truth always cause drift.** `webVersionText` from
   page-load vs from API. Backend chain `;` vs dashboard chain `&&`.
   Whenever the same fact is computed twice, expect divergence.

2. **Silent failure modes are the worst.** EX_CONFIG, kickstart no-op,
   poller crash without log. Fix: log everything, even successes,
   even skips.

3. **Idempotency saves you from race conditions you didn't think of.**
   `brew link --overwrite` works on already-linked. `bootout 2>/dev/null`
   works on already-dead. `brew upgrade` works on already-current.
   Build chains out of idempotent primitives.

4. **The OS doesn't care about your assumptions.** launchd PATH stripped,
   plist locations vary, Python version differs from pyproject.toml.
   Probe at runtime, never assume.

5. **Defense in depth beats single guards.** Probe-first short-circuit
   PLUS chain `&&` defense PLUS audit log. Any one of the three
   could fail; the other two catch it.

6. **Document the bug in the code.** Every BG-XX is a comment in the
   source pointing at the historical fix. Future engineers (including
   future-you) need this context.

7. **Async / detached subprocess is the right abstraction for
   self-suicide.** Send response, then spawn shell with new session,
   then die.

8. **The restart chain is a 4-step ritual that took 10 BGs to perfect.**
   Each step has a reason. Don't simplify without understanding why.

---

## 17. Coherence verification across the 3 targets

Audit performed by reading the source of all three update paths and
cross-checking against this document. Goal: surface every inconsistency
between dashboard / server / aria2, classify each as intentional or
gap, and recommend whether to align.

### 17.1 Coherence matrix

The full feature matrix per target:

| Capability | Dashboard | Server | Aria2 |
|---|:-:|:-:|:-:|
| `check_update` endpoint (probe) | ✅ `/api/web/lifecycle/.../check_update` | ✅ `/api/lifecycle/ariaflow-server/check_update` (BG-59) | ❌ none |
| FE probe-first short-circuit | ✅ `webLifecycleAction` | ✅ `lifecycleAction` (server target) | ❌ no FE probe |
| Manual Update endpoint | ✅ | ✅ | ✅ |
| Manual Restart endpoint | ✅ | ✅ | ✅ (separate from update) |
| `brew upgrade` step | ✅ | ✅ | ✅ |
| `brew link --overwrite` step | ✅ (BG-66) | ✅ (BG-66) | ❌ deliberate |
| `launchctl bootout` step | ✅ | ✅ | ❌ deliberate |
| `launchctl bootstrap` step | ✅ | ✅ | ❌ deliberate |
| Configurable `auto_restart_after_upgrade` | ✅ | ✅ | n/a (no restart) |
| Auto-update poller | ✅ Python `auto_update.py` | ✅ Node `_auto_update_controller.ts` | ❌ none |
| pipx install path | ✅ | ✅ | ❌ deliberate (n/a, aria2 not on pipx) |
| pip install path | ✅ | ❌ (Node, no pip) | ❌ |
| npm install path | ❌ (Python, no npm) | ✅ | ❌ |
| source install path | ✅ rejected with 409 | ✅ rejected with 409 | n/a |
| Action log entries | ✅ full set | ✅ full set | 🟡 minimal (only `lifecycle.update`) |

### 17.2 Inconsistency #1 — Chain separator divergence (dashboard `&&`, server `;`)

#### What
- **Dashboard chain:** `brew upgrade && brew link && bootout ; bootstrap`
- **Server chain:** `brew upgrade ; brew link ; bootout ; bootstrap`

#### Status: **intentional, documented, coherent in context**

The dashboard's `&&` is safe **because** the dashboard has FE-side
probe-first short-circuit (§16.4.2). On a no-op upgrade reaching the
chain (theoretical only), `&&` correctly skips the unnecessary restart.

The server's `;` is the BG-65 fix: even if FE-side probe-first
fails or is bypassed, the chain itself realigns the running process
to the cellar.

Both behaviors are correct for their respective trust models:
- Dashboard trusts FE probe-first (cheap, same-machine)
- Server trusts chain to self-correct (defensive, no FE-side guards)

#### Could we align?

Yes, by extracting the chain builder into a shared library (§15) with
a single configurable preset. Until then, document the divergence
prominently (already done in §6.2 and §16.3.3).

**Recommendation:** keep as-is. Align via library extraction (Level 1
internal, ~2 days) when the maintenance friction becomes annoying.

### 17.3 Inconsistency #2 — Aria2 has no probe-first short-circuit

#### What
Click "Update" on aria2 always dispatches `brew upgrade aria2`.
Dashboard and server first probe; aria2 doesn't.

#### Status: **gap — should be aligned**

Source confirmation:
- `_lifecycle_actions.ts:55` only handles `ariaflow-server` for
  `check_update` action.
- No `dispatchAria2CheckUpdate` function exists.
- FE has no `checkAria2Update()` method.

#### Consequence
- Operator clicks Update on aria2 → unconditional `brew upgrade aria2`.
- If already current, brew no-ops (no harm), but the action log still
  shows a dispatch, which is confusing ("did it update or not?").
- No "Up to date (X.Y.Z)" reassurance message.

#### Why it might have happened
- aria2 has no restart chain (§5), so the cost of a no-op dispatch
  is much lower (just a brew tap refresh).
- aria2 update is rarer (third-party tool, slower release cadence).
- Less operator-visible — aria2 typically managed via its lifecycle
  buttons, not Update.

#### Recommendation
- **Low priority** but worth aligning for consistency. Add:
  - `dispatchAria2CheckUpdate` in `_lifecycle_actions.ts` (mirror BG-59 logic)
  - Route in `lifecycle.ts` for `aria2/check_update`
  - `checkAria2Update()` method in `app.ts`
  - Probe-first short-circuit in the aria2 Update click handler
- File as a frontend gap pending backend support.
- **Effort:** ~½ day across both repos.

### 17.4 Inconsistency #3 — Aria2 not in auto-update poller

#### What
The backend's `_auto_update_controller.ts` only auto-updates
`ariaflow-server`. No tick path handles aria2.

#### Status: **gap — should be aligned**

Source confirmation:
- `_auto_update_controller.ts:107` calls
  `detectAriaflowInstalledVia()`, never `detectBinaryInstalledVia(findAria2c())`.
- No equivalent of `applyUpdate(installedVia, autoRestart)` for aria2.

#### Consequence
- Operator enables auto-update → server keeps current.
- Aria2 stays on whichever version was installed manually.
- Operator must remember to click aria2 Update periodically.
- Discouvert: silent divergence between server and aria2 versions
  potentially incompatible.

#### Why it might have happened
- BG-45 (auto-update) and BG-46 (aria2 update) shipped separately.
- aria2 is "third-party," there's been less of a push to auto-update it.
- aria2's release cadence is slow — an outdated aria2 rarely breaks anything.

#### Recommendation
- **Medium priority.** Aria2 versions affect download behavior subtly.
- Add an aria2 path to the same poller:
  ```ts
  if (installedVia === "homebrew") {
    const aria2Probe = await brewOutdatedFormula("aria2");
    if (aria2Probe.available) {
      detached(brew, ["upgrade", "aria2"]);
      record({ action: "auto_update_applied", target: "aria2" });
    }
  }
  ```
- Reuse `auto_update` toggle (single switch covers both targets).
- Or add a separate `auto_update_aria2` toggle for those who want to
  pin aria2.
- **Effort:** ~½ day.

### 17.5 Inconsistency #4 — Aria2 no restart chain

#### What
Click "Update" on aria2 → just `brew upgrade aria2`. No bootout,
no bootstrap. The running aria2 keeps the old binary in memory.

#### Status: **intentional and documented**

Reasoning:
- aria2 is supervised by its own launchd plist (`homebrew.mxcl.aria2`)
  managed entirely outside ariaflow.
- aria2 has its own JSON-RPC for graceful restart if needed.
- A running aria2 process holds open file descriptors to in-progress
  downloads; killing it mid-transfer is hostile.
- The operator decides when aria2 actually restarts (via the
  separate Restart button on the aria2 row).

#### Consequence
- After Update, aria2 binary on disk is new but running process is
  old. Until next aria2 restart, behavior unchanged.
- This **is** the design intent — operator has explicit control.

#### Could we align?
Adding a chain restart for aria2 would:
- Require detecting aria2's launchd label (`homebrew.mxcl.aria2`)
- Risk breaking in-flight downloads if operator dispatches Update
  during heavy usage

**Recommendation:** keep as-is. The asymmetry reflects different
domain semantics: ariaflow-* are stateless services; aria2 is a
state-holding download engine.

#### What we should improve
The doc could be clearer. Add a tooltip on the aria2 Update button:
"This updates the binary on disk. Click Restart to apply."
**Effort:** ~10 min UI tweak.

### 17.6 Inconsistency #5 — Action log granularity differs

#### What
- Dashboard self path emits: `auto_update_check`, `auto_update_dispatch`,
  `auto_update_skip`, `auto_update_server_kick`, `lifecycle.update`,
  `lifecycle.restart`, `lifecycle.check_update`.
- Server path emits: `auto_update_check`, `auto_update_applied`,
  `lifecycle.update`, `lifecycle.restart`, `lifecycle.check_update`.
- Aria2 emits: only `lifecycle.update`.

#### Status: **partial gap, mostly cosmetic**

Naming differences (`auto_update_dispatch` vs `auto_update_applied`)
are historical accidents — different teams, different naming choices,
never reconciled.

#### Consequence
- Filtering in the Activity tab is harder ("show me all auto-update
  activity" needs N filters).
- Aria2 has no auto-update entries at all (consistent with §17.4 gap).

#### Recommendation
- **Low priority.** Align naming in a future cleanup pass:
  - Standardize on `auto_update.{check, dispatch, skip}` (period-separated)
  - Or `auto_update_check / auto_update_apply / auto_update_skip`
- File as a paired BG/FE gap for the next refactor cycle.
- **Effort:** ~1h to rename consistently + update Activity filter UI.

### 17.7 Inconsistency #6 — Different installer paths handled per target

#### What

| Target | brew | pipx | pip | npm | source |
|---|:-:|:-:|:-:|:-:|:-:|
| Dashboard | ✅ | ✅ | ✅ | n/a | ✅ rejected |
| Server | ✅ | ✅ | n/a | ✅ | ✅ rejected |
| Aria2 | ✅ | n/a | n/a | n/a | n/a |

#### Status: **intentional, reflects domain reality**

- Dashboard is Python: brew/pipx/pip/source are valid
- Server is Node: brew/pipx (Node packages can be repackaged via pipx)/npm/source
- Aria2 is C++: only brew distributes it on macOS

The asymmetry is the **right asymmetry**.

### 17.8 Coherence verdict

The 3 cases are logically coherent **given their domain differences**.
The asymmetries that exist fall into two buckets:

**Intentional and correct:**
- Aria2 no restart chain (§17.5) — domain semantics
- Different installer paths per target (§17.7) — language reality
- Chain separator dashboard vs server (§17.2) — different trust models

**Gaps that should be aligned (in priority order):**

| Gap | Effort | Priority |
|---|---|---|
| §17.4 Aria2 not in auto-update poller | ~½ day | Medium |
| §17.3 Aria2 no probe-first short-circuit | ~½ day | Low-Medium |
| §17.6 Action log naming inconsistencies | ~1h | Low |
| §17.5 Aria2 Update tooltip clarity | ~10 min | Low |

**Total to fully align:** ~1.5 days.

### 17.9 What to do about the gaps

The 4 gaps are non-blocking. They reflect organic growth: dashboard
and server were the primary focus, aria2 was a third-party tool added
for completeness. The gaps don't hurt operators today.

**Recommendation:** leave gaps open as known limitations, file paired
BGs for tracking, address opportunistically when touching the
respective code. Don't do a dedicated cleanup sprint.

### 17.10 What WOULD make a refactor mandatory

Two scenarios would force aligning:

1. **Library extraction (§15 Level 1):** if we extract a shared
   `selfsupervise` package, the API design forces a single answer for
   each variation point. The 3 cases all consume the same primitives
   and inconsistencies disappear naturally.

2. **A new target is added** (e.g. a new headless service ariaflow
   manages): copy-pasting the existing logic for a 4th target makes
   the inconsistencies multiplicative. Library extraction at 4 targets
   is unavoidable.

Until then, 3 targets × ~6 cells of asymmetry is manageable.

---

## 18. CI / release pipeline — current state and gaps

Audit of the GitHub Actions workflows in both repos as they exist today,
with focus on what would be needed to match the "clean update model"
(Sigstore signature, provenance attestation, post-release health check,
rollback symmetry).

### 18.1 Current CI inventory

#### Frontend repo (`ariaflow-dashboard`) — 2 workflows

| Workflow | Lines | Trigger | What it does |
|---|---|---|---|
| `test.yml` | 62 | push main / PR | Matrix Python 3.10-3.13 + Node 22; typecheck/build/test/lint TS; tests + ruff Python |
| `release.yml` | 329 | push main / push tag / dispatch | 2-job pipeline: live-contract + build-release |

**`release.yml` job 1 — `live-contract`** (BG-26 fix):
- Checkout dashboard + `bonomani/ariaflow-server` main
- Setup Node 22, pnpm 9, Python 3.12, aria2
- Build + start ariaflow-server on :8000
- Run `pytest -m slow tests/test_backend_live_contract.py`
- Catches "frontend shipped, backend deploy stale" hazard

**`release.yml` job 2 — `build-release`** (depends on job 1):
1. Resolve version (tag, dispatch input, or auto-bump patch)
2. Build frontend bundle (`npm run build`)
3. Commit version bump in `pyproject.toml` + `__init__.py` + `static/dist`
4. `make verify` (drift + tests)
5. `python -m build --sdist` → tarball Python
6. **Publish to PyPI** (with `PYPI_TOKEN`, `continue-on-error: true`)
7. Rename tarball → `release/ariaflow-dashboard-vX.Y.Z.tar.gz`
8. Push commit + tag
9. Checkout `bonomani/homebrew-ariaflow` (with `ARIAFLOW_TAP_TOKEN`)
10. Render formula via `scripts/homebrew_formula.py`
11. Commit + push tap update
12. Verify tap version match (6-attempt loop)
13. **Create GitHub release** with `release/*` files
14. **Automatic rollback** on failure (revert tap commit + delete tag)

#### Backend repo (`ariaflow-server`) — 5 workflows

| Workflow | Lines | Trigger | What it does |
|---|---|---|---|
| `node.yml` | 22 | push main / PR | `pnpm install + build + typecheck + lint + test` |
| `auto-tag.yml` | 86 | `workflow_run` after node CI success | Auto-bump patch tag with PAT |
| `release-formula.yml` | 83 | push tag `v*` | Render formula, attach as release asset |
| `release-tap.yml` | 105 | push tag `v*` | Push formula to `bonomani/homebrew-ariaflow-server` |
| `release-npm.yml` | 186 | push tag `v*` | Publish `@ariaflow/{core,api,cli}` to npm |

**Auto-tag flow (BG-45 era)**:
- Gates on `node.conclusion == 'success'` + branch main
- Skip if commit already tagged
- Bump latest patch (`vX.Y.Z` → `vX.Y.Z+1`)
- Push tag with `TAP_PUSH_TOKEN` PAT (GITHUB_TOKEN wouldn't trigger downstream workflows)

**Tag push fans out to 3 parallel jobs**:
- `release-formula` → renders + attaches formula
- `release-tap` → pushes to brew tap
- `release-npm` → publishes to npm

### 18.2 What's already excellent

- ✅ **Tests + lint + typecheck** on both repos
- ✅ **Live-contract test** on dashboard (catches cross-repo regressions)
- ✅ **Auto-bump versioning** (patch incremented automatically)
- ✅ **Multi-channel distribution** (npm + brew tap + GitHub releases on backend)
- ✅ **GitHub releases with artifacts** on both repos
- ✅ **Smoke check** of rendered formula (verifies key sections)
- ✅ **Skip on Release commits** (avoids auto-bump infinite loop)
- ✅ **Automatic rollback on dashboard release** (revert tap commit + delete tag)

### 18.3 Gap matrix vs the "clean update model"

| Capability | Dashboard | Backend | Status |
|---|:-:|:-:|:-:|
| Sigstore signature on release artifacts | ❌ | ❌ | **GAP** |
| GitHub provenance attestation | ❌ | ❌ | **GAP** |
| GPG signature (optional 3rd layer) | ❌ | ❌ | gap (low priority) |
| SHA256 manifest published as separate asset | ❌ | ❌ | gap (brew handles internally) |
| Apple Developer ID code signing | ❌ | ❌ | n/a (brew strips quarantine) |
| Health check post-release on operator machines | ❌ | ❌ | **GAP** |
| Automatic rollback | ✅ | ❌ | **GAP** (asymmetry) |
| Live-contract pre-release test | ✅ | ❌ | gap (cross-direction) |

### 18.4 Gap #1 — No Sigstore signature on releases

#### What's missing
Neither repo signs its release artifacts. Operators have no cryptographic
way to verify that what they auto-update came from the legitimate CI
pipeline. They rely on:
- 2FA on GitHub (mitigates account compromise)
- HTTPS (mitigates network MITM)
- brew's SHA256 (mitigates download corruption)

But not on cryptographic supply-chain integrity.

#### Effort to fix
**Trivial.** ~10 lines per workflow.

For dashboard's `release.yml`, add after "Rename release artifact"
(line 222-226), before "Create release" (line 304):

```yaml
- name: Install cosign
  uses: sigstore/cosign-installer@v3

- name: Sign release artifact
  run: |
    cd release
    for f in *.tar.gz; do
      cosign sign-blob --yes \
        --output-signature="${f}.sig" \
        --output-certificate="${f}.pem" \
        "${f}"
    done

# Then in "Create release":
- name: Create release
  uses: softprops/action-gh-release@v2
  with:
    files: |
      release/*.tar.gz
      release/*.sig
      release/*.pem
```

For backend's `release-formula.yml`, similar ~10 lines after "Render
formula":

```yaml
- name: Install cosign
  uses: sigstore/cosign-installer@v3

- name: Sign formula
  run: |
    cosign sign-blob --yes \
      --output-signature="dist-formula/ariaflow-server.rb.sig" \
      --output-certificate="dist-formula/ariaflow-server.rb.pem" \
      dist-formula/ariaflow-server.rb

# Then update files: in upload step:
files: |
  dist-formula/ariaflow-server.rb
  dist-formula/ariaflow-server.rb.sig
  dist-formula/ariaflow-server.rb.pem
```

#### Total effort
- 30 min per repo for CI changes
- ~3h per repo for client-side verification (see §15.x and signature
  verification approach C)
- **~1 day total** for both repos, fully signed and verified

### 18.5 Gap #2 — No provenance attestation

#### What's missing
GitHub Actions can produce SLSA / in-toto build provenance attestations
that cryptographically prove "this artifact was produced by THIS
workflow on THIS commit by THIS runner." Verifiable with `gh attestation
verify`.

#### Why it matters
Even simpler than Sigstore for consumers — uses GitHub's own infrastructure
and the `gh` CLI most operators already have installed.

#### Effort to fix
**Even more trivial than Sigstore.** ~5 lines per workflow.

```yaml
- name: Generate artifact attestation
  uses: actions/attest-build-provenance@v2
  with:
    subject-path: 'release/*.tar.gz'   # or dist-formula/*
```

Verification client-side:
```bash
gh attestation verify <file> --owner bonomani
```

No additional dep needed (the `gh` CLI is part of standard dev setup).

#### Combine with Sigstore
Both can coexist — provenance + Sigstore offer defense in depth:
- Sigstore = "the artifact was signed by my CI's OIDC identity"
- Provenance = "the artifact was built by THIS workflow on THIS commit"

Different attack vectors covered.

### 18.6 Gap #3 — No health check post-release

#### What's missing
The `live-contract` test runs **before** publishing the release. It
verifies the dashboard works against backend `main` at build time.
But once the release is published and operators auto-update, there's
no automated check that:
- The published bottle actually downloads correctly
- The new version starts up on a real macOS launchd
- Critical endpoints respond correctly post-restart

The first complaint signal we get is from operators ("X is broken").

#### Why it matters
A broken release auto-deployed to family machines = bad day. Without
health-check, operators discover regressions; with it, the release is
gated before reaching them.

#### Effort to fix
**Significant — this is real work.** Several approaches:

**Approach A — Self-test the published bottle in CI (~½ day)**
After release publishes, spin up a clean macOS runner (or Linux), run
`brew install bonomani/ariaflow/ariaflow-dashboard@<new-version>`,
verify it starts, hits its own `/api/health`. Fail the workflow if
it doesn't. Don't yet know how to "unpublish" a failed release.

**Approach B — Canary release with phased rollout (~3-5 days)**
Publish to a `latest-canary` channel first, only N% of operators (those
who opted in) get it. After a delay, promote to `stable`. This is
classic SaaS thinking — heavy for selfhost.

**Approach C — Operator-side rollback automation (~2 days)**
Each dashboard checks `/api/health` after self-update. If unhealthy
within 60s, automatically rolls back to previous version
(`brew install <formula>@<previous-version>`). Self-healing.

**Mon vote: Approach A first (½ day), Approach C later** if Approach
A doesn't catch enough regressions in practice.

### 18.7 Gap #4 — No automatic rollback on backend release

#### What's missing
The dashboard's `release.yml` has explicit rollback logic (revert tap
commit + delete tag) on failure. The backend's release pipeline (3
parallel jobs: formula + tap + npm) has none.

#### Consequence
If `release-tap` succeeds but `release-npm` fails:
- Brew users get the new version
- npm consumers stuck on previous
- Version skew across distribution channels

If the tag is later deleted to retry, the brew tap commit is orphaned.

#### Effort to fix
**Moderate.** ~30-50 lines added per workflow with revert logic
mirroring dashboard's `release.yml` lines 312-329.

Tricky parts:
- **Cross-job coordination** is harder than single-job. The 3 release
  jobs run in parallel; rollback would need to know if any failed.
- **npm publish is irreversible** — once published, you can only
  unpublish within 72h, and even then with restrictions.
- Probably needs a 4th orchestration job that gates release-tap
  on release-npm success, sequenced rather than parallel.

**Recommendation**: file as a backend gap (BG-XX). Lower priority
than Sigstore (Gap #1) because the failure surface is small.

### 18.8 Suggested execution order

If we attack the gaps in priority order:

| # | Gap | Effort | Impact |
|---|---|---|---|
| 1 | Sigstore on release.yml + release-formula.yml | ½ d | High (supply chain) |
| 2 | Provenance attestation | ¼ d | Medium (defense in depth) |
| 3 | Client-side verification of Sigstore | 1 d (both repos) | High (closes the loop) |
| 4 | Health-check Approach A | ½ d | High (catches broken bottles before users) |
| 5 | Backend release rollback symmetry | 1 d | Low (rare failures) |
| 6 | Health-check Approach C (auto-rollback client-side) | 2 d | Medium (self-healing) |

**Total to fully close all gaps: ~5 days.** First 3 (~2 days)
already cover 80% of the value.

### 18.9 What we should NOT add

To stay honest about scope:

- ❌ **EV code-signing certificate for Windows** — only useful if we
  distribute Windows installers outside winget. We don't.
- ❌ **Apple Developer ID + notarization** — only useful for DMG
  distribution outside brew. We don't.
- ❌ **Mac App Store / Microsoft Store / Snap Store onboarding** —
  none of these match selfhost distribution model.
- ❌ **Reproducible builds** — would prove the bottle matches the
  source commit. Worthwhile but ~weeks of work, low priority for now.
- ❌ **Custom signing infrastructure (HSM, key vault)** — Sigstore +
  provenance are good enough without managing a private key.

### 18.10 Cross-platform installation paths and signature coverage

A summary of what's signed and how operators verify across operating
systems and install methods.

#### Coverage matrix

| OS | Install method | Signature published | Verification command |
|---|---|---|---|
| macOS | `brew install bonomani/ariaflow/ariaflow-dashboard` | ✅ Sigstore + GH provenance | `cosign verify-blob` / `gh attestation verify` |
| Linux | Linuxbrew (same formula) | ✅ Sigstore + GH provenance | same as macOS |
| Linux | `pip install ariaflow-dashboard` (PyPI direct) | ❌ no PyPI attestation | n/a — see workaround below |
| Linux | `pipx install ariaflow-dashboard` | ❌ no PyPI attestation | n/a — see workaround below |
| Linux/Windows | `pip install <local file>` from GitHub release `.tar.gz` | ✅ Sigstore + GH provenance | `cosign verify-blob` (verify before install) |
| Windows native | brew n/a | n/a | use WSL or pip workaround |
| Windows WSL | Linuxbrew | ✅ same as Linux | same |

#### Workaround for pip/pipx users wanting cryptographic verification

Instead of installing from PyPI directly, install from the signed
GitHub release `.tar.gz`:

```bash
VERSION=0.1.591  # or whatever's current
BASE=https://github.com/bonomani/ariaflow-dashboard/releases/download/v${VERSION}

# Download the tarball + signature + cert
curl -L -O ${BASE}/ariaflow-dashboard-v${VERSION}.tar.gz
curl -L -O ${BASE}/ariaflow-dashboard-v${VERSION}.tar.gz.sig
curl -L -O ${BASE}/ariaflow-dashboard-v${VERSION}.tar.gz.pem

# Verify the Sigstore signature
cosign verify-blob \
  --certificate ariaflow-dashboard-v${VERSION}.tar.gz.pem \
  --signature ariaflow-dashboard-v${VERSION}.tar.gz.sig \
  --certificate-identity-regexp 'https://github.com/bonomani/ariaflow-dashboard/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ariaflow-dashboard-v${VERSION}.tar.gz

# Or verify the GitHub provenance attestation
gh attestation verify ariaflow-dashboard-v${VERSION}.tar.gz \
  --owner bonomani

# If verification passes, install the local file
pip install ./ariaflow-dashboard-v${VERSION}.tar.gz
```

Equivalent for Windows PowerShell or WSL. The sdist on PyPI and the
`.tar.gz` on GitHub release are byte-identical (both produced by the
same `python -m build --sdist` run in the release workflow), so
installing either yields the same package.

#### Why no native PyPI attestations yet

PyPI added attestation support in late 2024 via Trusted Publishing
(OIDC-based publishing without API tokens) + `pypa/gh-action-pypi-publish@release/v1`
with `attestations: true`. Adopting it requires:

1. PyPI account setup: configure Trusted Publishers for the project on
   https://pypi.org/manage/account/publishing/
2. Workflow change: replace twine with the `pypa/gh-action-pypi-publish`
   action, drop `PYPI_TOKEN` secret usage
3. Validate: next release shows the green "Verified" badge on PyPI

**Effort:** ~15 min in CI + a few clicks in PyPI's UI.

**Why deferred:** requires user-side action on the PyPI website — not
purely a code change. Filed as a follow-up; the GitHub-release
workaround above covers the verification need in the meantime.

#### Backend npm packages — see BG-70 in the paired repo

`@ariaflow/{core,api,cli}` published via `release-npm.yml` are not yet
published with `--provenance`. Same situation: the .tar.gz on GitHub
release is signed; the npm package isn't directly verifiable.
BG-70 in `../ariaflow-server/docs/BACKEND_GAPS_REQUESTED_BY_FRONTEND.md`
tracks the fix.

### 18.11 Open questions for these gaps

Before implementing:

1. **Cosign as a brew dependency** — the formulas would need to
   `depends_on "cosign"` so it's auto-installed. ~30s extra brew install
   time on first use. Acceptable?
2. **Verification opt-in or opt-out?** During rollout, default off. Once
   battle-tested (~1 month), default on with operator opt-out.
3. **What identity to enforce?** OIDC identity scope. Strict
   (`https://github.com/bonomani/.github/workflows/release.yml@refs/tags/v0.1.591`)
   vs loose (`^https://github.com/bonomani/.*`)? Loose is more
   forgiving but accepts compromises like "attacker pushes to a different
   workflow file in your repo." Probably the right balance is
   `^https://github.com/bonomani/ariaflow-dashboard/.github/workflows/release.yml@refs/tags/v.*`.
4. **Bootstrap problem** — first install can't verify a signature
   because no prior key state exists. Operator must trust the brew
   tap manually (as today). Subsequent updates are then verified.

---

## Appendix A — Configuration keys quick reference

### Dashboard `~/.ariaflow-dashboard/config.json`

| Key | Default | Range | Effect |
|---|---|---|---|
| `auto_update` | `false` | bool | Enable periodic poller |
| `auto_update_check_hours` | `24` | 1-720 | Interval between checks |
| `update_server_first` | `true` | bool | Kick server update before self |
| `auto_restart_after_upgrade` | `true` | bool | Chain restart-suffix to upgrade |
| `backend_url` | `""` | URL or empty | Override DEFAULT_BACKEND_URL |

### Backend declaration prefs

| Pref | Default | Effect |
|---|---|---|
| `auto_update` | `false` | Enable periodic poller |
| `auto_update_check_hours` | `24` | Interval |
| `auto_restart_after_upgrade` | `true` | Chain restart-suffix |
| `lifecycle_probe_interval_seconds` | (varies) | BG-63 lifecycle probe cadence |

---

## Appendix B — File-line index

For quick navigation when editing.

| File | Lines | Module function |
|---|---|---|
| `install_self.py:31-48` | `_resolve_pkg_manager` | PATH workaround |
| `install_self.py:61-83` | `detect_managed_by` | launchd/systemd/docker probe |
| `install_self.py:86-113` | `detect_installed_via` | brew/pipx/pip/source probe |
| `install_self.py:127-136` | `detect_launchd_label` | plist label discovery |
| `install_self.py:139-200` | `dispatch_restart` | restart per supervisor |
| `install_self.py:203-304` | `dispatch_update` + `_chain_restart` | update + chain |
| `install_self.py:307-382` | `check_for_update` | brew outdated probe |
| `install_self.py:385-400` | `_restart_via_bootstrap` | bootout+bootstrap helper |
| `install_self.py:403-432` | `detect_server_installed_via` | server's installer probe |
| `install_self.py:435-489` | `dispatch_server_lifecycle` | install/uninstall/update server |
| `install_self.py:492-503` | `_server_plist_path` | server plist locator |
| `install_self.py:506-522` | `server_lifecycle_probe` | server install snapshot |
| `install_self.py:525-565` | `dispatch_server_bootstrap` | recover via brew services restart |
| `install_self.py:568-575` | `_detached` | detached subprocess helper |
| `auto_update.py:30-49` | `DEFAULTS` | config defaults |
| `auto_update.py:52-90` | `load_config`/`save_config` | config IO |
| `auto_update.py:93-118` | `trigger_server_update` | best-effort server kick |
| `auto_update.py:121-189` | `_run_check_once` | one poller iteration |
| `auto_update.py:192-208` | `_poller_loop` | sleep + tick loop |
| `auto_update.py:211-218` | `start_poller` | spawn daemon thread |

Backend (paired repo, for cross-reference):

| File | Lines | Module function |
|---|---|---|
| `_lifecycle_actions.ts:40-110` | `dispatchAriaflowRestart` | restart per supervisor |
| `_lifecycle_actions.ts:117-190` | `dispatchAriaflowUpdate` | update + chain |
| `_lifecycle_actions.ts:198-249` | `dispatchAriaflowCheckUpdate` | BG-59 probe |
| `_lifecycle_actions.ts:256-294` | `dispatchAria2Update` | aria2 update |
| `restart_chain.ts:16-26` | `buildPostUpgradeRestartSuffix` | bootout+bootstrap suffix |
| `_auto_update_controller.ts:34-53` | `brewOutdated` | probe |
| `_auto_update_controller.ts:60-83` | `applyUpdate` | upgrade + chain dispatch |
| `_auto_update_controller.ts:96-164` | `createAutoUpdateController` | poller |
