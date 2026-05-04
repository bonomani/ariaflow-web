#!/usr/bin/env node
// Build static/dist/index.html: expand <!--INCLUDE:path--> references.
// All __ARIAFLOW_DASHBOARD_* values (version, pid, hostname, IPs, backend URL)
// are injected at request time by webapp.py as window.__ARIAFLOW_DASHBOARD_*.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(repoRoot, 'src', 'ariaflow_dashboard', 'static');
const distDir = join(staticDir, 'dist');

const includeRe = /<!--INCLUDE:([\w_./-]+)-->\n?/g;
const expand = (text) =>
  text.replace(includeRe, (_, rel) => readFileSync(join(staticDir, rel), 'utf8'));

let html = readFileSync(join(staticDir, 'index.html'), 'utf8');
html = expand(html);

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'index.html'), html);
console.log(`build-html: wrote dist/index.html (${html.length} bytes)`);
