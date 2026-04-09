/* Pure formatting functions — no Alpine dependency. */

function formatEta(totalLength, completedLength, speed) {
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

function formatBytes(value) {
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

function formatRate(value) {
  if (value == null) return '-';
  return `${formatBytes(value)}/s`;
}

function formatMbps(value) {
  if (value == null) return '-';
  return `${value} Mbps`;
}

function humanCap(value) {
  if (value == null) return '-';
  const text = String(value).trim();
  if (!text || text === '0' || text === '0M' || text === '0 Mbps' || text === '0 Mbps/s') return 'unlimited';
  return text;
}

function shortName(value) {
  if (!value) return '(no name)';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : url.hostname;
  } catch (err) {
    const parts = value.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : value;
  }
}

function relativeTime(value) {
  if (!value) return '-';
  const now = Date.now();
  const then = new Date(value).getTime();
  if (isNaN(then)) return value;
  const diff = Math.floor((now - then) / 1000);
  if (diff < 0) return value;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function timestampLabel(value) { return value ? relativeTime(value) : '-'; }

function badgeClass(status) {
  if (['done', 'converged', 'ok', 'complete'].includes(status)) return 'badge good';
  if (['error', 'failed', 'missing', 'stopped'].includes(status)) return 'badge bad';
  if (['paused', 'queued', 'waiting', 'unchanged', 'skipped', 'cancelled'].includes(status)) return 'badge warn';
  return 'badge';
}

function sessionLabel(state) {
  if (state?.session_id && !state?.session_closed_at) return `current ${String(state.session_id).slice(0, 8)}`;
  if (state?.session_id && state?.session_closed_at) return `closed ${String(state.session_id).slice(0, 8)}`;
  return '-';
}
