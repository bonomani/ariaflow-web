// FE-28: assert the dashboard hits canonical backend routes, not aliases.
// Uses page.route() to intercept all /api/** traffic — no real backend.
//
// What this catches that the static UCC test doesn't: dynamically-built
// URLs (template strings, helper builders), and runtime regressions if
// someone re-introduces an alias path through a code path that doesn't
// pattern-match the static grep.

import { test, expect, type Route, type Request } from '@playwright/test';

const BACKEND = 'http://localhost:9999'; // not real — Playwright intercepts

const FORBIDDEN = [
  '/api/downloads/add',
  '/api/aria2/get_global_option',
  '/api/aria2/get_option',
];

interface Recorded { method: string; path: string; }

async function setupBackend(page: import('@playwright/test').Page, recorded: Recorded[]) {
  // Seed localStorage with a backend pointing nowhere, then set up the
  // intercept. We respond with stub JSON to keep the page alive.
  await page.addInitScript((url: string) => {
    localStorage.setItem('ariaflow.backends', JSON.stringify([url]));
    localStorage.setItem('ariaflow.selected_backend', url);
  }, BACKEND);

  await page.route(`${BACKEND}/api/**`, (route: Route, request: Request) => {
    const u = new URL(request.url());
    recorded.push({ method: request.method(), path: u.pathname });
    // Minimal-but-valid responses keyed by path.
    const path = u.pathname;
    let body: unknown = { ok: true };
    if (path === '/api/_meta') body = {
      ok: true,
      endpoints: [
        { method: 'GET', path: '/api/status', freshness: 'live', transport: 'sse' },
        { method: 'GET', path: '/api/declaration', freshness: 'cold',
          revalidate_on: ['POST /api/declaration', 'PUT /api/declaration', 'POST /api/declaration/preferences', 'PATCH /api/declaration/preferences'] },
        { method: 'GET', path: '/api/aria2/global_option', freshness: 'cold' },
      ],
    };
    else if (path === '/api/status') body = { ok: true, items: [], summary: { total: 0 }, state: {}, _rev: 1 };
    else if (path === '/api/declaration') body = { ok: true, uic: { preferences: [] } };
    else if (path === '/api/lifecycle') body = { ok: true };
    else if (path === '/api/bandwidth') body = { ok: true };
    else if (path === '/api/health') body = { ok: true, uptime_seconds: 1 };
    else if (path === '/api/aria2/global_option') body = { ok: true };
    else if (path === '/api/aria2/option_tiers') body = { ok: true };
    else if (path === '/api/torrents') body = { torrents: [] };
    else if (path === '/api/peers') body = { peers: [] };
    else if (path === '/api/downloads/archive') body = { items: [] };
    else if (path === '/api/sessions') body = { sessions: [] };
    else if (path === '/api/log') body = { items: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('dashboard never hits a known backend alias path', async ({ page }) => {
  const recorded: Recorded[] = [];
  await setupBackend(page, recorded);

  await page.goto('/');
  // Visit each tab so its TAB_SUBS subscriptions fire.
  for (const tab of ['/bandwidth', '/lifecycle', '/options', '/log', '/archive', '/']) {
    await page.goto(tab);
    await page.waitForTimeout(300);
  }

  const seen = recorded.map((r) => `${r.method} ${r.path}`);
  for (const alias of FORBIDDEN) {
    expect(seen, `Found forbidden alias request: ${alias}\nRecorded: ${seen.join('\n  ')}`)
      .not.toEqual(expect.arrayContaining([expect.stringContaining(alias)]));
  }
});

test('canonical aria2 option paths are used', async ({ page }) => {
  const recorded: Recorded[] = [];
  await setupBackend(page, recorded);

  await page.goto('/options');
  await page.waitForTimeout(500);

  const paths = recorded.filter((r) => r.method === 'GET').map((r) => r.path);
  expect(paths).toEqual(expect.arrayContaining(['/api/aria2/global_option']));
  expect(paths).not.toContain('/api/aria2/get_global_option');
});

test('saving declaration uses PUT /api/declaration', async ({ page }) => {
  const recorded: Recorded[] = [];
  await setupBackend(page, recorded);

  await page.goto('/');
  await page.waitForTimeout(300);
  // Trigger saveDeclaration() via Alpine: the dashboard exposes the
  // root component as window.Alpine — easier than driving the UI.
  await page.evaluate(() => {
    const el = document.querySelector('[x-data]') as HTMLElement & { _x_dataStack?: any[] };
    const ctx = el?._x_dataStack?.[0];
    ctx?.saveDeclaration?.();
  });
  await page.waitForTimeout(300);

  const decl = recorded.find((r) => r.path === '/api/declaration' && r.method !== 'GET');
  expect(decl?.method).toBe('PUT');
  // No POST-to-declaration regression.
  expect(recorded.find((r) => r.path === '/api/declaration' && r.method === 'POST')).toBeUndefined();
});
