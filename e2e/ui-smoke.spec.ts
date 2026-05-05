// FE-32: UI smoke tests covering recent UI contract changes.
// - Header injects webVersion + webPid from window.__ARIAFLOW_DASHBOARD_*
//   (post-unification: version + PID + identity all in one <script> block).
// - Dev tab surfaces OpenAPI runtime/spec version chips and a drift badge
//   when info.version differs from /api/version (FE-29 / BG-37).
// - Archive tab badge fallback uses 'removed', not legacy 'cancelled'
//   (FE-30 / BG-30).
// - Freshness map renders backend endpoints declared by /api/_meta.
// - Lifecycle tab paints rows from /api/lifecycle.
//
// Like canonical-routes.spec.ts, these intercept all backend traffic with
// page.route() — no real ariaflow-server needed.

import { test, expect, type Route, type Request } from '@playwright/test';

const BACKEND = 'http://localhost:9999';

interface BackendOpts {
  runtimeVersion?: string;
  specVersion?: string;
}

async function setupBackend(page: import('@playwright/test').Page, opts: BackendOpts = {}) {
  const runtimeVersion = opts.runtimeVersion ?? '0.1.350';
  const specVersion = opts.specVersion ?? runtimeVersion;

  await page.addInitScript((url: string) => {
    localStorage.setItem('ariaflow.backends', JSON.stringify([url]));
    localStorage.setItem('ariaflow.selected_backend', url);
  }, BACKEND);

  // Intercept the dashboard server's own same-origin /api/discovery so
  // mDNS browse on the host machine cannot leak a real LAN backend into
  // the page (which would override our seeded selectedBackend).
  await page.route('**/api/discovery*', (route: Route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, available: false, items: [], reason: 'test-stub' }),
    }),
  );

  await page.route(`${BACKEND}/api/**`, (route: Route, request: Request) => {
    const u = new URL(request.url());
    const path = u.pathname;
    if (path === '/api/openapi.yaml') {
      return route.fulfill({
        contentType: 'application/yaml',
        body: `openapi: 3.0.3\ninfo:\n  title: Ariaflow API\n  version: ${specVersion}\n`,
      });
    }
    let body: unknown = { ok: true };
    if (path === '/api/_meta') {
      body = {
        ok: true,
        endpoints: [
          { method: 'GET', path: '/api/status', freshness: 'live', transport: 'sse' },
          { method: 'GET', path: '/api/lifecycle', freshness: 'warm', ttl_s: 30 },
          { method: 'GET', path: '/api/bandwidth', freshness: 'on-action', revalidate_on: ['POST /api/bandwidth/probe'] },
        ],
      };
    } else if (path === '/api/status') {
      body = {
        ok: true,
        'ariaflow-server': { reachable: true, pid: 4242, version: runtimeVersion },
        items: [],
        summary: { total: 0, queued: 0, waiting: 0, active: 0, paused: 0, complete: 0, error: 0, removed: 0 },
        state: { dispatch_paused: false, running: false, session_id: 's-test', session_started_at: '2026-05-04T00:00:00Z', session_last_seen_at: '2026-05-04T00:00:01Z' },
        bandwidth: { cap_mbps: 5.1, interface_name: 'en0' },
        health: { uptime_seconds: 12, disk_ok: true, disk_usage_percent: 50 },
        _rev: 1,
      };
    } else if (path === '/api/lifecycle') {
      body = {
        ok: true,
        'ariaflow-server': { result: { installed: true, current: true, running: true, outcome: 'installed · current', observation: 'ok', version: runtimeVersion, expected_version: runtimeVersion } },
        aria2: { result: { installed: true, current: true, running: true, managed_by: 'external', outcome: 'installed · current', observation: 'ok', version: '1.37.0' } },
      };
    } else if (path === '/api/bandwidth') {
      body = { ok: true, config: {}, last_probe: { cap_mbps: 5.1 } };
    } else if (path === '/api/declaration') body = { ok: true, uic: { preferences: [] } };
    else if (path === '/api/health') body = { ok: true, uptime_seconds: 12 };
    else if (path === '/api/aria2/global_option') body = { ok: true };
    else if (path === '/api/aria2/option_tiers') body = { ok: true, safe: [], managed: [], unsafe_enabled: false };
    else if (path === '/api/torrents') body = { torrents: [] };
    else if (path === '/api/peers') body = { peers: [] };
    else if (path === '/api/downloads/archive') body = { items: [] };
    else if (path === '/api/sessions') body = { sessions: [] };
    else if (path === '/api/log') body = { items: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('header injects webVersion and webPid from window globals', async ({ page }) => {
  await setupBackend(page);
  await page.goto('/');
  // The chip lives inside <details>System info</details> — open it first.
  await page.locator('summary', { hasText: 'System info' }).first().click();

  // Plan A consolidation: version + pid live in one chip ("Ariaflow-dashboard
  // vX.Y.Z · pid N"), not two separate chips.
  const chip = page.locator('.chip', { hasText: 'Ariaflow-dashboard' });
  await expect(chip).toContainText(/v\d+\.\d+\.\d+/);
  await expect(chip).toContainText(/pid\s+\d+/);
});

test('dev tab shows runtime + spec version chips when they match', async ({ page }) => {
  await setupBackend(page, { runtimeVersion: '0.1.350', specVersion: '0.1.350' });
  await page.goto('/dev');
  await page.waitForTimeout(400);

  await expect(page.locator('.chip', { hasText: 'Runtime' })).toContainText('v0.1.350');
  await expect(page.locator('.chip', { hasText: 'Spec' })).toContainText('v0.1.350');
  // No drift badge when versions match (x-show keeps it in DOM, but hidden).
  await expect(page.locator('.chip', { hasText: 'version drift' })).toBeHidden();
});

test('dev tab flags drift when spec.info.version != runtime', async ({ page }) => {
  await setupBackend(page, { runtimeVersion: '0.1.350', specVersion: '0.1.145' });
  await page.goto('/dev');
  await page.waitForTimeout(500);

  await expect(page.locator('.chip', { hasText: 'Spec' })).toContainText('v0.1.145');
  await expect(page.locator('.chip', { hasText: 'version drift' })).toBeVisible();
});

test('archive tab badge fallback is "removed", not legacy "cancelled"', async ({ page }) => {
  await setupBackend(page);
  await page.goto('/archive');
  // Drive Alpine state directly: bypass the FreshnessRouter timing and
  // inject an archived row missing its status field to exercise the fallback.
  await page.evaluate(() => {
    const el = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> };
    const ctx = el?._x_dataStack?.[0];
    if (ctx) (ctx as { archiveItems?: unknown[] }).archiveItems = [{ id: 'x1', url: 'https://example/file.bin' }];
  });
  await page.waitForTimeout(150);

  // Fallback badge text should read "removed", and "cancelled" must never appear.
  await expect(page.locator('.item.compact .badge', { hasText: 'removed' }).first()).toBeVisible();
  await expect(page.locator('.item.compact .badge', { hasText: 'cancelled' })).toHaveCount(0);
});

test('freshness map renders endpoints declared by /api/_meta', async ({ page }) => {
  await setupBackend(page);
  await page.goto('/dev');
  await page.waitForTimeout(500);

  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('table')).toContainText('/api/status');
  await expect(page.locator('table')).toContainText('/api/lifecycle');
});

test('FE-31: /api/web/log is fetched same-origin, not via the backend', async ({ page }) => {
  // Two interceptors recording where /api/web/log requests land:
  // - same-origin (dashboard server, port 8770 per playwright config)
  // - backend mock (localhost:9999)
  // Only the same-origin counter should increment.
  const sameOrigin: string[] = [];
  const backendOrigin: string[] = [];
  await setupBackend(page);
  await page.route('http://127.0.0.1:8770/api/web/log*', (route, request) => {
    sameOrigin.push(request.url());
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [], source: 'ariaflow-dashboard', meta: { freshness: 'warm', ttl_s: 30 } }),
    });
  });
  await page.route(`${BACKEND}/api/web/log*`, (route, request) => {
    backendOrigin.push(request.url());
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' });
  });
  // Visit the Log tab so the router subscribes to /api/web/log.
  await page.goto('/log');
  await page.waitForTimeout(400);

  expect(sameOrigin.length, `expected at least one same-origin /api/web/log fetch; got ${sameOrigin.length}`).toBeGreaterThan(0);
  expect(backendOrigin, 'backend should not be hit for /api/web/log').toEqual([]);
});

