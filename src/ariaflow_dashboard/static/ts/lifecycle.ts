// Lifecycle component status describer.
//
// BG-27 added three orthogonal axes per component (installed /
// current / running, each `bool | null`). This module turns those
// into user-facing labels and a healthy/unhealthy verdict that
// drives the Service Status nav badge.

export interface LifecycleAxes {
  installed?: boolean | null;
  current?: boolean | null;
  running?: boolean | null;
  // BG-29: on-demand semantics. expected_running lets a daemon
  // (e.g. aria2) be "healthy idle" — running matches expectation.
  // managed_by tells us who owns the process lifecycle.
  expected_running?: boolean | null;
  managed_by?: 'launchd' | 'external' | 'ariaflow' | null;
}

export interface LifecycleResult extends LifecycleAxes {
  reason?: string | null;
  outcome?: string | null;
  message?: string | null;
  observation?: string | null;
  completion?: string | null;
  version?: string | null;
  expected_version?: string | null;
}

export interface LifecycleRecord {
  result?: LifecycleResult | null;
}

function isLaunchdLike(name: string): boolean {
  return name.includes('launchd') || name.includes('auto-start');
}

// Lifecycle-specific badge colour. The generic badgeClass() in
// formatters.ts maps download-item statuses (complete/error/paused/...)
// to colours; lifecycle rows use a different vocabulary (installed ·
// current, installed · usable, ...) that the download-status allow-
// list doesn't cover, so healthy components used to render uncoloured.
//
// Maps directly from the BG-27/BG-29 axes:
//   - bad (red):  installed === false (component absent)
//   - warn (yellow): current === false (outdated), or expected to run
//                    but isn't
//   - good (green): healthy by isLifecycleHealthy()
//   - default (no colour): all-null axes — informational rows that
//     don't carry a healthy/unhealthy verdict
export function lifecycleBadgeClass(record: LifecycleRecord | null | undefined): string {
  const result = record?.result;
  if (!result) return 'badge';
  const { installed, current, running, expected_running } = result;
  if (installed === null && current === null && running === null) return 'badge';
  if (installed === false) return 'badge bad';
  if (current === false) return 'badge warn';
  if (expected_running != null && running !== expected_running) return 'badge warn';
  return isLifecycleHealthy(record) ? 'badge good' : 'badge';
}

// Healthy = "everything that should be true is true". Components
// that opt out of an axis (set it to null) are treated as healthy on
// that axis.
export function isLifecycleHealthy(record: LifecycleRecord | null | undefined): boolean {
  const result = record?.result;
  if (!result) return false;
  if (result.installed === false) return false;
  if (result.current === false) return false;
  // BG-29: when expected_running is set, healthy = running matches
  // expectation (an on-demand daemon idling is healthy).
  if (result.expected_running != null) {
    if (result.running !== result.expected_running) return false;
  } else if (result.running === false) {
    return false;
  }
  return true;
}

// Compose the user-facing one-liner label from the three axes.
export function describeLifecycleStatus(
  name: string,
  record: LifecycleRecord | null | undefined,
): string {
  const result = record?.result ?? {};
  const { installed, current, running } = result;
  // Components with installed=null are themselves a registration /
  // probe (aria2-launchd, networkquality) — they don't have a
  // "binary present" semantic, so collapse to running-only.
  if (installed === null && current === null) {
    if (running === true) return isLaunchdLike(name) ? 'loaded' : 'running';
    if (running === false) return isLaunchdLike(name) ? 'not loaded' : 'stopped';
    return 'unknown';
  }
  if (installed === false) return 'not installed';
  if (current === false) {
    const v = result.version;
    const ev = result.expected_version;
    if (v && ev) return `update available (${v} → ${ev})`;
    return 'update available';
  }
  // installed && current at this point.
  const suffix = result.managed_by ? ` (${result.managed_by})` : '';
  // BG-29: on-demand idle is healthy.
  if (result.expected_running === false && running === false) {
    return `idle · on-demand${suffix}`;
  }
  if (running === false) return 'installed · stopped';
  if (running === true) return `running · current${suffix}`;
  return 'installed · current';
}

// Detail lines shown under the headline label. Skips noise the
// headline already conveys (e.g. `Reason: match` when the axes-
// derived label already says "running · current").
export function lifecycleDetailLines(record: LifecycleRecord | null | undefined): string[] {
  const result = record?.result;
  if (!result) return [];
  const lines: string[] = [];
  if (result.message) lines.push(result.message);
  if (
    result.observation &&
    result.observation !== 'ok' &&
    result.observation !== 'unknown'
  ) {
    lines.push(`Observation: ${result.observation}`);
  }
  if (result.reason && isDiagnosticReason(result.reason)) {
    lines.push(`Reason: ${result.reason}`);
  }
  if (result.completion) lines.push(`Completion: ${result.completion}`);
  return lines;
}

function isDiagnosticReason(reason: string): boolean {
  return !['match', 'ready', 'ok', 'healthy'].includes(reason);
}

export interface LifecycleAction {
  target: string;
  action: string;
  label: string;
}

// Derive the actions to expose for a component based on its current
// state.
export function lifecycleActionsFor(
  name: string,
  record: LifecycleRecord | null | undefined,
): LifecycleAction[] {
  const result = record?.result;
  if (!result) return [];

  const target = backendTargetFor(name);
  if (!target) return [];

  const { installed, current, running } = result;

  // Pure registrations (aria2-launchd): toggle Load/Unload.
  if (installed === null && current === null) {
    if (running === true) return [{ target, action: 'uninstall', label: 'Unload' }];
    if (running === false) return [{ target, action: 'install', label: 'Load' }];
    return [];
  }

  if (installed === false) {
    return [{ target, action: 'install', label: 'Install' }];
  }
  if (current === false) {
    return [
      { target, action: 'install', label: 'Update' },
      { target, action: 'uninstall', label: 'Uninstall' },
    ];
  }
  // installed && current — usually offer Uninstall only. Don't expose a
  // Start/Stop affordance here yet: the daemon-control surface for
  // aria2 / ariaflow-server is policy, not a per-row toggle, so
  // leave that to the broader scheduler controls.
  return [{ target, action: 'uninstall', label: 'Uninstall' }];
}

// Map a component's row name to the backend's target identifier used
// in /api/lifecycle/:target/:action. Friendly labels like
// "aria2 auto-start (advanced)" map to the canonical "aria2-launchd".
function backendTargetFor(name: string): string | null {
  if (name === 'ariaflow-server') return 'ariaflow-server';
  if (name === 'aria2') return 'aria2';
  if (isLaunchdLike(name)) return 'aria2-launchd';
  return null;
}
