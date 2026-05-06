# Scheduler UI

The scheduler controls live in the Dashboard tab queue panel. The Lifecycle
tab shows the same badge for diagnostics but no controls.

## Source of truth

Single enum: `state.scheduler_status` (BG-40), exposed by ariaflow-server.

```
stopped → starting → idle ⇄ running
                       ↓       ↓
                     paused ←──┘
```

When `ariaflow-server` is unreachable the FE renders `unknown` (not the stale
enum, not the misleading `stopped` fallback).

## Backend derivation (`deriveSchedulerStatus`)

| `intent` | `running` | `session_id` | `paused` | `active_gid` | Output |
|---|---|---|---|---|---|
| stopped | * | * | * | * | `stopped` |
| running | false | null | * | * | `starting` (clean bootstrap) |
| running | false | set | * | * | `idle` (loop drained, will re-kick on add) |
| running | true | * | true | * | `paused` |
| running | true | * | false | set | `running` |
| running | true | * | false | null | `idle` |

Operator intent (`scheduler_intent`) wins over loop state for display.

## Wait reasons

Sub-label appended to the badge when `status === 'idle'` only. Priority order
(BG-47):

1. `aria2_unreachable` (hard blocker)
2. `preflight_blocked`
3. `disk_full`
4. `queue_empty` ← before probe
5. `bandwidth_probe_pending`

Wait reasons are *never* surfaced for `running`, `paused`, `stopped`,
`starting`, or `unknown`.

## Button matrix

| Badge | Backend | Primary btn | Disabled | Stop btn | Click dispatches |
|---|---|---|---|---|---|
| `stopped` | reachable | Start | no | hidden | `POST /api/scheduler/start` |
| `starting` | reachable | Starting… | **yes** | hidden | (disabled) |
| `idle` | reachable | Pause | no | visible | `POST /api/scheduler/pause` |
| `running` | reachable | Pause | no | visible | `POST /api/scheduler/pause` |
| `paused` | reachable | Resume | no | visible | `POST /api/scheduler/resume` |
| `unknown` | unreachable | Start | **yes** | hidden | (disabled) |

Stop button always dispatches `POST /api/scheduler/stop` when visible+enabled.

The "Run contract" button on the Log tab dispatches
`POST /api/scheduler/ucc` (with `/contract` fallback on 404 — backward-compat
during the BG-48 deprecation window).

## Wire response shapes

Backend returns flat envelopes (no nested `result` object). FE reads
top-level fields:

| Action | Backend response | FE success check |
|---|---|---|
| start | `{ok, started, running, ...}` | `data.started === true` |
| stop | `{ok, stopped, ...}` | `data.stopped === true` |
| pause | `{ok, paused: true, _rev}` | `data.paused === true` |
| resume | `{ok, paused: false, _rev, ...}` | `data.paused === false` (no `resumed` field) |

## Post-action state (BG-49)

Every scheduler action response carries a canonical `state` envelope:

```json
{ "ok": true, "started": true,
  "state": { "scheduler_status": "starting", "running": true,
             "dispatch_paused": false, "session_id": "...", "_rev": 42 } }
```

The FE splats `data.state` into `lastStatus.state` — no optimistic
guessing, no separate `refresh()` kick. The badge flips to the real
backend value the moment the POST returns.

## Single source of truth: dispatch

`toggleScheduler()` reads only `schedulerBadgeText` (the enum) — same value
the button label reads. Earlier code read `state.running` +
`state.dispatch_paused` separately, which could drift from the badge and
dispatch the wrong action on click.

```ts
switch (this.schedulerBadgeText) {
  case 'paused': return resumeDownloads();
  case 'idle':
  case 'running': return pauseDownloads();
  default: return schedulerAction('start');
}
```

## Run identity

The Lifecycle tab Scheduler row shows a single chip:

```
Run abc12345 · up 2h 15m
```

- `abc12345` — first 8 chars of `session_id` (full id on hover for support
  copy/paste)
- `up 2h 15m` — live duration since `session_started_at`, ticks via Alpine
  reactivity even though the timestamp is static

Clicking the chip filters the activity log to this run's events
(`sessionFilter = 'current'`, navigates to the Log tab).

## Two badges, never both visible

The badge is rendered in two templates:

- `tab_dashboard.html:64` — operator surface, next to the action buttons
- `tab_lifecycle.html:60` — diagnostic surface, next to session/wait-reason
  chips

Both bind to the same getters (`schedulerBadgeText`, `schedulerBadgeClass`,
`schedulerWaitReasonText`) so they're always in lockstep. Only the active
tab is in the DOM.