test('FE-22: discoverBackends falls back to /api/peers when mDNS empty', async ({ page }) => {
  await setupBackend(page);
  // Force mDNS browse to return nothing.
  await page.unroute('**/api/discovery*').catch(() => undefined);
  await page.route('**/api/discovery*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, available: true, items: [], reason: 'no-services' }),
    }),
  );
  // /api/peers on the BACKEND mock returns one peer.
  let peersCalls = 0;
  await page.route(`${BACKEND}/api/peers*`, (route) => {
    peersCalls += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        peers: [
          { instance: 'peer-mac', host: 'peer-mac.local', port: 8000, base_url: 'http://peer-mac.local:8000', status: 'resolved' },
        ],
        meta: { freshness: 'warm', ttl_s: 30 },
      }),
    });
  });
  await page.goto('/');
  // discoverBackends fires ~2s after init().
  await page.waitForTimeout(2800);

  expect(peersCalls, 'expected /api/peers fetch as mDNS fallback').toBeGreaterThan(0);
  const discoveryText = await page.evaluate(() => {
    const el = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: Array<Record<string, unknown>> };
    const ctx = el?._x_dataStack?.[0] as { discoveryText?: string; backendsDiscovered?: boolean } | undefined;
    return { text: ctx?.discoveryText, found: ctx?.backendsDiscovered };
  });
  expect(discoveryText.found).toBe(true);
  expect(discoveryText.text).toContain('peers');
});

test('lifecycle tab paints rows from /api/lifecycle', async ({ page }) => {
  await setupBackend(page);
  await page.goto('/lifecycle');
  await page.waitForTimeout(400);

  // ariaflow-server + aria2 rows render through the lifecycle template.
  await expect(page.locator('.item-url', { hasText: 'ariaflow-server' })).toBeVisible();
  await expect(page.locator('.item-url', { hasText: 'aria2' }).first()).toBeVisible();
});
