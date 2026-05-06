# Plan — Dashboard-managed ariaflow-server lifecycle

> Status: planning. No code yet.

Today the dashboard can install / uninstall / upgrade only **itself**.
For ariaflow-server it depends on the server already running, because
every existing lifecycle hook goes through the server's API. This plan
adds dashboard-local endpoints that operate on ariaflow-server *without*
needing it to be up.

## Why

| Scenario | Today | After this plan |
|---|---|---|
| Operator installs only `ariaflow-dashboard`, opens the UI | "Backend unreachable" forever; must drop to terminal to `brew install ariaflow-server` | One-click "Install ariaflow-server" button when no backend found |
| Operator wants to upgrade the server | Works via server's own `/api/lifecycle/ariaflow-server/update` (BG-46) — but only if server is running | Works either way: dashboard-side path is the fallback when server is down |
| Operator wants to uninstall everything | `brew uninstall ariaflow-server && brew uninstall ariaflow-dashboard` from terminal | Two clicks from System Health (still confirm-gated) |

The cold-start case (#1) is the strongest reason — every other case has
a working alternative.

## Architecture

`webapp.py` already implements `/api/web/lifecycle/ariaflow-dashboard/*`
for the dashboard's self-management. The plan extends the same handler
to a second target, `ariaflow-server`, with the same dispatcher pattern.

```
Existing today (dashboard self):
  POST /api/web/lifecycle/ariaflow-dashboard/restart
  POST /api/web/lifecycle/ariaflow-dashboard/update

New (this plan, ariaflow-server target):
  POST /api/web/lifecycle/ariaflow-server/install
  POST /api/web/lifecycle/ariaflow-server/uninstall
  POST /api/web/lifecycle/ariaflow-server/update
```

The `lifecycleAction()` path on the FE is already split (backend-routed
`lifecycleAction()` vs dashboard-routed `webLifecycleAction()`). New
calls go through `webLifecycleAction('install', 'ariaflow-server')` etc.

## Phase A — Detection (small, low-risk)

Before any install button can sensibly render, the dashboard needs to
know:

1. **Is ariaflow-server installed locally?** — `brew list ariaflow-server`
   / `pipx list | grep ariaflow-server` / `which ariaflow-server`.
2. **What channel was it installed via?** — same heuristic
   `detect_installed_via()` in `webapp.py` already uses for the
   dashboard, applied with `package_name="ariaflow-server"` and
   `binary_name="ariaflow-server"`.
3. **What's the latest available version?** — `brew info ariaflow-server`
   parses the formula version. Optional; only needed for "update
   available" UX.

New endpoint:

```
GET /api/web/lifecycle/ariaflow-server/probe
  → { installed: bool, installed_via: "homebrew"|"pipx"|"npm"|"source"|null,
      version: string|null, latest_version: string|null,
      install_supported: bool }
```

The FE consumes this to decide:
- Show "Install" button when `installed: false` and the dashboard's own
  channel supports installs (homebrew/pipx).
- Show "Uninstall" button when `installed: true` and channel supports it.
- Show "Update" button when `installed: true` and `latest_version > version`.

**Effort:** ~half day. Mirrors existing detection code; just a
parameterized helper instead of a hardcoded `ariaflow-dashboard` name.

## Phase B — Install / Uninstall / Update endpoints

Three new endpoints in `webapp.py`, each implemented the same way as
the existing `dispatch_update()` / `dispatch_restart()`: spawn a
detached subprocess, return immediately with a "started" payload, let
the action log + the next discovery cycle confirm the result.

```
POST /api/web/lifecycle/ariaflow-server/install
  → {ok: true, started: true, command: "brew install ariaflow-server"}

POST /api/web/lifecycle/ariaflow-server/uninstall
  → {ok: true, started: true, command: "brew uninstall ariaflow-server"}

POST /api/web/lifecycle/ariaflow-server/update
  → {ok: true, started: true, command: "brew upgrade ariaflow-server"}
```

Each:
- Validates the channel (refuses pipx for a homebrew-installed dashboard
  to avoid mixing channels — install via the same channel as the
  dashboard itself, like BG-45 already does for auto-update).
- Returns 409 with `{reason: "channel_not_supported"}` for `source`
  installs (manual git clone — operator must do it themselves).
- Spawns the subprocess with `Popen` + `start_new_session=True` so it
  survives the dashboard's own restart if any.
- Records to the dashboard action log via `record_action()` so the
  Activity panel surfaces it.

**Effort:** ~1 day. Mostly testing the install path — `brew install`
takes ~30s and the FE needs progress feedback.

## Phase C — UX

Three places in the System Health → Components row for ariaflow-server:

1. **No backend reachable + no local install detected** → big "Install
   ariaflow-server" call-to-action card replacing the row entirely.
   "Install via `<dashboard's channel>` (~30s)" + Install button +
   short text "you'll see the components row populate once it's up".

2. **No backend reachable + local install detected** → row renders with
   the cached `probe` info ("ariaflow-server vX.Y.Z installed via
   homebrew · not running"). Show "Start" button (uses
   `brew services start ariaflow-server` or equivalent — needs Phase D
   to be useful).

3. **Backend reachable** → today's row shape, but the action strip
   gains a "Reinstall" / "Uninstall" pair behind a `<details>` so it's
   not noisy by default.

Action log entries from Phase B surface in the Activity panel
automatically.

**Effort:** ~1 day. The CTA card design matters — operators landing
on a fresh dashboard need a clear path forward.

## Phase D — Start/stop a stopped local server (optional)

If ariaflow-server is installed locally but not running, the dashboard
could `brew services start ariaflow-server` to bring it up. This crosses
into "service manager" territory and adds OS-specific paths (launchd
on macOS, systemd on Linux).

**Defer.** Phase C without this is still useful: the operator can start
the server from the terminal if needed. Build Phase D only when there's
operator demand.

## Sequencing

```
Phase A ──► Phase B ──► Phase C ──► (optional) Phase D
detect      endpoints   UI          start/stop
```

All three phases ship together as a coherent feature; A+B+C is the
minimum useful unit. Phase D is parallel/optional.

## Constraints / decisions to surface

- **Channel coupling.** The dashboard installs ariaflow-server via the
  same channel it was installed itself. Mixed channels (dashboard via
  homebrew, server via pipx) are rejected. Rationale: avoids surprise
  at upgrade time.
- **Source installs are read-only.** Manual git-clone installs return
  409 from the install/uninstall/update endpoints. The probe endpoint
  surfaces `install_supported: false` so the FE hides the buttons.
- **Async dispatch.** All three are fire-and-forget — the FE shouldn't
  block on `brew install` completing. Polling the probe endpoint after
  ~5s + on every discovery cycle catches the "now installed" transition.
- **No partial states.** If the install fails mid-way, the operator
  sees the action log entry with the error; the dashboard doesn't try
  to "clean up" — `brew` handles that.
- **Auth.** Same auth model as the existing `webLifecycleAction` path
  (none today, in line with the rest of the dashboard's local-only
  posture). If we ever add auth, this surface inherits it.

## Reserved gap IDs

- **FE-48** — probe endpoint + install/uninstall/update endpoints in
  `webapp.py` (paired with itself — pure dashboard-side work, no
  backend gap)
- **FE-49** — System Health UX changes (CTA card + buttons + Activity
  log integration)

No backend gap needed. The whole plan is dashboard-local.

## Decision needed

Pick one of:

1. **Park** — keep the plan, build later when an operator actually
   asks for the cold-start path.
2. **Ship Phase A + B** — detection + endpoints, no UI yet. Backend
   surface lands first; UX comes later.
3. **Full A + B + C** — coherent feature, biggest UX impact. ~2.5 days.

Default recommendation: **option 1**. The current "drop to terminal,
`brew install`" path works for the kind of operator who installs
self-hosted software anyway. Build this when there's evidence operators
get stuck at the cold-start step.
