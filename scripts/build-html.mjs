#!/usr/bin/env node
// Build static/dist/index.html: expand <!--INCLUDE:path--> references and stamp
// __ARIAFLOW_DASHBOARD_VERSION__ from src/ariaflow_dashboard/__init__.py.
// __ARIAFLOW_DASHBOARD_PID__ and window.__ARIAFLOW_DASHBOARD_* host-identity
// globals are still injected at request time by webapp.py.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(repoRoot, 'src', 'ariaflow_dashboard', 'static');
const distDir = join(staticDir, 'dist');
const initPy = join(repoRoot, 'src', 'ariaflow_dashboard', '__init__.py');

const versionMatch = readFileSync(initPy, 'utf8').match(/^__version__\s*=\s*["']([^"']+)["']/m);
if (!versionMatch) {
  console.error('build-html: could not parse __version__ from', initPy);
  process.exit(1);
}
const version = versionMatch[1];

const includeRe = /<!--INCLUDE:([\w_./-]+)-->\n?/g;
const expand = (text) =>
  text.replace(includeRe, (_, rel) => readFileSync(join(staticDir, rel), 'utf8'));

let html = readFileSync(join(staticDir, 'index.html'), 'utf8');
html = expand(html);
html = html.replaceAll('__ARIAFLOW_DASHBOARD_VERSION__', `v${version}`);

mkdirSync(distDir, { recursive: true });
writeFileSync(join(distDir, 'index.html'), html);
console.log(`build-html: wrote dist/index.html (v${version}, ${html.length} bytes)`);
