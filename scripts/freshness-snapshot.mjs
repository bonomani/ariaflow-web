#!/usr/bin/env node
// FE-24 step 8: build-time snapshot of the freshness map.
//
// Hits both /api/_meta documents (backend + dashboard, post-FE-31)
// and writes docs/FRESHNESS_SNAPSHOT.md as a single combined table
// with a Host column.
//
// Generated artifact — never hand-edit.
//
// Usage:
//   BACKEND=http://localhost:8000 DASHBOARD=http://localhost:8001 \
//     npm run freshness:snapshot
//
// Defaults: BACKEND=http://127.0.0.1:8000, DASHBOARD=http://127.0.0.1:8001.
// If the dashboard meta is unreachable the script still succeeds with
// just the backend rows — useful when running against a mocked or
// production backend without the local dashboard process up.

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = (process.env.BACKEND ?? 'http://127.0.0.1:8000').replace(/\/+$/, '');
const dashboard = (process.env.DASHBOARD ?? 'http://127.0.0.1:8001').replace(/\/+$/, '');

async function fetchEndpoints(origin, host, { required }) {
  const url = `${origin}/api/_meta`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    if (required) {
      console.error(`fetch ${url} failed: ${e.message}`);
      process.exit(1);
    }
    console.warn(`fetch ${url} failed (${e.message}); skipping ${host} meta`);
    return [];
  }
  if (!res.ok) {
    if (required) {
      console.error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
      process.exit(1);
    }
    console.warn(`fetch ${url} returned ${res.status}; skipping ${host} meta`);
    return [];
  }
  const body = await res.json();
  const endpoints = Array.isArray(body?.endpoints) ? body.endpoints : [];
  if (required && endpoints.length === 0) {
    console.error(`no endpoints returned by ${url}`);
    process.exit(1);
  }
  return endpoints.map((e) => ({ ...e, host }));
}

const [backendEps, dashboardEps] = await Promise.all([
  fetchEndpoints(backend, 'backend', { required: true }),
  fetchEndpoints(dashboard, 'dashboard', { required: false }),
]);
const all = [...backendEps, ...dashboardEps];

all.sort((a, b) => {
  const ha = String(a.host ?? '');
  const hb = String(b.host ?? '');
  if (ha !== hb) return ha.localeCompare(hb);
  const fa = String(a.freshness ?? '');
  const fb = String(b.freshness ?? '');
  if (fa !== fb) return fa.localeCompare(fb);
  return `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`);
});

const lines = [];
lines.push('# Freshness snapshot');
lines.push('');
lines.push(
  `Generated from \`${backend}/api/_meta\`` +
    (dashboardEps.length > 0 ? ` and \`${dashboard}/api/_meta\`` : '') +
    ` at ${new Date().toISOString()}.`,
);
lines.push('Do not edit by hand — run `npm run freshness:snapshot` to refresh.');
lines.push('');
lines.push('| Host | Class | Method | Path | TTL (s) | Transport | Topics | Revalidate on |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const e of all) {
  const topics = Array.isArray(e.transport_topics) ? e.transport_topics.join(', ') : '';
  const revalidate = Array.isArray(e.revalidate_on) ? e.revalidate_on.join('<br>') : '';
  lines.push(
    `| ${e.host ?? ''} | ${e.freshness ?? ''} | ${e.method ?? ''} | \`${e.path ?? ''}\` | ${e.ttl_s ?? ''} | ${e.transport ?? ''} | ${topics} | ${revalidate} |`,
  );
}
lines.push('');

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'docs', 'FRESHNESS_SNAPSHOT.md');
writeFileSync(out, lines.join('\n'), 'utf8');
console.log(
  `wrote ${out} (${backendEps.length} backend + ${dashboardEps.length} dashboard endpoints)`,
);
