// Pure formatting functions — no Alpine dependency.

type Numeric = number | string | null | undefined;

export function formatEta(
  totalLength: Numeric,
  completedLength: Numeric,
  speed: Numeric,
): string | null {
  const total = Number(totalLength || 0);
  const done = Number(completedLength || 0);
  const rate = Number(speed || 0);
  if (rate <= 0 || total <= done) return null;
  const secs = Math.round((total - done) / rate);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export function formatBytes(value: Numeric): string {
  if (value == null) return '-';
  let size = Number(value);
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  for (const unit of units) {
    if (Math.abs(size) < 1024 || unit === units[units.length - 1]) {
      return unit === 'B' ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
    }
    size /= 1024;
  }
  return `${size.toFixed(1)} TiB`;
}

export function formatRate(value: Numeric): string {
  if (value == null) return '-';
  return `${formatBytes(value)}/s`;
}

export function formatMbps(value: Numeric): string {
  if (value == null) return '-';
  return `${value} Mbps`;
}

export function humanCap(value: Numeric): string {
  if (value == null) return '-';
  const text = String(value).trim();
  if (!text || text === '0' || text === '0M' || text === '0 Mbps' || text === '0 Mbps/s') {
    return 'unlimited';
  }
  return text;
}

export function shortName(value: string | null | undefined): string {
  if (!value) return '(no name)';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1]! : url.hostname;
  } catch {
    const parts = value.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1]! : value;
  }
}

export function relativeTime(value: string | number | Date | null | undefined): string {
  if (!value) return '-';
  const now = Date.now();
  const then = new Date(value).getTime();
  if (isNaN(then)) return String(value);
  const diff = Math.floor((now - then) / 1000);
  if (diff < 0) return String(value);
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

export function timestampLabel(value: string | number | Date | null | undefined): string {
  return value ? relativeTime(value) : '-';
}

export function badgeClass(status: string | null | undefined): string {
  if (['converged', 'ok', 'complete'].includes(status as string)) return 'badge good';
  if (['error', 'missing', 'removed', 'stopped'].includes(status as string)) return 'badge bad';
  if (
    ['paused', 'queued', 'waiting', 'unchanged', 'skipped'].includes(status as string)
  ) {
    return 'badge warn';
  }
  return 'badge';
}

export interface SessionState {
  session_id?: string | null;
  session_closed_at?: string | null;
}

export function sessionLabel(state: SessionState | null | undefined): string {
  if (state?.session_id && !state?.session_closed_at) {
    return `current ${String(state.session_id).slice(0, 8)}`;
  }
  if (state?.session_id && state?.session_closed_at) {
    return `closed ${String(state.session_id).slice(0, 8)}`;
  }
  return '-';
}
