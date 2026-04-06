# Plan

## Phase 1: Visibility-aware timer pausing

Currently, all frontend timers (fast poll, medium 30s, slow 120s, SSE) keep
firing even when the browser tab is hidden (user minimized, switched tabs, etc).
This wastes network and battery.

### 1a: Listen for `visibilitychange`

In `init()`, attach a listener:
```js
document.addEventListener('visibilitychange', () => this._onVisibilityChange());
```

### 1b: New `_onVisibilityChange()` method

- **Hidden** (`document.visibilityState === 'hidden'`): pause all timers
  - `refreshTimer`, `_mediumTimer`, `_slowTimer`, `_sseFallbackTimer`
  - Close SSE connection (it would keep receiving events otherwise)
- **Visible** (`document.visibilityState === 'visible'`):
  - Trigger immediate `refresh()` (user expects fresh data when they look back)
  - Restart `refreshTimer` with current `refreshInterval`
  - Call `_updateTabTimers(this.page)` to restart medium/slow timers
  - Call `_initSSE()` to re-establish SSE

### 1c: Track visibility state

Add `_tabHidden: false` flag to Alpine state. Used to:
- Prevent timers from being started while hidden (via early return in `setRefreshInterval`)
- Show a subtle "paused" indicator in the UI (optional, low priority)

### 1d: Edge cases

- **Browser tab switches but window still focused** → `visibilitychange` still fires. Fine.
- **SSE in-flight when tab hides** → close cleanly; server-side the `queue.Queue` client entry times out naturally.
- **SSE reconnect failure during hidden** → don't restart the 5s reconnect loop; wait for visibility.
- **User toggles Off / On** while hidden → honor it but don't start timers until visible.

### 1e: Verify

- Tests should still pass (no mock for visibility, so behavior is unchanged during tests).
- Manual test: open browser devtools, switch tab, verify no network requests in Network panel. Switch back, verify immediate refresh.

## Phase 2 (optional, if you want more)

Items that require backend changes, deferred:

- **SSE push log entries** — reduces `_mediumTimer` load, needs new backend event type `action_logged`
- **Merge /api/health into /api/status response** — one less endpoint to call, needs backend schema change
- **Backend scheduler adaptive backoff when aria2 unreachable** — reduces RPC spam when aria2 is down
