// Lifecycle component status describer.
//
// BG-27 added three orthogonal axes per component (installed /
// current / running, each `bool | null`). This module turns those
// into user-facing labels and a healthy/unhealthy verdict that
// drives the Service Status nav badge.
//
// The legacy `result.reason` enum from BG-20 stays in place and is
// used as a fallback when the axes aren't present on the record
// (older backend, partial deploy, future component without axis
// support).

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

export interface LifecycleResultLegacy {
  reason?: string | null;
  outcome?: string | null;
  message?: string | null;
  observation?: string | null;
  completion?: string | null;
  version?: string | null;
  expected_version?: string | null;
}

export type LifecycleResult = LifecycleAxes & LifecycleResultLegacy;

export interface LifecycleRecord {
  result?: LifecycleResult | null;
}

function isLaunchdLike(name: string): boolean {
  return name.includes('launchd') || name.includes('auto-start');
}

function hasAxes(result: LifecycleResult): boolean {
  return (
    result.installed !== undefined ||
    result.current !== undefined ||
    result.running !== undefined
  );
}

// Healthy = "everything that should be true is true". Components
// that opt out of an axis (set it to null) are treated as healthy on
// that axis.
export function isLifecycleHealthy(record: LifecycleRecord | null | undefined): boolean {
  const result = record?.result;
  if (!result) return false;
  if (hasAxes(result)) {
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
  // Fallback: legacy reason-enum.
  return (
    result.reason === 'match' ||
    result.reason === 'ready' ||
    result.reason === 'probe_complete'
  );
}

// Compose the user-facing one-liner label from the three axes. Falls
// back to the legacy reason-enum mapping when axes aren't set.
export function describeLifecycleStatus(
  name: string,
  record: LifecycleRecord | null | undefined,
): string {
  const result = record?.result ?? {};
  if (hasAxes(result)) {
    return labelFromAxes(name, result);
  }
  return labelFromLegacy(name, result);
}

function labelFromAxes(name: string, result: LifecycleResult): string {
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

function labelFromLegacy(name: string, result: LifecycleResult): string {
  const reason = result.reason ?? '';
  if (name === 'ariaflow-server' || name === 'aria2') {
    if (reason === 'match') return 'installed · current';
    if (reason === 'missing') return 'absent';
    return result.outcome ?? 'unknown';
  }
  if (name === 'networkquality') {
    if (reason === 'ready' || reason === 'probe_complete') return 'installed · usable';
    if (
      reason === 'timeout' ||
      reason === 'probe_timeout_no_parse' ||
      reason === 'probe_timeout_partial_capture'
    ) {
      return 'installed · probe timeout';
    }
    if (reason === 'no_output' || reason === 'probe_no_parse') return 'installed · no parse';
    if (reason === 'missing') return 'absent';
    if (reason === 'error' || reason === 'probe_error') return 'installed · error';
    return result.outcome ?? 'unknown';
  }
  if (reason === 'match') return 'loaded';
  if (reason === 'missing') return 'not loaded';
  return result.outcome ?? 'unknown';
}

// Detail lines shown under the headline label. Skips noise the
// headline already conveys (e.g. `Reason: match` when the axes-
// derived label already says "running · current").
export function lifecycleDetailLines(record: LifecycleRecord | null | undefined): string[] {
  const result = record?.result;
  if (!result) return [];
  const usingAxes = hasAxes(result);
  const lines: string[] = [];
  if (result.message) lines.push(result.message);
  if (result.observation && result.observation !== 'ok') {
    lines.push(`Observation: ${result.observation}`);
  }
  // Suppress the "Reason: match" / "Reason: ready" noise when axes
  // already make it obvious. Keep reason for diagnostic states.
  if (result.reason && (!usingAxes || isDiagnosticReason(result.reason))) {
    lines.push(`Reason: ${result.reason}`);
  }
  if (result.completion) lines.push(`Completion: ${result.completion}`);
  return lines;
}

function isDiagnosticReason(reason: string): boolean {
  return ![
    'match',
    'ready',
    'ok',
    'healthy',
  ].includes(reason);
}

export interface LifecycleAction {
  target: string;
  action: string;
  label: string;
}

// Derive the actions to expose for a component based on its current
// state. Falls back to the legacy hard-coded action lists when axes
// aren't available (which means the row gets the same buttons it
// always had).
export function lifecycleActionsFor(
  name: string,
  record: LifecycleRecord | null | undefined,
  legacyActions: readonly LifecycleAction[] = [],
): LifecycleAction[] {
  const result = record?.result;
  if (!result || !hasAxes(result)) return [...legacyActions];

  const target = legacyTargetFor(name, legacyActions);
  if (!target) return [...legacyActions];

  const { installed, current, running } = result;

  // Pure registrations (aria2-launchd): toggle Load/Unload.
  if (installed === null && current === null) {
    if (running === true) return [{ target, action: 'uninstall', label: 'Unload' }];
    if (running === false) return [{ target, action: 'install', label: 'Load' }];
    return [...legacyActions];
  }

  if (installed === false) {
    return [{ target, action: 'install', label: 'Install' }];
  }
  if (current === false) {
    return [
      { target, action: 'install', label: 'Update' },
      { target, action: 'uninstall', label: 'Remove' },
    ];
  }
  // installed && current — usually offer Remove only. Don't expose a
  // Start/Stop affordance here yet: the daemon-control surface for
  // aria2 / ariaflow-server is policy, not a per-row toggle, so
  // leave that to the broader scheduler controls.
  return [{ target, action: 'uninstall', label: 'Remove' }];
}

function legacyTargetFor(
  name: string,
  legacyActions: readonly LifecycleAction[],
): string | null {
  if (legacyActions.length > 0 && legacyActions[0]!.target) return legacyActions[0]!.target;
  // Fallback heuristic.
  if (name === 'ariaflow-server') return 'ariaflow-server';
  if (name === 'aria2') return 'aria2';
  if (isLaunchdLike(name)) return 'aria2-launchd';
  return null;
}
