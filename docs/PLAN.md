# Plan

## Phase 1: Extract formatters into formatters.js

Move pure functions out of the Alpine data object into `src/ariaflow_web/static/formatters.js`:
- `formatBytes`, `formatMbps`, `formatEta`, `relativeTime`, `timestampLabel`,
  `sessionLabel`, `humanCap`, `badgeClass`, `formatRate`

In app.js, import and delegate: `formatBytes(v) { return _formatBytes(v); }` or
attach to `window` and call directly from HTML.

~80 lines extracted. Zero Alpine risk — all pure functions.

## Phase 2: Extract sparkline into sparkline.js

Move sparkline rendering into `src/ariaflow_web/static/sparkline.js`:
- `itemSparklineSvg`, `globalSparklineSvg`
- `recordSpeed`, `recordGlobalSpeed`
- `SPEED_HISTORY_MAX`, `GLOBAL_SPEED_MAX`, `speedHistory`, `globalSpeedHistory`, `globalUploadHistory`

Expose as a standalone object or function that takes history arrays and returns SVG.
App.js keeps thin wrappers that pass state.

~70 lines extracted. Low risk — needs history state passed in.

## Phase 3: Table-driven preference getters

Replace 15 identical preference getter patterns with a config table:

```js
const PREF_GETTERS = {
  bwDownFreePercent: ['bandwidth_down_free_percent', 20],
  bwDownFreeAbsolute: ['bandwidth_down_free_absolute_mbps', 0],
  bwUpFreePercent: ['bandwidth_up_free_percent', 50],
  // ...
};
```

Generate getters dynamically in Alpine `init()` or via `Object.defineProperty`.

~40 lines reduced. Low risk — Alpine supports computed properties.

## Phase 4: Extract test helpers

Add `tests/helpers.py` with:
- `assert_get_ok(url)` — `_get` + `assert isinstance(data, dict)`
- `assert_post_ok(url, payload)` — `_post` + `assert data.get("ok") is True`
- `assert_returns_404(url, method)` — expect 404

Replace repeated patterns in `test_api_params.py`.

~50 lines reduced. Zero risk.
