// Backend selection and Bonjour discovery.
//
// Pure functions that own the "which backend is the dashboard talking
// to?" surface area. The Alpine component in app.ts calls these to
// load/save persisted state, merge discovered services from
// /api/discovery, decide which discovered services refer to the
// dashboard's own host, and produce display strings for the picker.
//
// Side-effects (SSE reset, polling refresh) stay in app.ts and are
// triggered by the result fields returned from mergeDiscoveredItems.

import { joinUrl } from './api';
import { dashboardHostname, dashboardHostnameLower } from './runtime';
import {
  readBackends,
  readSelectedBackend,
  writeBackends,
  writeSelectedBackend,
} from './storage';

export interface BackendMeta {
  name: string;
  host: string;
  ip: string;
  txt_hostname: string;
}

export type BackendMetaMap = Record<string, BackendMeta>;

export interface DiscoveredService {
  url?: string | null;
  name?: string | null;
  host?: string | null;
  ip?: string | null;
  txt_hostname?: string | null;
  role?: string | null;
}

export interface BackendState {
  backends: string[];
  selected: string;
}

export interface MergeOptions {
  defaultBackendUrl: string;
  localIps: readonly string[];
}

export interface MergeResult {
  meta: BackendMetaMap;
  state: BackendState;
  /**
   * Set when the merge auto-selected a single discovered backend after
   * the dashboard had been talking to the default. The Alpine
   * component should reset its SSE and trigger a refresh.
   */
  autoSelectedUrl: string | null;
}

function cleanList(items: readonly string[], defaultBackendUrl: string): string[] {
  return [
    ...new Set(
      items
        .map((item) => String(item ?? '').trim())
        .filter((item) => item && item !== defaultBackendUrl),
    ),
  ];
}

function reconcileSelected(
  selected: string,
  backends: readonly string[],
  defaultBackendUrl: string,
): string {
  return selected === defaultBackendUrl || backends.includes(selected)
    ? selected
    : defaultBackendUrl;
}

export function loadBackendState(defaultBackendUrl: string): BackendState {
  const backends = cleanList(readBackends(), defaultBackendUrl);
  const selected = reconcileSelected(readSelectedBackend(), backends, defaultBackendUrl);
  return { backends, selected };
}

export function saveBackendState(
  backends: readonly string[],
  selected: string,
  defaultBackendUrl: string,
): BackendState {
  const clean = cleanList(backends, defaultBackendUrl);
  const nextSelected = reconcileSelected(selected, clean, defaultBackendUrl);
  writeBackends(clean);
  writeSelectedBackend(nextSelected);
  return { backends: clean, selected: nextSelected };
}

export function isSelfService(
  item: DiscoveredService | null | undefined,
  localIps: readonly string[],
): boolean {
  const localHostLower = dashboardHostnameLower();
  const selfLocal = localHostLower ? `${localHostLower}.local` : '';

  // Primary: TXT hostname (BG-6 contract).
  const txtHost = String(item?.txt_hostname ?? '').toLowerCase();
  if (txtHost && localHostLower && txtHost === localHostLower) return true;

  // Fallback: SRV .local hostname (strip trailing dot, lowercase).
  const host = String(item?.host ?? '')
    .toLowerCase()
    .replace(/\.$/, '');
  if (selfLocal && host === selfLocal) return true;

  // Fallback: IP match.
  const ip = String(item?.ip ?? '');
  if (ip && localIps.includes(ip)) return true;
  if (ip && ip.startsWith('127.')) return true;

  // Fallback: URL hostname is loopback.
  try {
    const urlIp = new URL(String(item?.url ?? '')).hostname;
    if (urlIp === '127.0.0.1') return true;
  } catch {
    /* ignore malformed URLs */
  }

  return false;
}

function dedupeByName(items: readonly DiscoveredService[]): DiscoveredService[] {
  const seen = new Set<string>();
  const out: DiscoveredService[] = [];
  for (const item of items) {
    const name = String(item?.name ?? '').trim();
    if (name && seen.has(name)) continue;
    if (name) seen.add(name);
    out.push(item);
  }
  return out;
}

export function mergeDiscoveredItems(
  rawItems: unknown,
  prevMeta: BackendMetaMap,
  prevState: BackendState,
  options: MergeOptions,
): MergeResult {
  // Filter to backend-role services (skip web frontends).
  const list: DiscoveredService[] = Array.isArray(rawItems)
    ? (rawItems as DiscoveredService[]).filter((item) => !item?.role || item.role !== 'web')
    : [];

  // Build URL → metadata map (overlays previous metadata).
  const meta: BackendMetaMap = { ...prevMeta };
  for (const item of list) {
    const url = String(item?.url ?? '').trim();
    if (!url) continue;
    meta[url] = {
      name: String(item?.name ?? '').trim(),
      host: String(item?.host ?? '').trim(),
      ip: String(item?.ip ?? '').trim(),
      txt_hostname: String(item?.txt_hostname ?? '').trim(),
    };
  }

  const remote = dedupeByName(list).filter((item) => !isSelfService(item, options.localIps));
  const discovered = remote.map((i) => String(i?.url ?? '').trim()).filter(Boolean);

  if (!discovered.length) {
    return { meta, state: prevState, autoSelectedUrl: null };
  }

  const merged = [...new Set([...prevState.backends, ...discovered])];
  const firstDiscovered = discovered[0]!;
  const shouldAutoSelect =
    discovered.length === 1 &&
    prevState.selected === options.defaultBackendUrl &&
    firstDiscovered !== prevState.selected;

  const nextSelected = shouldAutoSelect ? firstDiscovered : prevState.selected;
  const state = saveBackendState(merged, nextSelected, options.defaultBackendUrl);
  return { meta, state, autoSelectedUrl: shouldAutoSelect ? firstDiscovered : null };
}

export function backendDisplayName(
  url: string,
  meta: BackendMetaMap,
  defaultBackendUrl: string,
  localMainIpValue: string,
): string {
  if (!url) return '-';

  let addr = url;
  try {
    addr = new URL(url).host;
  } catch {
    /* keep raw */
  }

  // Default backend: substitute real LAN IP for loopback so the user
  // sees something useful (the "Google trick" — pick the main interface).
  if (url === defaultBackendUrl) {
    const host = dashboardHostname();
    let port = '8000';
    try {
      port = new URL(url).port || '8000';
    } catch {
      /* keep default */
    }
    return `${host} (${localMainIpValue}:${port})`;
  }

  const m = meta[url];
  if (m?.name) {
    // Strip Bonjour disambiguation suffix like " (2)".
    const cleanName = m.name.replace(/\s*\(\d+\)\s*$/, '');
    return `${cleanName} (${addr})`;
  }
  return addr;
}

export function apiPath(backend: string, path: string): string {
  return joinUrl(backend, path);
}
