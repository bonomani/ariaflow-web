// Bundle entry. Attaches migrated modules to `window` so the legacy
// classic-script `app.js` and Alpine callbacks can keep finding them
// during the JS-to-TS migration. Modules are removed from `window`
// once all callers have been migrated to ES imports.

import { renderItemSparkline, renderGlobalSparkline } from './sparkline';

declare global {
  interface Window {
    renderItemSparkline: typeof renderItemSparkline;
    renderGlobalSparkline: typeof renderGlobalSparkline;
  }
}

window.renderItemSparkline = renderItemSparkline;
window.renderGlobalSparkline = renderGlobalSparkline;
