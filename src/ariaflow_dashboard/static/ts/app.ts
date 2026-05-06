// @ts-nocheck
// Thin TS port of the original app.js. Type-checking is disabled for
// this file pending the planned split into typed modules
// (types/api/state/components). Behavior is unchanged.

import {
  formatEta,
  formatBytes,
  formatRate,
  formatMbps,
  humanCap,
  shortName,
  relativeTime,
  timestampLabel,
  badgeClass,
  sessionLabel,
  sessionIdShort,
} from './formatters';
import { renderItemSparkline, renderGlobalTimeline } from './sparkline';
import { apiFetch, postEmpty } from './api';
import {
  backendUrl as runtimeBackendUrl,
  dashboardPid as runtimeDashboardPid,
  dashboardVersion as runtimeDashboardVersion,
  localIps as runtimeLocalIps,
  localMainIp as runtimeLocalMainIp,
} from './runtime';
import {
  readRefreshInterval,
  writeRefreshInterval,
} from './storage';
import { applyLook } from './vendor/webstyle/looks';
import {
  createSimpleThemeController,
  type SimpleThemeController,
} from './vendor/webstyle/simple-theme-controller';
import {
  backendPath as composeBackendPath,
  backendDisplayName as composeBackendDisplayName,
  loadBackendState as loadBackendStateFromStorage,
  mergeDiscoveredItems,
  saveBackendState as persistBackendState,
} from './backend';
import {
  urlAria2GetOption,
  urlItemAction,
  urlItemFiles,
  urlLifecycleAction,
  urlScheduler,
  urlTorrentStop,
} from './actions';
import {
  filterQueueItems as composeFilterQueueItems,
  isFilterButtonVisible,
} from './filters';
import {
  buildStatusUrl,
  isStreamStale,
  nextReconnectDelayMs,
  parseActionLoggedEvent,
  parseStateChangedEvent,
  shouldShowOfflineStatus,
} from './events';
import {
  appendGlobalSpeed,
  recordItemSpeed,
  GLOBAL_SPEED_MAX,
  SPEED_HISTORY_MAX,
} from './speed_history';
import { diffItemStatuses } from './notifications';
import { normalizeFiles, selectedFileIndexes } from './file_selection';
import {
  distinctActions,
  distinctTargets,
  filterActionLog,
} from './log_filter';
import {
  bootstrapFreshnessRouter,
  wireHostVisibility,
} from './freshness-bootstrap';
import {
  describeLifecycleStatus,
  lifecycleBadgeClass,
  isLifecycleHealthy,
  lifecycleActionsFor,
  lifecycleDetailLines,
} from './lifecycle';

declare const Alpine: any;

document.addEventListener('alpine:init', () => {
  Alpine.data('ariaflow', () => ({
    // --- state ---
    lastStatus: null,
    lastLifecycle: null,
    lastDeclaration: null,
    refreshTimer: null,
    refreshInterval: 10000,
    _sse: null,
    _sseConnected: false,
    _sseFallbackTimer: null,
    _inBackoff: false,
    // SSE reliability state (see _initSSE / _armSseLivenessTimer):
    //   _sseReconnectAttempts — exponential backoff counter, reset on
    //   each successful 'connected' event.
    //   _sseLastActivityAt — timestamp of the last received SSE event;
    //   the liveness timer reconnects if no traffic arrives for >25s
    //   even when the TCP connection looks healthy.
    _sseReconnectAttempts: 0,
    _sseLastActivityAt: 0,
    _sseLivenessTimer: null,
    SSE_LIVENESS_TIMEOUT_MS: 25_000,
    SSE_LIVENESS_CHECK_MS: 15_000,
    queueFilter: 'all',
    queueSearch: '',
    speedHistory: {},
    SPEED_HISTORY_MAX,
    globalSpeedHistory: [0, 0],
    globalUploadHistory: [0, 0],
    GLOBAL_SPEED_MAX,
    previousItemStatuses: {},
    refreshInFlight: false,
    schedulerLoading: false,
    archiveLoading: false,
    lastRev: null,
    page: 'dashboard',
    DEFAULT_BACKEND_URL: runtimeBackendUrl(),
    localIps: runtimeLocalIps(),
    localMainIp: runtimeLocalMainIp(),
    webVersionText: (() => { const v = runtimeDashboardVersion(); return v ? `v${v}` : '-'; })(),
    webPidText: runtimeDashboardPid() || '-',
    webManagedBy: null,    // /api/web/lifecycle.result.managed_by
    webInstalledVia: null, // /api/web/lifecycle.result.installed_via
    get webRestartSupported() {
      // Restart works whenever we know how — even 'external' triggers
      // a Python re-exec via os.execv, so the only blocker is null.
      return this.webManagedBy != null;
    },
    get webUpdateSupported() {
      return ['homebrew', 'pipx', 'pip'].includes(this.webInstalledVia ?? '');
    },
    // Bonjour health: pending (initial) → ok / broken / unavailable after discovery
    bonjourState: 'pending',
    backendInput: '',
    backendsDiscovered: null,
    discoveryText: '',
    // URL → {name, host, ip} from Bonjour discovery, for friendly display.
    backendMeta: {},
    urlInput: '',
    addOutput: '',
    addPriority: '',
    addMirrors: '',
    addTorrentData: null,
    addMetalinkData: null,
    addPostActionRule: '',
    declarationText: '',
    actionFilter: 'all',
    targetFilter: 'all',
    sessionFilter: 'current',
    sourceFilter: 'all',
    fileSelectionItemId: null,
    fileSelectionFiles: [],
    fileSelectionLoading: false,
    archiveItems: [],
    filesData: [],
    filesError: null,
    cleanModalOpen: false,
    cleanForm: { recipe: 'complete_older_than', older_than_days: 30 },
    torrentList: [],
    torrentLoading: false,
    peerList: [],

    // cached backend state (updated on save, avoids localStorage parse per render)
    _cachedBackends: null,
    _cachedSelectedBackend: null,
    get backends() { if (this._cachedBackends === null) { const s = this.loadBackendState(); this._cachedBackends = s.backends; this._cachedSelectedBackend = s.selected; } return this._cachedBackends; },
    get selectedBackend() { if (this._cachedSelectedBackend === null) { const s = this.loadBackendState(); this._cachedBackends = s.backends; this._cachedSelectedBackend = s.selected; } return this._cachedSelectedBackend; },
    get state() { return this.lastStatus?.state || {}; },
    // Current transfer = the item matching state.active_gid (BG-30 #5: backend
    // derives this from aria2.tellActive). Falls back to the first item with
    // non-zero download/upload speed — covers HTTP downloads where the
    // backend hasn't stamped active_gid yet (e.g. between a fresh start and
    // the next tellActive read).
    get currentTransfer() {
      const items = this.lastStatus?.items || [];
      const gid = this.state?.active_gid;
      return (gid && items.find((it) => it && it.gid === gid))
        || items.find((it) => it && (Number(it.downloadSpeed) > 0 || Number(it.uploadSpeed) > 0))
        || null;
    },
    get currentSpeed() { return this.currentTransfer?.downloadSpeed || this.state?.download_speed || null; },
    get currentUploadSpeed() { return this.currentTransfer?.uploadSpeed || null; },
    get itemsWithStatus() { return this.lastStatus?.items || []; },
    get filteredItems() { return this.filterQueueItems(this.itemsWithStatus); },
    get backendReachable() {
      if (!this.lastStatus) return true;
      return this.lastStatus?.ok !== false && this.lastStatus?.['ariaflow-server']?.reachable !== false;
    },
    get filterCounts() {
      // Use backend summary when available (avoids client-side recount)
      const s = this.lastStatus?.summary;
      if (s && !this.queueSearch) {
        // BG-30 vocabulary: 6 aria2-native + 2 pre-aria2 + BG-55 awaiting_confirmation.
        return {
          all: s.total || 0,
          queued: s.queued || 0,
          waiting: s.waiting || 0,
          discovering: s.discovering || 0,
          active: s.active || 0,
          paused: s.paused || 0,
          awaiting_confirmation: s.awaiting_confirmation || 0,
          removed: s.removed || 0,
          complete: s.complete || 0,
          error: s.error || 0,
        };
      }
      const items = this.itemsWithStatus;
      const counts = { all: items.length, queued: 0, waiting: 0, discovering: 0, active: 0, paused: 0, awaiting_confirmation: 0, removed: 0, complete: 0, error: 0 };
      items.forEach((item) => {
        const status = (item.status || 'unknown').toLowerCase();
        if (status === 'queued') counts.queued++;
        else if (status === 'waiting') counts.waiting++;
        else if (status === 'discovering') counts.discovering++;
        else if (status === 'active') counts.active++;
        else if (status === 'paused') counts.paused++;
        else if (status === 'awaiting_confirmation') counts.awaiting_confirmation++;
        else if (status === 'removed') counts.removed++;
        else if (status === 'complete') counts.complete++;
        else if (status === 'error') counts.error++;
      });
      return counts;
    },
    // BG-40: state.scheduler_status is the source of truth (5-state enum).
    // The scheduler lives inside ariaflow-server: when the server is
    // unreachable, status is unknowable — show 'unknown' rather than the
    // stale enum value or a misleading 'stopped' fallback.
    get schedulerBadgeText() {
      if (!this.backendReachable) return 'unknown';
      return this.state?.scheduler_status || 'stopped';
    },
    get schedulerBadgeClass() {
      switch (this.schedulerBadgeText) {
        case 'running': return 'badge good';
        case 'paused': return 'badge warn';
        case 'unknown': return 'badge warn';
        default: return 'badge';
      }
    },
    get currentTransferName() {
      if (!this.currentTransfer) return '';
      return shortName(this.currentTransfer) || this.currentTransfer.url || '';
    },
    get schedulerActiveText() {
      if (this.schedulerBadgeText !== 'running' || !this.currentTransfer) return '';
      const name = shortName(this.currentTransfer) || this.currentTransfer.url || '';
      const dl = this.currentSpeed ? this.formatRate(this.currentSpeed) : '';
      return dl ? `${name} · ${dl}` : name;
    },
    runWaitReasonAction() {
      const a = this.schedulerWaitReasonAction;
      if (a) a.fn();
    },
    get schedulerWaitReasonAction() {
      // Only surface scheduler-domain blockers as in-line buttons.
      // Probe is a bandwidth concern — user navigates to Bandwidth
      // tab to manage it; cluttering the Scheduler row with a
      // "Run probe" CTA mixed two domains.
      switch (this.state?.wait_reason) {
        case 'preflight_blocked':
          return {
            label: 'Run preflight',
            fn: () => {
              this.preflightRun();
              setTimeout(() => document.getElementById('preflight-panel')?.scrollIntoView({ behavior: 'smooth' }), 50);
            },
          };
        case 'aria2_unreachable':
          return { label: 'Start aria2', fn: () => this.lifecycleAction('aria2', 'start') };
        default:
          return null;
      }
    },
    get schedulerWaitReasonText() {
      const r = this.state?.wait_reason;
      if (!r) return '';
      const labels = {
        queue_empty: 'queue empty',
        aria2_unreachable: 'aria2 unreachable',
        preflight_blocked: 'preflight blocked',
        disk_full: 'disk full',
        bandwidth_probe_pending: 'bandwidth probe pending',
      };
      return labels[r] || String(r).replace(/_/g, ' ');
    },
    get transferSpeedText() {
      if (!this.backendReachable) return 'offline';
      // Threshold at 1 KiB/s — sub-KiB trickle formats as "0 B/s" and
      // shows up as visual noise (↑ 0 B/s) when there's no real upload.
      const MIN = 1024;
      const dl = (this.currentSpeed ?? 0) >= MIN ? this.formatRate(this.currentSpeed) : null;
      const ul = (this.currentUploadSpeed ?? 0) >= MIN ? this.formatRate(this.currentUploadSpeed) : null;
      if (dl && ul) return `↓ ${dl}  ↑ ${ul}`;
      if (dl) return `↓ ${dl}`;
      // No active transfer: show "—" so the Throughput label stays
      // honest. The scheduler badge has its own home on the Dashboard
      // tab + Lifecycle row; surfacing it here was confusing the
      // hero label ("Throughput: idle · queue empty" doesn't parse).
      return '—';
    },
    get sessionStartedText() {
      if (!this.backendReachable) return '-';
      const at = this.state.session_started_at;
      // Hide misleading timestamps from a previous server instance.
      if (this.sessionTimestampStale(at)) return '-';
      return this.timestampLabel(at);
    },
    get schedulerBtnText() {
      if (!this.backendReachable) return 'Start';
      // BG-40: source of truth is the scheduler status enum, not raw
      // state.running. While 'starting', show that explicitly rather
      // than a disabled 'Pause' so the operator sees the engine is
      // bootstrapping (intent accepted, loop not yet dispatching).
      switch (this.schedulerBadgeText) {
        case 'paused': return 'Resume';
        case 'starting': return 'Starting…';
        case 'idle':
        case 'running': return 'Pause';
        case 'stopped':
        default: return 'Start';
      }
    },
    get schedulerBtnDisabled() {
      // Disable while bootstrapping — a click would either be a no-op
      // ('already_running') or race with the Start that's in flight.
      return !this.backendReachable || this.schedulerBadgeText === 'starting';
    },
    get isStale() {
      // True when the data is older than the user's tolerance window. Touch
      // _staleTick so Alpine re-evaluates this getter when the 1s tick fires.
      // Three triggers:
      //   - polling failures + age > 2× interval (normal backoff window)
      //   - SSE disconnected + polling 'Off' + age > 30s (silent freeze case)
      //   - SSE disconnected + polling enabled, falls back via failures path
      void this._staleTick;
      if (!this._lastFreshAt) return false;
      const ageMs = Date.now() - this._lastFreshAt;
      if (this._consecutiveFailures > 0 && ageMs > this.refreshInterval * 2) return true;
      // Polling Off + SSE dead: no failure counter to ride; trip on raw age.
      if (this.refreshInterval === 0 && !this._sseConnected && ageMs > 30_000) return true;
      return false;
    },
    get staleAgeText() {
      void this._staleTick;
      if (!this._lastFreshAt) return '';
      const secs = Math.floor((Date.now() - this._lastFreshAt) / 1000);
      if (secs < 60) return `${secs}s ago`;
      if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
      return `${Math.floor(secs / 3600)}h ago`;
    },
    get schedulerStopVisible() {
      // Stop is meaningful only for an active scheduler. Hide on
      // stopped/starting/unknown — those states either have nothing to
      // stop or are mid-bootstrap (racy).
      const s = this.schedulerBadgeText;
      return s === 'idle' || s === 'running' || s === 'paused';
    },
    get backendVersionText() {
      if (!this.backendReachable) return '-';
      const v = this.lastStatus?.['ariaflow-server']?.version;
      return v ? `v${v}` : 'unreported';
    },
    get backendPidText() {
      if (!this.backendReachable) return '-';
      return this.lastStatus?.['ariaflow-server']?.pid || 'unreported';
    },
    // Health data now comes from /api/status.health (BG-8). No separate timer needed.
    get lastHealth() { return this.lastStatus?.health || null; },
    get diskUsageText() {
      const h = this.lastHealth;
      if (!h || h.disk_usage_percent == null) return '-';
      return `${h.disk_usage_percent}%`;
    },
    get diskOk() { return this.lastHealth?.disk_ok !== false; },
    get healthUptimeText() {
      const s = this.lastHealth?.uptime_seconds;
      if (s == null) return '-';
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
    // True when the session heartbeat is older than the server has been
    // up — i.e. the timestamp is from a previous server instance and
    // therefore misleading. Used to hide stale session chips so we
    // don't show 'Last seen 4 min ago' while server uptime is 2m.
    sessionTimestampStale(at) {
      if (!at) return false;
      const uptimeS = this.lastHealth?.uptime_seconds;
      if (uptimeS == null) return false;
      const ageS = (Date.now() - new Date(at).getTime()) / 1000;
      return ageS > uptimeS + 5; // 5s slack for clock skew
    },
// Consolidated health surface (#3). Single chip in the header lists
    // a count + opens a panel detailing each issue. Replaces the
    // separate Error + mDNS L1 chips and the implicit per-tab badge
    // duplication when several signals fire at once.
    get healthIssues() {
      const issues: Array<{ label: string; level: 'warn' | 'bad' }> = [];
      if (!this.backendReachable) {
        const reason = this.lastStatus?.['ariaflow-server']?.error || 'connection refused';
        issues.push({ label: `Backend offline: ${reason}`, level: 'bad' });
      }
      if (this.bonjourState === 'broken') {
        issues.push({ label: 'mDNS browse failing', level: 'warn' });
      }
      if (this.lastHealth && this.lastHealth.disk_ok === false) {
        issues.push({ label: `Disk: ${this.diskUsageText}`, level: 'bad' });
      }
      return issues;
    },
    get healthBadgeText() {
      const n = this.healthIssues.length;
      return n === 0 ? 'Healthy' : `${n} issue${n === 1 ? '' : 's'}`;
    },
    get healthBadgeClass() {
      const issues = this.healthIssues;
      if (issues.length === 0) return 'chip badge good';
      return issues.some((i) => i.level === 'bad') ? 'chip badge warn' : 'chip badge';
    },
    get sessionIdText() {
      if (!this.backendReachable) return '-';
      return this.sessionLabel(this.state);
    },
    get sumQueued() { return this.lastStatus?.summary?.queued ?? 0; },
    get sumDone() { return this.filterCounts.complete ?? 0; },
    get sumError() { return this.filterCounts.error ?? 0; },
    get archivableCount() { return this.lastStatus?.summary?.archivable_count ?? (this.sumDone + this.sumError); },
    get canArchive() { return this.archivableCount > 0; },
    get archiveBtnDisabled() { return !this.backendReachable || !this.canArchive; },

    // bandwidth panel getters
    get bw() { return this.lastStatus?.bandwidth || {}; },
    get bwInterfaceText() {
      if (!this.backendReachable) return 'offline';
      return this.bw.interface_name || 'unknown';
    },
    get bwSourceText() {
      if (!this.backendReachable) return 'offline';
      return this.bw.source || '-';
    },
    _fmtMbps(v) { return v ? Number(v).toFixed(1) : '-'; },
    _fmtMBs(mbps) { return mbps ? (mbps / 8).toFixed(1) : '-'; },
    _bwOne(mbps) {
      if (!this.backendReachable || !mbps) return '- MB/s (- Mbps)';
      return `${this._fmtMBs(mbps)} MB/s (${this._fmtMbps(mbps)} Mbps)`;
    },
    get bwDownMeasuredText() { return this._bwOne(this.bw.downlink_mbps); },
    get bwUpMeasuredText() { return this._bwOne(this.bw.uplink_mbps); },
    get bwDownCapPairText() {
      const cap = this.bw.down_cap_mbps || this.bw.cap_mbps
        || this._reserveResultMbps(this.bw.downlink_mbps, this.bwDownFreePercent, this.bwDownFreeAbsolute);
      return this._bwOne(cap);
    },
    get bwUpCapPairText() {
      const cap = this.bw.up_cap_mbps
        || this._reserveResultMbps(this.bw.uplink_mbps, this.bwUpFreePercent, this.bwUpFreeAbsolute);
      return this._bwOne(cap);
    },
    // Live cap-utilization: most recent sparkline sample (bytes/sec)
    // converted to Mbps and divided by the active cap.
    get bwLiveDownMbps() {
      const arr = this.globalSpeedHistory || [];
      const bps = Number(arr[arr.length - 1]) || 0;
      return (bps * 8) / 1_000_000;
    },
    get bwUtilizationPct() {
      const cap = this.bw?.cap_mbps;
      if (!cap || cap <= 0) return 0;
      // Don't clamp at 100 — bursting past the cap is meaningful info
      // (cap is a soft target on the local probe; transient overshoot
      // happens). Clamping hides it.
      return Math.round((this.bwLiveDownMbps / cap) * 100);
    },
    // CAP usage zones: under-utilized → neutral, at-target → green,
    // significantly over → warn. The "at target" band is symmetric
    // ±5 % around the cap — being at or just past 100 % means we're
    // using the bandwidth we paid for, which is the desired state.
    // Only genuine bursting past the soft cap (> 105 %) is a warning.
    get bwOverCap() {
      const cap = this.bw?.cap_mbps;
      return !!cap && cap > 0 && this.bwLiveDownMbps > cap * 1.05;
    },
    get bwAtCapTarget() {
      const cap = this.bw?.cap_mbps;
      if (!cap || cap <= 0) return false;
      const ratio = this.bwLiveDownMbps / cap;
      return ratio >= 0.95 && ratio <= 1.05;
    },
// Reserve preview: stricter of (% policy, absolute Mbps policy).
    // Mirrors the backend's "stricter wins" logic so users see exactly
    // the cap their inputs will produce.
    _reserveResultMbps(measured, pct, abs) {
      if (!measured) return null;
      const fromPct = measured * (1 - pct / 100);
      const fromAbs = measured - abs;
      return Math.max(0, Math.min(fromPct, fromAbs));
    },
    get bwDownReserveResultText() {
      const r = this._reserveResultMbps(this.bw?.downlink_mbps, this.bwDownFreePercent, this.bwDownFreeAbsolute);
      return r == null ? '' : `cap will be ${r.toFixed(1)} Mbps`;
    },
    get bwUpReserveResultText() {
      const r = this._reserveResultMbps(this.bw?.uplink_mbps, this.bwUpFreePercent, this.bwUpFreeAbsolute);
      return r == null ? '' : `cap will be ${r.toFixed(1)} Mbps`;
    },
    // Probe staleness: warn when the last probe is older than 1.5x the
    // configured auto-interval — the auto-probe is broken or paused.
    get bwProbeStale() {
      const last = this.bw?.last_probe_at;
      if (!last) return false;
      const interval = this.bwProbeInterval || 180;
      const ageSeconds = Date.now() / 1000 - last;
      return ageSeconds > interval * 1.5;
    },
    // Concurrency hint: shows the per-download throughput trade-off.
    get bwConcurrencyHint() {
      const cap = this.bw?.cap_mbps;
      const n = this.bwConcurrency || 1;
      if (!cap) return '';
      if (n <= 1) return `1 download at full available bandwidth (~${cap.toFixed(1)} Mbps)`;
      return `${n} downloads, ~${(cap / n).toFixed(1)} Mbps each`;
    },
    get bwResponsivenessText() {
      if (!this.backendReachable) return '-';
      return this.bw.responsiveness_rpm ? Math.round(this.bw.responsiveness_rpm) + ' RPM' : '-';
    },

    // bandwidth config getters (names must match backend contracts.py)
    // --- preference getters (numeric) ---
    _numPref(name, def) { return Number(this.getDeclarationPreference(name) ?? def); },
    get bwDownFreePercent() { return this._numPref('bandwidth_down_free_percent', 20); },
    get bwDownFreeAbsolute() { return this._numPref('bandwidth_down_free_absolute_mbps', 0); },
    get bwUpFreePercent() { return this._numPref('bandwidth_up_free_percent', 50); },
    get bwUpFreeAbsolute() { return this._numPref('bandwidth_up_free_absolute_mbps', 0); },
    get bwProbeInterval() { return this._numPref('bandwidth_probe_interval_seconds', 180); },
    get bwConcurrency() { return this._numPref('max_simultaneous_downloads', 1); },
    get bwDedupValue() { return this.getDeclarationPreference('duplicate_active_transfer_action') || 'remove'; },

    // options getters
    get autoPreflightEnabled() { return !!this.getDeclarationPreference('auto_preflight_on_run'); },
    get postActionRuleValue() { return this.getDeclarationPreference('post_action_rule') || 'pending'; },
    // BG-45: self-management prefs. Reads default to false until backend
    // ships the reconciliation loop; setting them via setPref still
    // persists into the declaration regardless.
    get autoStartAria2Enabled() { return !!this.getDeclarationPreference('auto_start_aria2'); },
    get autoUpdateEnabled() { return !!this.getDeclarationPreference('auto_update'); },
    get autoUpdateCheckHours() {
      const v = Number(this.getDeclarationPreference('auto_update_check_hours'));
      return Number.isFinite(v) && v > 0 ? v : 24;
    },
    // Dashboard-local auto-update (FE-48). Stored at ~/.ariaflow-dashboard/
    // config.json on the box running the dashboard, NOT in the server's
    // declaration — must work when the server is down.
    webConfig: { auto_update: false, auto_update_check_hours: 24, update_server_first: false, auto_restart_after_upgrade: true, backend_url: '' },
    // Local probe: is ariaflow-server installed on this machine?
    // null = haven't probed yet; falsy means not installed.
    serverProbe: null,
    get dashAutoUpdateEnabled() { return !!this.webConfig?.auto_update; },
    get dashAutoUpdateCheckHours() {
      const v = Number(this.webConfig?.auto_update_check_hours);
      return Number.isFinite(v) && v > 0 ? v : 24;
    },
    get dashUpdateServerFirst() { return !!this.webConfig?.update_server_first; },
    get dashAutoRestart() { return this.webConfig?.auto_restart_after_upgrade !== false; },

    // lifecycle
    lifecycleRows: [],
    _lifecycleSession: null,

    // cleanup & pagination
    archiveLimit: 100,
    logLimit: 120,

    // session history

    // log state
    resultText: 'Idle',
    resultJson: 'Idle',
    contractTraceItems: null,
    preflightData: null,
    actionLogEntries: [],
    webLogEntries: [],

    // api discovery

    // aria2 options (safe subset exposed by backend)
    itemOptionsGid: null,
    itemOptionsData: null,
    aria2Options: {},
    aria2Tiers: { managed: [], safe: [], unsafe_enabled: false },
    aria2OptionResult: '',

    // openapi spec version (FE-29 / BG-37: detect spec/runtime stamp drift)
    specVersion: null as string | null,

    // test suite
    testLoading: false,
    uccLoading: false,
    preflightLoading: false,
    testSummaryVisible: false,
    lastTestStdout: '',
    lastTestStderr: '',
    testBadgeText: '-',
    testBadgeClass: 'badge',
    testCountsText: '-',
    testResults: [],

    // --- init ---
    init() {
      const path = window.location.pathname.replace(/[/]+$/, '');
      this.page = path === '/bandwidth' ? 'bandwidth'
        : path === '/lifecycle' ? 'lifecycle'
        : path === '/options' ? 'options'
        : path === '/log' ? 'log'
        : path === '/dev' ? 'dev'
        : path === '/archive' ? 'archive'
        : 'dashboard';

      this.initTheme();
      this.initNotifications();
      this._runTabMountHooks(this.page);
      window.addEventListener('beforeunload', () => { if (this._prefQueue.length) this._flushPrefQueue(); });
      document.addEventListener('visibilitychange', () => this._onVisibilityChange());
      window.addEventListener('popstate', () => {
        const path = window.location.pathname.replace(/[/]+$/, '');
        const target = path === '/bandwidth' ? 'bandwidth' : path === '/lifecycle' ? 'lifecycle' : path === '/options' ? 'options' : path === '/log' ? 'log' : path === '/dev' ? 'dev' : path === '/archive' ? 'archive' : 'dashboard';
        this.page = target;
        this._refreshTabOnly(target);
      });

      // FE-24: bootstrap the FreshnessRouter from /api/_meta. Non-blocking;
      // a transport error leaves the router null and tabs render empty.
      this._initFreshness();

      // 1Hz tick to re-evaluate isStale / staleAgeText getters.
      setInterval(() => { this._staleTick++; }, 1000);

      // First load: refresh header + active tab once, then arm fast timer.
      this.refreshInterval = readRefreshInterval(10000);
      this._refreshAll();
      // Bootstrap /api/lifecycle once at startup so the System Health
      // nav badge (lifecycleErrorCount) reflects component health from
      // page load. Without this, the badge stays at 0 until the
      // operator visits the System Health tab.
      this.loadLifecycle();
      if (this.refreshInterval > 0) {
        this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
      }

      // Keyboard shortcuts: 1–7 switch tabs
      document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
        const tabs = ['dashboard', 'bandwidth', 'lifecycle', 'options', 'log', 'dev', 'archive'];
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < tabs.length) this.navigateTo(tabs[idx]);
      });

      // SSE for real-time updates (falls back to polling on failure)
      this._initSSE();

      // Discovery is non-critical, defer it
      setTimeout(() => this.discoverBackends().catch((e) => console.warn(e.message)), 2000);
      // Re-run discovery every 60s. The mDNS browse cache and the
      // /api/peers fallback can both shift as peers come/go or the
      // ariaflow-server restarts; firing once at init meant the badge
      // got stuck on the boot-time result.
      setInterval(() => this.discoverBackends().catch((e) => console.warn(e.message)), 60_000);
      // Dashboard-local config (FE-48). Same-origin, cheap.
      this.loadWebConfig();
      // Local probe: is ariaflow-server installed on this machine?
      // Drives the cold-start "Install ariaflow-server" CTA on the
      // Lifecycle tab when backend is unreachable.
      this.loadServerProbe();
    },

    // --- per-tab data routing ---
    // Each entry maps a tab to one or more endpoints; the FreshnessRouter
    // decides when to fetch (class + ttl + visibility + ref-count) and
    // calls `apply(self, data)` to update view state. Tab entry / exit
    // subscribes / unsubscribes; visibility is delegated to the router.
    // Declaration's "policies" field is surfaced via _applyDeclaration.
    TAB_SUBS: {
      dashboard: [
        { method: 'GET', path: '/api/declaration', apply: (s, d) => s._applyDeclaration(d) },
        // Needed for the awaiting_confirmation banner (BG-55): confirmContext
        // joins item.output_path against the live filesystem listing to show
        // size + history info. Cheap thanks to /api/files's `warm` TTL cache.
        { method: 'GET', path: '/api/files', apply: (s, d) => { s.filesData = d?.files || []; s.filesError = d?.ok === false ? (d.error || 'unknown') : null; } },
      ],
      bandwidth: [
        { method: 'GET', path: '/api/bandwidth',   apply: (s, d) => s._applyBandwidth(d) },
        { method: 'GET', path: '/api/declaration', apply: (s, d) => s._applyDeclaration(d) },
      ],
      lifecycle: [
        { method: 'GET', path: '/api/lifecycle', apply: (s, d) => s._applyLifecycle(d) },
        { method: 'GET', path: '/api/web/lifecycle', apply: (s, d) => s._applyWebLifecycle(d) },
      ],
      options: [
        { method: 'GET', path: '/api/aria2/global_option', apply: (s, d) => s._applyAria2GlobalOption(d) },
        { method: 'GET', path: '/api/aria2/option_tiers',      apply: (s, d) => s._applyAria2OptionTiers(d) },
        { method: 'GET', path: '/api/torrents',                apply: (s, d) => s._applyTorrents(d) },
        { method: 'GET', path: '/api/peers',                   apply: (s, d) => s._applyPeers(d) },
        { method: 'GET', path: '/api/declaration',             apply: (s, d) => s._applyDeclaration(d) },
      ],
      log: [
        { method: 'GET', path: '/api/web/log', getParams: () => ({ limit: 100 }), apply: (s, d) => s._applyWebLog(d) },
        { method: 'GET', path: '/api/declaration', apply: (s, d) => s._applyDeclaration(d) },
      ],
      archive: [
        {
          method: 'GET',
          path: '/api/downloads/archive',
          getParams: (self) => ({ limit: self.archiveLimit }),
          apply: (self, data) => { self.archiveItems = data?.items || []; },
        },
        {
          method: 'GET',
          path: '/api/files',
          apply: (self, data) => { self.filesData = data?.files || []; self.filesError = data?.ok === false ? (data.error || 'unknown') : null; },
        },
        // FE-52: needed to detect mismatch with declaration.download_dir.
        { method: 'GET', path: '/api/aria2/global_option', apply: (s, d) => s._applyAria2GlobalOption(d) },
        { method: 'GET', path: '/api/declaration', apply: (s, d) => s._applyDeclaration(d) },
      ],
    },
    // FE-31: dashboard-served endpoints (/api/web/log, /api/discovery)
    // now arrive via the dashboard's /api/_meta. /api/aria2/option_tiers
    // is the only remaining synthetic mirror — it's a backend endpoint
    // that BG-34 didn't include in the backend /api/_meta registry.
    LOCAL_METAS: [
      { method: 'GET', path: '/api/aria2/option_tiers', freshness: 'cold' },
    ],
    // One-shot actions to run when a tab becomes the active page (either
    // on direct URL load via init() or via navigateTo()). For tab-driven
    // *recurring* fetches use TAB_SUBS instead — the FreshnessRouter
    // handles those. Mount hooks are for things like loadSpecVersion()
    // that don't fit the subscribe model.
    TAB_MOUNT_HOOKS: {
      dev: [(self) => self.loadSpecVersion()],
    },
    _tabHidden: false,
    _currentTabSubs: [],

    _runTabMountHooks(target) {
      const hooks = (this.TAB_MOUNT_HOOKS && this.TAB_MOUNT_HOOKS[target]) || [];
      for (const fn of hooks) {
        try { fn(this); } catch (e) { /* one bad hook shouldn't break others */ }
      }
    },

    _unsubscribeTab() {
      if (!this._freshnessRouter) { this._currentTabSubs = []; return; }
      for (const s of this._currentTabSubs) {
        try { this._freshnessRouter.unsubscribe(s.method, s.path, s.id); } catch (e) { /* ignore */ }
      }
      this._currentTabSubs = [];
    },
    _subscribeTab(target) {
      this._unsubscribeTab();
      if (!this._freshnessRouter) return;
      const subs = (this.TAB_SUBS && this.TAB_SUBS[target]) || [];
      for (const s of subs) {
        const id = `tab:${target}:${s.method} ${s.path}`;
        const params = s.getParams ? s.getParams(this) : undefined;
        try {
          this._freshnessRouter.subscribe(s.method, s.path, id, {
            visible: true,
            params,
            onUpdate: (v) => { try { s.apply(this, v); } catch (e) { console.warn(e); } },
          });
          this._currentTabSubs.push({ method: s.method, path: s.path, id });
        } catch (e) {
          // Endpoint isn't registered with the router — should never
          // happen under the current contract (BG-31 / BG-34 cover all
          // TAB_SUBS endpoints; LOCAL_METAS covers the rest). Surface
          // the bug rather than silently breaking the tab.
          console.warn(`subscribe failed for ${id}:`, e);
        }
      }
    },
    // Refresh header AND active tab (init / visibility resume / backend switch).
    _refreshAll() {
      this.refresh();
      this._subscribeTab(this.page);
    },
    // Refresh only the active tab (navigateTo): the header keeps ticking on
    // its own fast timer, no need to force an extra refresh().
    _refreshTabOnly(target) {
      this._subscribeTab(target);
    },

    filterLogToCurrentSession() {
      this.sessionFilter = 'current';
      this.navigateTo('log');
    },

    navigateTo(target) {
      if (this.page === target) return;
      this.page = target;
      const urlMap = { dashboard: '/', bandwidth: '/bandwidth', lifecycle: '/lifecycle', options: '/options', log: '/log', dev: '/dev', archive: '/archive' };
      history.pushState(null, '', urlMap[target] || '/');
      this._refreshTabOnly(target);
      this._runTabMountHooks(target);
    },
    _onVisibilityChange() {
      const hidden = document.visibilityState === 'hidden';
      if (hidden === this._tabHidden) return;
      this._tabHidden = hidden;
      if (hidden) {
        // Tab hidden: pause all timers + close SSE to stop network chatter
        if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
        if (this._sseFallbackTimer) { clearTimeout(this._sseFallbackTimer); this._sseFallbackTimer = null; }
        if (this._deferTimer) { clearTimeout(this._deferTimer); this._deferTimer = null; }
        this._unsubscribeTab();
        this._closeSSE();
      } else {
        // Tab visible: header + active tab are stale, refresh both
        if (this.refreshInterval > 0) {
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
        }
        this._refreshAll();
        this._initSSE();
      }
    },

    // --- formatting ---
    // --- formatters (delegated to formatters.js) ---
    formatEta, formatBytes, formatRate, formatMbps, humanCap, shortName,
    relativeTime, timestampLabel, badgeClass, sessionLabel, sessionIdShort,

syncSchedulerResultText() {
      const staleSchedulerMessages = new Set([
        'Pause requested',
        'Resume requested',
        'Downloads paused',
        'Downloads resumed',
        'Scheduler started',
        'Scheduler already running',
      ]);
      if (!staleSchedulerMessages.has(this.resultText)) return;
      if (!this.backendReachable) return;
      if (!this.state?.running) {
        this.resultText = 'Scheduler idle';
        return;
      }
      this.resultText = this.state?.dispatch_paused ? 'Downloads paused' : 'Downloads running';
    },
    _offlineStatusLabel() {
      const data = this.lastStatus;
      const error = data?.['ariaflow-server']?.error || data?.error || 'backend unavailable';
      return `Backend unavailable · ${error}`;
    },

    // --- sparklines (rendering delegated to sparkline.js) ---
    recordSpeed(itemId, speed) {
      const next = recordItemSpeed(this.speedHistory, itemId, speed);
      if (next !== this.speedHistory) this.speedHistory = next;
    },
    renderSparkline(itemId) { return renderItemSparkline(this.speedHistory[itemId]); },
    recordGlobalSpeed(dlSpeed, ulSpeed) {
      const next = appendGlobalSpeed(
        { download: this.globalSpeedHistory, upload: this.globalUploadHistory },
        dlSpeed,
        ulSpeed,
      );
      this.globalSpeedHistory = next.download;
      this.globalUploadHistory = next.upload;
    },
    get globalTimelineSvg() {
      return renderGlobalTimeline(
        this.globalSpeedHistory,
        this.globalUploadHistory,
        Number(this.bw?.cap_mbps) || 0,
        Number(this.refreshInterval) || 10000,
      );
    },

    // --- notifications ---
    checkNotifications(items) {
      const { notifications, nextStatusMap } = diffItemStatuses(this.previousItemStatuses, items);
      this.previousItemStatuses = nextStatusMap;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      for (const n of notifications) {
        new Notification(n.title, { body: n.body, tag: n.tag });
      }
    },
    initNotifications() {
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
      const handler = () => {
        Notification.requestPermission();
        document.removeEventListener('click', handler);
      };
      document.addEventListener('click', handler);
    },

    // --- theme (delegated to @bonomani/webstyle/simple-theme-controller:
    // look auto-detected from platform, mode = light/dark/auto, no a11y) ---
    // Cycle: auto → light → dark → auto. Label shows the *next* mode
    // a click selects, not the current state — clearer than reporting
    // "Theme: dark" which doesn't tell the user what clicking will do.
    themeLabel: 'Switch to light',
    _themeController: null as SimpleThemeController | null,
    initTheme() {
      const nextMode: Record<string, string> = { auto: 'light', light: 'dark', dark: 'auto' };
      this._themeController = createSimpleThemeController({ apply: applyLook });
      this._themeController.subscribe((s) => {
        this.themeLabel = `Switch to ${nextMode[s.mode] ?? 'auto'}`;
      });
    },
    toggleTheme() {
      this._themeController?.cycleMode();
    },

    async _initFreshness() {
      try {
        const router = await bootstrapFreshnessRouter({
          metaUrl: () => this.backendPath('/api/_meta'),
          dashboardMetaUrl: () => '/api/_meta',
          now: () => Date.now(),
          setTimer: (cb, ms) => setTimeout(cb, ms),
          clearTimer: (token) => clearTimeout(token),
          fetchJson: async (method, path, params, host) => {
            // FE-31: dashboard-served endpoints fetch same-origin; backend-
            // served endpoints route via backendPath() to the selected backend.
            let url = host === 'dashboard' ? path : this.backendPath(path);
            if (params) {
              const qs = new URLSearchParams();
              for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
              const s = qs.toString();
              if (s) url += (url.includes('?') ? '&' : '?') + s;
            }
            const r = await apiFetch(url, { method, timeoutMs: 8000 });
            return r.json();
          },
        });
        if (!router) return;
        // FE-26: register synthetic meta for endpoints not exposed by
        // /api/_meta (dashboard-served, or not in BG-34's contract).
        for (const m of this.LOCAL_METAS || []) {
          try { router.registerMeta(m); } catch (e) { /* ignore */ }
        }
        this._freshnessRouter = router;
        this._freshnessVisibility = wireHostVisibility(router);
        // /api/_meta was just fetched by bootstrapFreshnessRouter outside
        // the router's runFetch path; stamp it so the Dev-tab map shows
        // real activity instead of 'never'.
        try { router.markExternalFetch('GET', '/api/_meta'); } catch (e) { /* ignore */ }
        // FE-26: now that the router is up, subscribe the current
        // tab. init() / _refreshAll ran before the router booted, so
        // every tab's subscriptions were skipped.
        this._subscribeTab(this.page);
      } catch (e) {
        // Transport / parse error reaching /api/_meta. Tabs render
        // empty until the next reload retries.
      }
    },

    // --- fetch with timeout ---
    _fetch(url, opts = {}, timeout = 10000) {
      const promise = apiFetch(url, { ...opts, timeoutMs: timeout });
      const method = (opts && opts.method ? String(opts.method) : 'GET').toUpperCase();
      // FE-24: when a non-GET succeeds, ask the freshness router to
      // invalidate any endpoint whose meta.revalidate_on lists this
      // METHOD path. The router is async-booted, so this short-circuits
      // for any _fetch that races init() before the router resolves.
      if (method !== 'GET' && this._freshnessRouter) {
        promise.then((r) => {
          if (r && r.ok) {
            try {
              const path = new URL(url, window.location.origin).pathname;
              this._freshnessRouter.invalidateByAction(method, path);
            } catch { /* ignore */ }
          }
        }).catch(() => { /* propagated to caller */ });
      }
      return promise;
    },
    _freshnessRouter: null,
    _freshnessVisibility: null,
    get freshnessStatus() {
      return this._freshnessRouter ? this._freshnessRouter.status() : [];
    },

    // --- backend management (delegates to ts/backend.ts) ---
    loadBackendState() {
      return loadBackendStateFromStorage(this.DEFAULT_BACKEND_URL);
    },
    saveBackendState(backends, selected) {
      const next = persistBackendState(backends || [], selected, this.DEFAULT_BACKEND_URL);
      this._cachedBackends = next.backends;
      this._cachedSelectedBackend = next.selected;
    },
    mergeDiscoveredBackends(items) {
      const result = mergeDiscoveredItems(
        items,
        this.backendMeta,
        this.loadBackendState(),
        { defaultBackendUrl: this.DEFAULT_BACKEND_URL, localIps: this.localIps || [] },
      );
      this.backendMeta = result.meta;
      // saveBackendState already ran inside mergeDiscoveredItems; mirror
      // the cached fields the Alpine component reads in templates.
      this._cachedBackends = result.state.backends;
      this._cachedSelectedBackend = result.state.selected;
      if (result.autoSelectedUrl) {
        this._closeSSE();
        this._initSSE();
        this.deferRefresh(0);
      }
    },
    backendDisplayName(url) {
      return composeBackendDisplayName(
        url,
        this.backendMeta,
        this.DEFAULT_BACKEND_URL,
        runtimeLocalMainIp(),
      );
    },
    backendPath(path) {
      return composeBackendPath(
        this.loadBackendState().selected || this.DEFAULT_BACKEND_URL,
        path,
      );
    },
    backendBaseUrl() {
      return this.loadBackendState().selected || this.DEFAULT_BACKEND_URL;
    },
    selectBackend(backend) {
      const state = this.loadBackendState();
      if (!state.backends.includes(backend)) state.backends.push(backend);
      this.saveBackendState(state.backends, backend);
      this._initSSE();
      // Backend changed: header chips and active-tab data are all stale.
      this._refreshAll();
    },
    addBackend() {
      const value = (this.backendInput || '').trim();
      if (!value) return;
      const state = this.loadBackendState();
      if (value !== this.DEFAULT_BACKEND_URL && !state.backends.includes(value)) state.backends.push(value);
      this.saveBackendState(state.backends, value);
      this.backendInput = '';
      this.deferRefresh(0);
    },
    removeBackend(backend) {
      const state = this.loadBackendState();
      this.saveBackendState(state.backends.filter((item) => item !== backend), state.selected === backend ? this.DEFAULT_BACKEND_URL : state.selected);
      this.deferRefresh(0);
    },
    async discoverBackends() {
      let bonjourItems: unknown[] = [];
      try {
        const r = await this._fetch('/api/discovery');
        const data = await r.json();
        bonjourItems = Array.isArray(data?.items) ? data.items : [];
        if (data?.available === false) {
          this.bonjourState = 'unavailable';
        } else if (bonjourItems.length === 0) {
          this.bonjourState = 'broken';
        } else {
          this.bonjourState = 'ok';
        }
        this.mergeDiscoveredBackends(bonjourItems);
      } catch (e) {
        this.bonjourState = 'broken';
      }

      // FE-22: when local mDNS browse returns nothing (WSL NAT, containers,
      // VMs without mDNS), fall back to /api/peers on the current backend
      // and merge those into the same discovered-backends list.
      let peerItems: unknown[] = [];
      if (bonjourItems.length === 0 && this.backendReachable) {
        try {
          const r = await this._fetch(this.backendPath('/api/peers'));
          const data = await r.json();
          const peers = Array.isArray(data?.peers) ? data.peers : [];
          peerItems = peers
            .filter((p: { status?: string; base_url?: string; host?: string; port?: number }) => p && (p.base_url || (p.host && p.port)))
            .map((p: { instance?: string; host?: string; port?: number; base_url?: string; status?: string }) => ({
              url: p.base_url || `http://${p.host}:${p.port}`,
              name: p.instance || p.host || '',
              host: p.host || '',
              ip: '',
              role: 'backend',
              source: 'peers',
            }));
          if (peerItems.length > 0) this.mergeDiscoveredBackends(peerItems);
        } catch (e) {
          // Backend unreachable or /api/peers absent — keep mDNS-only state.
        }
      }

      const total = bonjourItems.length + peerItems.length;
      this.backendsDiscovered = total > 0;
      this.discoveryText = total > 0
        ? `Discovered ${total} backend service(s)${peerItems.length && !bonjourItems.length ? ' via /api/peers fallback' : ''}`
        : 'No Bonjour backends discovered';
    },
    get bonjourBadgeText() {
      return ({ pending: 'mDNS …', ok: 'mDNS ✓', broken: 'mDNS ✗', 'unavailable': 'mDNS N/A' })[this.bonjourState] || 'mDNS';
    },
get bonjourBadgeTitle() {
      return ({
        pending: 'Discovering Bonjour services…',
        ok: 'Bonjour discovery working',
        broken: 'Bonjour returned no results',
        unavailable: 'No mDNS tool (dns-sd/avahi) available on this machine',
      })[this.bonjourState] || '';
    },

    // --- queue ---
    filterQueueItems(items) {
      return composeFilterQueueItems(items, this.queueFilter, this.queueSearch);
    },
    setQueueFilter(filter) {
      this.queueFilter = filter;
    },
    filterBtnVisible(f) {
      return isFilterButtonVisible(f, this.filterCounts, this.queueFilter);
    },
    // BG-55 awaiting_confirmation enrichment.
    // Backend doesn't populate item.detail on the queue row — it only stamps
    // output_path. Join with filesData (from GET /api/files) to surface the
    // real size + history info in the banner.
    confirmContext(item) {
      const path = item?.output_path;
      if (!path) return null;
      const file = (this.filesData || []).find((f) => f.path === path);
      if (!file) return null;
      return {
        existing_path: file.path,
        existing_size: file.size,
        history_match: !!file.history_match,
        last_downloaded_at: file.history_match?.downloaded_at || item.completed_at || null,
        remote_changed: false,
      };
    },
    filterLabel(f) {
      // 'awaiting_confirmation' is the only multi-word status; render it
      // as 'Confirm' to fit the filter bar. Other statuses are short
      // enough for naive capitalization.
      if (f === 'awaiting_confirmation') return 'Confirm';
      return f.charAt(0).toUpperCase() + f.slice(1);
    },
    // BG-55: three decision actions for items in awaiting_confirmation.
    async itemConfirmRedownload(itemId) { return this._itemDecision(itemId, 'confirm'); },
    async itemSkipRedownload(itemId)    { return this._itemDecision(itemId, 'skip');    },
    async itemRenameRedownload(itemId)  { return this._itemDecision(itemId, 'rename');  },
    async _itemDecision(itemId, decision) {
      try {
        const r = await postEmpty(this.backendPath(`/api/downloads/${encodeURIComponent(itemId)}/${decision}`));
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.resultText = data?.message || `${decision} failed`;
          return;
        }
        this.resultText = decision === 'confirm' ? 'Re-downloading' : decision === 'skip' ? 'Skipped duplicate' : 'Adding as renamed copy';
        this.refresh();
      } catch (e) {
        this.resultText = `${decision} failed: ${e.message}`;
      }
    },
    // queue item helpers for template
    itemNormalizedStatus(item) {
      return item.status || 'unknown';
    },
    itemHasActiveStatus(item) {
      return ['active', 'paused'].includes(item.status || 'unknown');
    },
    itemShortUrl(item) {
      return this.shortName(item.output || item.url || '(no url)');
    },
    itemDetail(item) {
      // GID is aria2-internal — truncate to 8 chars in the visible
      // line; full value is still on the row's data and reachable
      // via Options or the action log.
      const gid = item.gid ? `GID ${String(item.gid).slice(0, 8)}` : null;
      return [
        item.created_at ? `Added ${this.relativeTime(item.created_at)}` : null,
        item.completed_at ? `Done ${this.relativeTime(item.completed_at)}` : null,
        item.error_at ? `Failed ${this.relativeTime(item.error_at)}` : null,
        gid,
      ].filter(Boolean).join(' · ');
    },
    itemLiveStatus(item) { return item.live_status || null; },
    itemSpeed(item) { return item.downloadSpeed; },
    itemTotalLength(item) { return item.totalLength; },
    itemCompletedLength(item) { return item.completedLength; },
    itemProgress(item) {
      if (item.percent != null) return item.percent;
      const total = Number(item.totalLength || 0);
      const completed = Number(item.completedLength || 0);
      return total > 0 ? (completed / total) * 100 : 0;
    },
    itemShowTransferPanel(item) {
      return this.itemHasActiveStatus(item) || item.totalLength || item.completedLength || item.percent != null;
    },
    itemRateLabel(item) {
      const speed = this.itemSpeed(item);
      if (speed) return this.formatRate(speed);
      if (item.rpc_failures) {
        return /timed out/i.test(item.rpc_error_message || '') ? 'timed out' : 'rpc issue';
      }
      if (item.error_code === 'rpc_unreachable' || /timed out/i.test(item.error_message || '')) {
        return 'timed out';
      }
      if (['active', 'waiting'].includes(this.itemNormalizedStatus(item))) return 'stale';
      return this.itemNormalizedStatus(item) === 'paused' ? 'paused' : 'idle';
    },
    itemShowPausedAt(item) {
      return this.itemNormalizedStatus(item) === 'paused' && !!item.paused_at;
    },
    itemModeBadge(item) {
      const mode = item.mode || null;
      if (!mode || mode === 'http') return null;
      return mode;
    },
    itemPriority(item) { return item.priority != null ? item.priority : null; },
    itemDisplayUrl(item) { return item.url || ''; },
    itemStateLabel(item) {
      const ns = this.itemNormalizedStatus(item);
      if (item.rpc_failures) {
        const limit = Number(item.rpc_failure_limit || 0);
        const detail = /timed out/i.test(item.rpc_error_message || '') ? 'rpc timeout' : 'rpc issue';
        return limit > 0 ? `${ns} · ${detail} ${item.rpc_failures}/${limit}` : `${ns} · ${detail}`;
      }
      return ns;
    },
    itemCanPause(item)  { return this.itemNormalizedStatus(item) === 'active'; },
    itemCanResume(item) { return this.itemNormalizedStatus(item) === 'paused'; },
    itemCanRetry(item)  { return ['error', 'removed'].includes(this.itemNormalizedStatus(item)); },
    itemCanRemove(item) { return true; },
    // Manual refresh wrappers for the Options tab Load/Refresh buttons.
    // Data auto-loads on tab visit via TAB_SUBS; these force a fresh
    // fetch so the operator can override the warm-cache TTL.
    async loadDeclaration() {
      try {
        const r = await this._fetch(this.backendPath('/api/declaration'));
        this._applyDeclaration(await r.json());
      } catch (e) { this.resultText = `Load declaration failed: ${e.message}`; }
    },
    async loadPeers() {
      try {
        const r = await this._fetch(this.backendPath('/api/peers'));
        this._applyPeers(await r.json());
      } catch (e) { this.resultText = `Load peers failed: ${e.message}`; }
    },
    itemToggleAction(item) {
      if (this.itemCanPause(item)) return this.itemAction(item.id, 'pause');
      if (this.itemCanResume(item)) return this.itemAction(item.id, 'resume');
      if (this.itemCanRetry(item)) return this.itemAction(item.id, 'retry');
    },
    itemToggleLabel(item) {
      if (this.itemCanPause(item)) return 'Pause';
      if (this.itemCanResume(item)) return 'Resume';
      if (this.itemCanRetry(item)) return 'Retry';
      return '';
    },
    itemCanToggle(item) {
      return this.itemCanPause(item) || this.itemCanResume(item) || this.itemCanRetry(item);
    },
    itemEta(item) { return this.formatEta(this.itemTotalLength(item), this.itemCompletedLength(item), this.itemSpeed(item)); },
    itemSparklineSvg(item) {
      if (!item.id) return '';
      if (this.itemHasActiveStatus(item)) this.recordSpeed(item.id, this.itemSpeed(item) || 0);
      return this.renderSparkline(item.id);
    },

    // --- SSE ---
    _initSSE() {
      if (this._sse) { this._sse.close(); this._sse = null; }
      // BG-32 topic filter: only subscribe to topics we actually consume
      // (state_changed → items+scheduler; action_logged → log; session_*
      // → scheduler). Skips lifecycle_changed and bandwidth_probed —
      // re-add to topics if a future handler needs them. Back-compat:
      // older backends ignore ?topics and stream everything.
      const url = this.backendPath('/api/events?topics=items,scheduler,log');
      let es;
      try { es = new EventSource(url); } catch (e) { return; }
      this._sse = es;
      const markActivity = () => { this._sseLastActivityAt = Date.now(); };
      es.addEventListener('connected', () => {
        this._sseConnected = true;
        this._sseReconnectAttempts = 0;
        markActivity();
        this._armSseLivenessTimer();
        if (this._sseFallbackTimer) { clearTimeout(this._sseFallbackTimer); this._sseFallbackTimer = null; }
        if (this._deferTimer) { clearTimeout(this._deferTimer); this._deferTimer = null; }
        // Keep polling alive even with SSE connected: state_changed fires
        // on transitions only (active_gid flip, pause/resume, etc.), NOT
        // on per-tick download progress. Without polling, the queue rows,
        // header throughput, and global timeline stop updating during a
        // steady download — observed live by an operator. The selectable
        // refresh interval (1.5s/3s/5s/10s/30s) is the user's chosen
        // progress-refresh cadence and must keep firing.
      });
      es.addEventListener('state_changed', (e) => {
        markActivity();
        const evt = parseStateChangedEvent(e.data);
        if (evt.kind === 'full') {
          if (evt.isOffline) {
            this._consecutiveFailures++;
            if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
              this.lastStatus = evt.data;
            }
            return;
          }
          this._consecutiveFailures = 0;
          this._lastFreshAt = Date.now();
          if (this._freshnessRouter) {
            try { this._freshnessRouter.markExternalFetch('GET', '/api/status'); } catch (e) { /* ignore */ }
          }
          this.lastStatus = evt.data;
          this.lastRev = evt.data._rev || null;
          this.checkNotifications(this.itemsWithStatus);
          this.recordGlobalSpeed(this.currentSpeed || 0, this.currentUploadSpeed || 0);
        } else if (evt.kind === 'rev' && evt.rev !== this.lastRev) {
          // Lightweight event with just rev — fetch full status
          this.refresh();
        }
      });
      // BG-7: backend pushes individual action log entries in real-time
      es.addEventListener('action_logged', (e) => {
        markActivity();
        const entry = parseActionLoggedEvent(e.data);
        if (entry) {
          this.actionLogEntries = [entry, ...this.actionLogEntries].slice(0, this.logLimit || 120);
        }
      });
      es.onerror = () => {
        this._sseConnected = false;
        this._disarmSseLivenessTimer();
        if (this._sseFallbackTimer) clearTimeout(this._sseFallbackTimer);
        this._sseFallbackTimer = setTimeout(async () => {
          this._sseFallbackTimer = null;
          if (this._sseConnected) return;
          try {
            const r = await this._fetch(this.backendPath('/api/health'), {}, 3000);
            if (r.ok && !this.refreshTimer && this.refreshInterval > 0) {
              this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
            }
          } catch (e) { /* health probe failed — no polling fallback */ }
          // Schedule SSE reconnect with exponential backoff + jitter,
          // regardless of whether health succeeded. EventSource itself
          // also auto-retries internally; this manual path provides
          // bounded, observable behavior on prolonged outages.
          const delay = nextReconnectDelayMs(this._sseReconnectAttempts);
          this._sseReconnectAttempts++;
          this._sseFallbackTimer = setTimeout(() => this._initSSE(), delay);
        }, 2000);
      };
    },
    _closeSSE() {
      if (this._sse) { this._sse.close(); this._sse = null; }
      this._sseConnected = false;
      this._disarmSseLivenessTimer();
    },
    _armSseLivenessTimer() {
      this._disarmSseLivenessTimer();
      this._sseLivenessTimer = setInterval(() => {
        if (!this._sseConnected) return;
        if (isStreamStale(this._sseLastActivityAt, Date.now(), this.SSE_LIVENESS_TIMEOUT_MS)) {
          // TCP open but no events arriving — proxy/middlebox dropped
          // the stream silently. Force a fresh connection.
          this._closeSSE();
          this._initSSE();
        }
      }, this.SSE_LIVENESS_CHECK_MS);
    },
    _disarmSseLivenessTimer() {
      if (this._sseLivenessTimer) {
        clearInterval(this._sseLivenessTimer);
        this._sseLivenessTimer = null;
      }
    },

    // --- refresh ---
    setRefreshInterval(value) {
      this.refreshInterval = Number(value) || 0;
      writeRefreshInterval(this.refreshInterval);
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.refreshInterval > 0) {
        this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
      }
      // Re-subscribe so the router applies the new visibility / cadence
      // (and re-fires onUpdate from cache so the page repopulates).
      this._subscribeTab(this.page);
    },

    _deferTimer: null,
    deferRefresh(delay = 300) {
      if (this._deferTimer) clearTimeout(this._deferTimer);
      this._deferTimer = setTimeout(() => { this._deferTimer = null; this.refresh(); }, delay);
    },

    _consecutiveFailures: 0,
    _lastFreshAt: 0,
    _staleTick: 0,
    _mergedActivityCache: null,
    _mergedActivitySig: '',
    _statusUrl() {
      return buildStatusUrl(this.backendPath('/api/status'), {
        queueFilter: this.queueFilter,
        sessionFilter: this.sessionFilter,
      });
    },
    async refresh() {
      if (this.refreshInFlight) return;
      this.refreshInFlight = true;
      try {
        const r = await this._fetch(this._statusUrl());
        // Stamp the freshness router on every successful fetch — the
        // Dev-tab map should reflect 'we fetched it'.
        if (this._freshnessRouter) {
          try { this._freshnessRouter.markExternalFetch('GET', '/api/status'); } catch (e) { /* ignore */ }
        }
        const data = await r.json();
        // No _rev short-circuit: backend bumps state._rev only on state
        // transitions (active_gid, paused/running, etc.), but item
        // progress (downloadSpeed, completedLength) lives in queueStore
        // and doesn't move _rev. Short-circuiting would freeze the
        // queue rows and the throughput graph during an active download.
        this.lastRev = data?._rev || null;
        if (data?.ok === false || data?.['ariaflow-server']?.reachable === false) {
          this._consecutiveFailures++;
          if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
            this.lastStatus = data;
          }
          this.recordGlobalSpeed(0, 0);
          return;
        }
        const wasFailing = this._consecutiveFailures > 0;
        this._consecutiveFailures = 0;
        this._lastFreshAt = Date.now();
        this.lastStatus = data;
        this.syncSchedulerResultText();
        // Backend just recovered: re-run mDNS discovery so the badge
        // catches up to the live state. Otherwise the operator would
        // see '✗' until the next 60s tick of the periodic discovery.
        if (wasFailing) {
          this.discoverBackends().catch((e) => console.warn(e.message));
        }
        const items = this.itemsWithStatus;
        this.checkNotifications(items);
        this.recordGlobalSpeed(this.currentSpeed || 0, this.currentUploadSpeed || 0);
      } catch (e) {
        this._consecutiveFailures++;
        const message = e && e.message ? e.message : 'connection refused';
        if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
          this.lastStatus = {
            ...(this.lastStatus || {}),
            ok: false,
            'ariaflow-server': {
              ...(this.lastStatus?.['ariaflow-server'] || {}),
              reachable: false,
              error: message,
            },
          };
        }
        this.recordGlobalSpeed(0, 0);
      } finally {
        this.refreshInFlight = false;
        // Backoff: increase polling interval on consecutive failures, reset on recovery
        if (this._consecutiveFailures > 0 && this.refreshTimer && !this._sseConnected) {
          const backoff = Math.min(this.refreshInterval * Math.pow(2, this._consecutiveFailures), 60000);
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), backoff);
          this._inBackoff = true;
          // Pause tab subscriptions — backend is unreachable
          this._unsubscribeTab();
        } else if (this._consecutiveFailures === 0 && this._inBackoff && this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          this._inBackoff = false;
          // Resume tab subscriptions — backend is back
          this._subscribeTab(this.page);
        }
      }
    },

    // --- declaration ---
    getDeclarationPreference(name) {
      const prefs = this.lastDeclaration?.uic?.preferences || [];
      const pref = prefs.find((item) => item.name === name);
      return pref ? pref.value : undefined;
    },
    hasDeclarationPreference(name) {
      const prefs = this.lastDeclaration?.uic?.preferences || [];
      return prefs.some((item) => item.name === name);
    },
    _applyDeclaration(data) {
      // /api/declaration response shape is { ok, declaration, meta }.
      // lastDeclaration must be the *inner* declaration object — the
      // getters read lastDeclaration.uic.preferences directly.
      // saveDeclaration (line below) and _flushPrefQueue (further down)
      // already unwrap with `data.declaration || data`; this used to
      // assign `data` as-is, which silently nulled all prefs after a
      // PATCH triggered the freshness revalidate (~1s after the user
      // change reverted to default values).
      this.lastDeclaration = data?.declaration || data;
      if (data?.ok === false || data?.['ariaflow-server']?.reachable === false) return;
      this.declarationText = JSON.stringify(this.lastDeclaration, null, 2);
    },
    async saveDeclaration() {
      let parsed;
      try { parsed = JSON.parse(this.declarationText); } catch (e) {
        this.resultText = `Invalid JSON: ${e.message}`;
        return;
      }
      const r = await this._fetch(this.backendPath('/api/declaration'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const data = await r.json();
      this.lastDeclaration = data.declaration || data;
      this.resultText = 'Declaration saved';
      this.resultJson = JSON.stringify(data, null, 2);
    },

    // --- preference helpers ---
    _prefQueue: [],
    _prefTimer: null,
    _prefSaving: false,
    _queuePrefChange(name, value, options, rationale, delay = 0) {
      // Queue the change; last write per name wins
      this._prefQueue = this._prefQueue.filter((p) => p.name !== name);
      this._prefQueue.push({ name, value, options, rationale });
      // Immediately update local declaration so getters reflect the new value
      // (prevents :value bindings from reverting on next Alpine render)
      if (this.lastDeclaration?.uic?.preferences) {
        const prefs = this.lastDeclaration.uic.preferences;
        const idx = prefs.findIndex((p) => p.name === name);
        const next = { name, value, options, rationale };
        const updated = [...prefs];
        if (idx >= 0) updated[idx] = next; else updated.push(next);
        this.lastDeclaration = { ...this.lastDeclaration, uic: { ...this.lastDeclaration.uic, preferences: updated } };
      }
      if (this._prefTimer) clearTimeout(this._prefTimer);
      this._prefTimer = setTimeout(() => this._flushPrefQueue(), delay);
    },
    async _flushPrefQueue() {
      if (this._prefSaving || !this._prefQueue.length) return;
      this._prefSaving = true;
      try {
        const changes = [...this._prefQueue];
        this._prefQueue = [];
        const patch = {};
        for (const c of changes) patch[c.name] = c.value;
        const r = await this._fetch(this.backendPath('/api/declaration/preferences'), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        });
        const data = await r.json();
        if (data.declaration) this.lastDeclaration = data.declaration;
      } catch (e) {
        console.warn('Preference save failed:', e.message);
        this.resultText = `Preference save failed: ${e.message}`;
      } finally {
        this._prefSaving = false;
        if (this._prefQueue.length) this._flushPrefQueue();
      }
    },

    // --- bandwidth prefs ---
    setBandwidthPref(name, value, defaultValue) {
      this._queuePrefChange(name, value, [defaultValue], `default ${defaultValue}`, 400);
    },
    setSimultaneousLimit(value) {
      const limit = Math.max(1, parseInt(value, 10) || 1);
      this._queuePrefChange('max_simultaneous_downloads', limit, [1], '1 preserves the sequential default', 400);
    },
    setDuplicateAction(value) {
      this._queuePrefChange('duplicate_active_transfer_action', value, ['remove', 'pause', 'ignore'], 'remove duplicate live jobs by default');
    },
    setAutoPreflightPreference(enabled) {
      this._queuePrefChange('auto_preflight_on_run', !!enabled, [true, false], 'default off');
    },
    setPostActionRule(value) {
      this._queuePrefChange('post_action_rule', value, ['pending'], 'default placeholder');
    },
    // BG-45: self-management toggles persist into declaration.
    // Backend reconciliation hasn't shipped yet — these still write
    // through, the loop will pick them up when it lands.
    setAutoStartAria2(enabled) {
      this._queuePrefChange('auto_start_aria2', !!enabled, [true, false], 'default off until reconciliation ships');
    },
    setAutoUpdate(enabled) {
      this._queuePrefChange('auto_update', !!enabled, [true, false], 'default off — operator opts in');
    },
    setAutoUpdateCheckHours(hours) {
      const n = Number(hours);
      if (!Number.isFinite(n) || n <= 0) return;
      this._queuePrefChange('auto_update_check_hours', n, [24], 'default 24h check interval', 400);
    },
    // Dashboard-local auto-update setters (FE-48). PATCH /api/web/config
    // — same-origin, doesn't go through the backend.
    // Manual "check for update" — runs the package-manager probe without
    // dispatching the upgrade. The auto-update poller already does this
    // automatically every `auto_update_check_hours`; this button is for
    // operators who want to know *now* without waiting for the cycle.
    updateCheckLoading: false,
    updateCheckResult: '',
    updateCheckResultDash: '',
    async checkBackendUpdate() {
      this.updateCheckLoading = true;
      this.updateCheckResult = '';
      try {
        const r = await this._fetch(this.backendPath('/api/lifecycle/ariaflow-server/check_update'), { method: 'POST' });
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.updateCheckResult = data?.message || `Check failed (${r.status})`;
          this._serverUpdateProbe = 'failed';
          return;
        }
        if (data?.update_available) {
          this.updateCheckResult = `Update available: ${data.current_version || '?'} → ${data.latest_version || '?'}`;
          this._serverUpdateProbe = 'available';
          this._serverLatestVersion = String(data.latest_version || '') || null;
        } else {
          this.updateCheckResult = `Up to date (${data?.current_version || '?'})`;
          this._serverUpdateProbe = 'current';
          this._serverLatestVersion = String(data?.current_version || '') || null;
        }
      } catch (e) {
        this.updateCheckResult = `Check failed: ${e.message}`;
        this._serverUpdateProbe = 'failed';
      } finally {
        this.updateCheckLoading = false;
      }
    },
    async checkDashUpdate() {
      this.updateCheckLoading = true;
      this.updateCheckResultDash = '';
      try {
        const r = await this._fetch('/api/web/lifecycle/ariaflow-dashboard/check_update', { method: 'POST' });
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.updateCheckResultDash = data?.message || `Check failed (${r.status})`;
          this._dashUpdateProbe = 'failed';
          return;
        }
        if (data?.update_available) {
          this.updateCheckResultDash = `Update available: ${data.current_version || '?'} → ${data.latest_version || '?'}`;
          this._dashUpdateProbe = 'available';
          this._dashLatestVersion = String(data.latest_version || '') || null;
        } else {
          this.updateCheckResultDash = `Up to date (${data?.current_version || '?'})`;
          this._dashUpdateProbe = 'current';
          this._dashLatestVersion = String(data?.current_version || '') || null;
        }
      } catch (e) {
        this.updateCheckResultDash = `Check failed: ${e.message}`;
        this._dashUpdateProbe = 'failed';
      } finally {
        this.updateCheckLoading = false;
      }
    },
    async setDashAutoUpdate(enabled) {
      await this._patchWebConfig({ auto_update: !!enabled });
    },
    async setDashAutoUpdateCheckHours(hours) {
      const n = Number(hours);
      if (!Number.isFinite(n) || n <= 0) return;
      await this._patchWebConfig({ auto_update_check_hours: Math.max(1, Math.min(720, Math.trunc(n))) });
    },
    async setDashUpdateServerFirst(enabled) {
      await this._patchWebConfig({ update_server_first: !!enabled });
    },
    async setDashAutoRestart(enabled) {
      await this._patchWebConfig({ auto_restart_after_upgrade: !!enabled });
    },
    async _patchWebConfig(updates) {
      try {
        const r = await this._fetch('/api/web/config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        const data = await r.json();
        if (data?.ok) this.webConfig = this._normalizeWebConfig(data);
      } catch (e) {
        this.resultText = `Failed to update dashboard config: ${e.message}`;
      }
    },
    async loadWebConfig() {
      try {
        const r = await this._fetch('/api/web/config');
        const data = await r.json();
        if (data?.ok) this.webConfig = this._normalizeWebConfig(data);
      } catch (e) { /* ignore — defaults already in place */ }
    },
    async loadServerProbe() {
      try {
        const r = await this._fetch('/api/web/lifecycle/ariaflow-server/probe');
        const data = await r.json();
        if (data?.ok) this.serverProbe = data;
      } catch (e) { /* keep null; UI hides CTA */ }
    },
    async confirmUninstallServer() {
      if (!window.confirm('Uninstall ariaflow-server? Your downloads stay on disk; aria2 + the dashboard are untouched. Run this from the terminal if you also want to remove ariaflow-dashboard.')) return;
      // Uninstall is a backend-driven action so the running server can
      // do its own cleanup before brew removes it. lifecycleAction
      // already POSTs to /api/lifecycle/<target>/<action>.
      await this.lifecycleAction('ariaflow-server', 'uninstall');
      // Re-probe shortly to update the install state for the CTA banner.
      setTimeout(() => this.loadServerProbe(), 5_000);
    },
    async installAriaflowServer() {
      try {
        const r = await this._fetch('/api/web/lifecycle/ariaflow-server/install', { method: 'POST' });
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.resultText = data?.message || `Install failed (${r.status})`;
          return;
        }
        this.resultText = 'Installing ariaflow-server… (~30s)';
        // Re-probe in 5s + 30s + 60s to catch the install completing.
        setTimeout(() => this.loadServerProbe(), 5_000);
        setTimeout(() => { this.loadServerProbe(); this.discoverBackends(); }, 30_000);
        setTimeout(() => { this.loadServerProbe(); this.discoverBackends(); }, 60_000);
      } catch (e) {
        this.resultText = `Install failed: ${e.message}`;
      }
    },
    _normalizeWebConfig(data) {
      return {
        auto_update: !!data.auto_update,
        auto_update_check_hours: Number(data.auto_update_check_hours) || 24,
        update_server_first: !!data.update_server_first,
        auto_restart_after_upgrade: data.auto_restart_after_upgrade !== false,
        backend_url: String(data.backend_url || ''),
      };
    },

    // --- actions ---
    async add() {
      const raw = this.urlInput.trim();
      const urls = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const items = urls.map((url) => {
        const item = { url };
        if (this.addOutput.trim()) item.output = this.addOutput.trim();
        if (this.addPriority !== '') item.priority = Number(this.addPriority);
        const mirrors = this.addMirrors.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (mirrors.length) item.mirrors = mirrors;
        if (this.addTorrentData) item.torrent_data = this.addTorrentData;
        if (this.addMetalinkData) item.metalink_data = this.addMetalinkData;
        if (this.addPostActionRule) item.post_action_rule = this.addPostActionRule;
        return item;
      });
      const payload = { items };
      const r = await this._fetch(this.backendPath('/api/downloads'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok || data.ok === false) {
        this.resultText = data.message || 'Add request failed';
        this.resultJson = JSON.stringify(data, null, 2);
        return;
      }
      // Backend returns {ok, items: [{id, url, status, duplicate}, ...]}.
      const added = Array.isArray(data.items) ? data.items : [];
      const queued = added.length;
      this.resultText = queued > 1
        ? `Queued ${queued} items`
        : `Queued: ${added[0]?.url || urls[0] || raw}`;
      this.resultJson = JSON.stringify(data, null, 2);
      // Clear the URL input + aux fields so the operator sees the form
      // reset (= visible feedback that the click landed) and so the
      // 'Add' button hides itself (gated on urlInput.trim()).
      this.urlInput = '';
      this.addOutput = ''; this.addPriority = ''; this.addMirrors = '';
      this.addTorrentData = null; this.addMetalinkData = null; this.addPostActionRule = '';
      // Kick a refresh so the new item shows up in the queue panel
      // immediately, instead of waiting up to 10s for the next poll
      // (SSE usually delivers faster, but don't rely on it).
      this.refresh();
    },
    handleFileUpload(event, type) {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        // Extract base64 portion from data URL
        const base64 = reader.result.split(',')[1] || '';
        if (type === 'torrent') this.addTorrentData = base64;
        else if (type === 'metalink') this.addMetalinkData = base64;
      };
      reader.readAsDataURL(file);
    },
    async toggleScheduler() {
      // Drive dispatch off the same enum the button label reads
      // (schedulerBadgeText → state.scheduler_status). Reading state.running
      // + state.dispatch_paused was a second source of truth that could
      // drift from the label and dispatch the wrong action on click.
      this.schedulerLoading = true;
      try {
        switch (this.schedulerBadgeText) {
          case 'paused': return await this.resumeDownloads();
          case 'idle':
          case 'running': return await this.pauseDownloads();
          default: return await this.schedulerAction('start');
        }
      } finally { this.schedulerLoading = false; }
    },
    async schedulerAction(action) {
      if (action !== 'start' && action !== 'stop') {
        this.resultText = `Unknown scheduler action: ${action}`;
        return;
      }
      // BG-25: explicit /api/scheduler/{start,stop} endpoints.
      const endpoint = `/api/scheduler/${action}`;
      const payload = action === 'start'
        ? { auto_preflight_on_run: this.autoPreflightEnabled }
        : {};
      try {
        const r = await this._fetch(this.backendPath(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await r.json();
        if (!r.ok || data.ok === false) {
          this.resultText = data.message || `Scheduler ${action} failed`;
          this.resultJson = JSON.stringify(data, null, 2);
          return;
        }
        if (action === 'start') {
          this.resultText = data.started ? 'Scheduler started' : 'Scheduler already running';
        } else {
          this.resultText = data.stopped ? 'Scheduler stopped' : 'Scheduler already idle';
        }
        // BG-49: backend returns canonical post-action state envelope.
        // Splat it into lastStatus.state — no optimistic guess needed.
        if (data.state && this.lastStatus) {
          this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, ...data.state } };
        }
        this.resultJson = JSON.stringify(data, null, 2);
      } catch (e) {
        this.resultText = `Scheduler ${action} failed: ${e.message}`;
      }
    },
    async pauseDownloads()  { return this._pauseResume('pause');  },
    async resumeDownloads() { return this._pauseResume('resume'); },
    async _pauseResume(action) {
      const isPause = action === 'pause';
      const verb = isPause ? 'Pause' : 'Resume';
      this.resultText = '';
      try {
        const r = await postEmpty(this.backendPath(urlScheduler(action)));
        const data = await r.json();
        // Backend signals success via `paused: <bool>` for both routes;
        // there is no separate `resumed` field. Success = data.paused
        // matches the requested direction.
        const ok = isPause ? data.paused === true : data.paused === false;
        this.resultText = ok
          ? (isPause ? 'Downloads paused' : 'Downloads resumed')
          : (data.message || (data.reason === 'no_active_transfer' ? `No active transfer to ${action}` : `${verb} failed`));
        this.resultJson = JSON.stringify(data, null, 2);
        // BG-49: backend returns canonical post-action state envelope.
        if (data.state && this.lastStatus) {
          this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, ...data.state } };
        }
      } catch (e) {
        this.resultText = `${verb} failed: ${e.message}`;
      }
    },
    async itemAction(itemId, action) {
      // Snapshot for rollback
      const prevItems = this.lastStatus?.items ? JSON.parse(JSON.stringify(this.lastStatus.items)) : null;
      // Optimistically update item status via reassignment for Alpine reactivity
      const statusMap = { pause: 'paused', resume: 'queued', retry: 'queued' };
      if (this.lastStatus?.items && statusMap[action]) {
        this.lastStatus = { ...this.lastStatus, items: this.lastStatus.items.map((i) => i.id === itemId ? { ...i, status: statusMap[action] } : i) };
      }
      if (action === 'remove' && this.lastStatus?.items) {
        this.lastStatus = { ...this.lastStatus, items: this.lastStatus.items.filter((i) => i.id !== itemId) };
      }
      let r, data;
      try {
        // Backend uses DELETE /api/downloads/:id for remove, not
        // POST /api/downloads/:id/remove (which 404s).
        if (action === 'remove') {
          r = await postEmpty(this.backendPath(`/api/downloads/${encodeURIComponent(itemId)}`), { method: 'DELETE' });
        } else {
          r = await postEmpty(this.backendPath(urlItemAction(itemId, action)));
        }
        data = await r.json();
      } catch (e) {
        this.resultText = `${action} failed: ${e.message}`;
        if (prevItems && this.lastStatus) this.lastStatus = { ...this.lastStatus, items: prevItems };
        return;
      }
      if (!r.ok || data.ok === false) {
        this.resultText = data.message || `${action} failed`;
        this.resultJson = JSON.stringify(data, null, 2);
        if (prevItems && this.lastStatus) this.lastStatus = { ...this.lastStatus, items: prevItems };
        return;
      }
      this.resultText = `Item ${action} done`;
      this.resultJson = JSON.stringify(data, null, 2);
    },

    // --- file selection ---
    async openFileSelection(itemId) {
      this.fileSelectionItemId = itemId;
      this.fileSelectionLoading = true;
      try {
        const r = await this._fetch(this.backendPath(urlItemFiles(itemId)));
        const data = await r.json();
        this.fileSelectionFiles = normalizeFiles(data.files);
      } catch (e) {
        this.fileSelectionFiles = [];
      }
      this.fileSelectionLoading = false;
    },
    async saveFileSelection() {
      const selected = selectedFileIndexes(this.fileSelectionFiles);
      try {
        const r = await this._fetch(this.backendPath(urlItemFiles(this.fileSelectionItemId)), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ select: selected }),
        });
        await r.json().catch(() => null);
      } finally {
        this.fileSelectionItemId = null;
        this.fileSelectionFiles = [];
      }
    },
    closeFileSelection() {
      this.fileSelectionItemId = null;
      this.fileSelectionFiles = [];
    },

    // --- archive & cleanup ---
    loadMoreArchive() {
      this.archiveLimit += 100;
      // Re-subscribe with new params: the router treats a params change
      // as a cache invalidation and refetches.
      this._subscribeTab('archive');
    },
    // BG-56: folder operations within download_dir.
    async renameFile(path, currentName) {
      const next = (window.prompt(`Rename "${currentName}" to:`, currentName) || '').trim();
      if (!next || next === currentName) return;
      await this._filesPost('/api/files/rename', { path, new_name: next }, 'rename');
    },
    async moveFile(path, currentName) {
      const subdir = (window.prompt(`Move "${currentName}" to subdirectory (relative to download dir):`, '') || '').trim();
      if (!subdir) return;
      await this._filesPost('/api/files/move', { path, new_subdir: subdir }, 'move');
    },
    async deleteFile(path, name, isDirectory) {
      if (!window.confirm(`Delete "${name}" from disk? This cannot be undone.`)) return;
      try {
        const body = isDirectory ? { path, recursive: true } : { path };
        const r = await this._fetch(this.backendPath('/api/files'), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = r.status === 204 ? { ok: true } : await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.resultText = data?.message || 'Delete failed';
          return;
        }
        this.resultText = `Deleted ${name}`;
        this._subscribeTab('archive');
      } catch (e) {
        this.resultText = `Delete failed: ${e.message}`;
      }
    },
    async _filesPost(endpoint, body, verb) {
      try {
        const r = await this._fetch(this.backendPath(endpoint), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.resultText = data?.message || `${verb} failed`;
          return;
        }
        this.resultText = `${verb.charAt(0).toUpperCase() + verb.slice(1)} succeeded`;
        this._subscribeTab('archive');
      } catch (e) {
        this.resultText = `${verb} failed: ${e.message}`;
      }
    },
    async runCleanRecipe() {
      const f = this.cleanForm;
      let body = {};
      if (f.recipe === 'complete_older_than') body = { status: 'complete', older_than_days: Number(f.older_than_days) || 30 };
      else if (f.recipe === 'errors')         body = { status: 'error' };
      else if (f.recipe === 'orphaned')       body = { orphaned: true };
      this.cleanModalOpen = false;
      await this._filesPost('/api/files/clean', body, 'clean');
    },
    openCleanModal() { this.cleanModalOpen = true; },
    closeCleanModal() { this.cleanModalOpen = false; },
    get filesTotalSize() {
      return (this.filesData || []).reduce((sum, f) => sum + (Number(f.size) || 0), 0);
    },
    // FE-52: mismatch detection between aria2's runtime dir and the
    // operator's declared download_dir. Both must be set (truthy) for
    // a real comparison; null/empty on either side means we don't
    // know yet (data still loading) — suppress the banner.
    get aria2RuntimeDir() { return String(this.aria2Options?.dir || '').trim(); },
    get declaredDownloadDir() { return String(this.getDeclarationPreference('download_dir') || '').trim(); },
    get dirMismatch() {
      const a = this.aria2RuntimeDir;
      const d = this.declaredDownloadDir;
      return a && d && a !== d;
    },
    async useAria2DirAsDownloadDir() {
      const target = this.aria2RuntimeDir;
      if (!target) return;
      this._queuePrefChange('download_dir', target, [''], 'sync to aria2 dir', 0);
      this._subscribeTab('archive');
    },
    async useDownloadDirForAria2() {
      const target = this.declaredDownloadDir;
      if (!target) return;
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/change_global_option'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: target }),
        });
        const data = await r.json().catch(() => null);
        if (!r.ok || data?.ok === false) {
          this.resultText = data?.message || 'Failed to update aria2 dir';
          return;
        }
        this.resultText = `aria2 dir set to ${target}`;
        this._subscribeTab('archive');
      } catch (e) {
        this.resultText = `Failed to update aria2 dir: ${e.message}`;
      }
    },
    get filesRows() {
      // Three row states: on-disk+history / on-disk+orphan / not-on-disk+history.
      // First two come from filesData (filesystem-first). Third is derived
      // from archiveItems whose output_path is missing from filesData.
      const files = this.filesData || [];
      const filePaths = new Set(files.map((f) => f.path).filter(Boolean));
      const rows = files.map((f) => ({
        kind: f.history_match ? 'on_disk_history' : 'on_disk_orphan',
        file: f,
        history: f.history_match || null,
      }));
      for (const item of (this.archiveItems || [])) {
        const p = item.output_path;
        if (p && !filePaths.has(p)) {
          rows.push({ kind: 'history_missing_disk', file: null, history: item });
        }
      }
      return rows;
    },
    async cleanup() {
      this.archiveLoading = true;
      try {
        const r = await this._fetch(this.backendPath('/api/downloads/cleanup'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ max_done_age_days: 7, max_done_count: 100 }),
        });
        const data = await r.json();
        this.resultText = data.ok ? `Cleanup complete — ${data.archived || 0} archived` : (data.message || 'Cleanup requested');
        this.resultJson = JSON.stringify(data, null, 2);
      } finally { this.archiveLoading = false; }
    },

    // --- bandwidth ---
    probeLoading: false,
    async runProbe() {
      this.probeLoading = true;
      this.resultText = 'Probe running...';
      try {
        const r = await postEmpty(this.backendPath('/api/bandwidth/probe'));
        const data = await r.json();
        this.resultText = data.ok ? 'Probe complete' : (data.message || 'Probe finished');
        this.resultJson = JSON.stringify(data, null, 2);
        // Router refetches /api/bandwidth automatically via revalidate_on
        // (BG-31: POST /api/bandwidth/probe triggers it).
      } catch (e) {
        this.resultText = `Probe failed: ${e.message}`;
      } finally {
        this.probeLoading = false;
      }
    },
    _applyBandwidth(data) {
      if (data && data.ok !== false) {
        this.lastStatus = { ...(this.lastStatus || {}), bandwidth: data };
      }
    },

    // --- lifecycle ---
    _applyLifecycle(data) {
      this.lastLifecycle = data;
      if (data?.ok === false || data?.['ariaflow-server']?.reachable === false) {
        this.lifecycleRows = [];
        return;
      }
      // BG-44 phase 2 (FE consolidation): the standalone aria2-launchd
      // row collapses into a sub-block on the aria2 row, driven by
      // aria2.result.auto_start = {installed, target, path}. The
      // backend still emits the standalone row for one deprecation
      // cycle; we ignore it here. Actions still target 'aria2-launchd'
      // until backend phase 3 retires that route.
      this.lifecycleRows = [
        {
          name: 'ariaflow-server',
          record: data['ariaflow-server'],
          actions: lifecycleActionsFor('ariaflow-server', data['ariaflow-server']),
        },
        { name: 'aria2', record: data.aria2, actions: lifecycleActionsFor('aria2', data.aria2) },
        { name: 'networkquality', record: data.networkquality, actions: [] },
      ];
      this._lifecycleSession = data?.session_id ? data : null;
    },
    _applyWebLifecycle(data) {
      const r = data?.result || {};
      this.webManagedBy = r.managed_by ?? null;
      this.webInstalledVia = r.installed_via ?? null;
      if (r.pid) this.webPidText = String(r.pid);
    },
    async webLifecycleAction(action) {
      if (!['restart', 'update'].includes(action)) return;
      try {
        const r = await this._fetch(`/api/web/lifecycle/ariaflow-dashboard/${action}`, { method: 'POST' });
        const data = await r.json();
        if (!r.ok || data.ok === false) {
          this.resultText = data.message || `Dashboard ${action} failed: ${data.error || r.status}`;
        } else {
          this.resultText = `Dashboard ${action} requested — ${action === 'restart' ? 'reconnecting…' : 'update running detached'}`;
        }
      } catch (e) {
        this.resultText = `Dashboard ${action} failed: ${e.message}`;
      }
    },
    async loadLifecycle() {
      try {
        const r = await this._fetch(this.backendPath('/api/lifecycle'));
        this._applyLifecycle(await r.json());
      } catch (e) {
        this.lifecycleRows = [];
      }
    },
    // True if a lifecycle row is in a healthy state — checks the BG-27
    // three axes (installed / current / running, with expected_running
    // from BG-29 modulating the running check).
    lifecycleHealthy(row) {
      // aria2-launchd is optional plumbing — treat as healthy regardless
      // so the Service Status nav badge doesn't false-positive on a
      // perfectly normal "no auto-start configured" install.
      if (row?.name?.includes('aria2 auto-start')) return true;
      return isLifecycleHealthy(row?.record);
    },
    get lifecycleErrorCount() {
      return (this.lifecycleRows || []).filter((r) => !this.lifecycleHealthy(r)).length;
    },
    lifecycleStateLabel(name, record) {
      return describeLifecycleStatus(name, record);
    },
    // Mirror describeLifecycleStatus for the dashboard's own row, which
    // doesn't have a backend lifecycle record. Honest about state: only
    // claim "current" when we've actually verified it via a check probe
    // (manual or auto). Default is plain "running" with the axes
    // suffix; "update available" overrides; "current" only after a
    // successful probe with update_available === false.
    get webStateLabel() {
      const parts = [this.webManagedBy, this.webInstalledVia].filter(Boolean);
      const suffix = parts.length ? ` (${parts.join(' · ')})` : '';
      const r = this._dashUpdateProbe;
      if (r === 'available') return `update available${suffix}`;
      if (r === 'current') return `running · current${suffix}`;
      return `running${suffix}`;
    },
    // Tracked verdict from the most recent dashboard self check_update
    // probe. null = never checked; 'current' / 'available' / 'failed'.
    _dashUpdateProbe: null,
    _dashLatestVersion: null,
    // Mirror for the server row. Overrides the BACKEND's lifecycle.
    // result.current claim when the FE-side Check probe just found
    // a newer version — operator was watching the click, the pill
    // should agree with what they just saw.
    _serverUpdateProbe: null,    // 'current' | 'available' | 'failed' | null
    _serverLatestVersion: null,  // 'X.Y.Z' when probe knows it
    lifecycleBadgeClass(record) {
      return lifecycleBadgeClass(record);
    },
    lifecycleItemOutcome(record) {
      return record?.result?.outcome || 'unknown';
    },
    lifecycleItemLines(record) {
      return lifecycleDetailLines(record).join(' · ');
    },
    async lifecycleAction(target, action) {
      try {
        const r = await postEmpty(this.backendPath(urlLifecycleAction(target, action)));
        const data = await r.json();
        this.lastLifecycle = data.lifecycle || data;
        this.resultText = `${target} ${action} requested`;
        this.resultJson = JSON.stringify(data, null, 2);
        await this.loadLifecycle();
      } catch (e) {
        this.resultText = `${target} ${action} failed: ${e.message}`;
      }
    },

    // --- log ---
    async preflightRun() {
      this.preflightLoading = true;
      try {
        const r = await postEmpty(this.backendPath(urlScheduler('preflight')));
        const data = await r.json();
        this.resultText = data.status === 'pass' ? 'Preflight passed' : 'Preflight needs attention';
        this.resultJson = JSON.stringify(data, null, 2);
        this.preflightData = data;
      } catch (e) {
        this.resultText = `Preflight failed: ${e.message}`;
      } finally {
        this.preflightLoading = false;
      }
    },
    async uccRun() {
      this.uccLoading = true;
      try {
        // Prefer /ucc during the BG-48 deprecation window: it works on
        // every backend version, while /contract only exists on bottles
        // that shipped BG-48. Falling back the other way logged spurious
        // 404s in the backend action log. Flip back to /contract-first
        // once /ucc is removed upstream.
        let r = await postEmpty(this.backendPath('/api/scheduler/ucc'));
        if (r.status === 404) {
          r = await postEmpty(this.backendPath(urlScheduler('contract')));
        }
        const data = await r.json();
        const outcome = data.result?.outcome || 'unknown';
        this.resultText = `UCC result: ${outcome}`;
        this.resultJson = JSON.stringify(data, null, 2);
        this.contractTraceItems = data;
        this.refreshActionLog();
      } catch (e) {
        this.resultText = `UCC failed: ${e.message}`;
      } finally {
        this.uccLoading = false;
      }
    },
    contractTraceOutcome() {
      return this.contractTraceItems?.result?.outcome || 'unknown';
    },

    async refreshActionLog() {
      if (this.page !== 'log') return;
      try {
        const r = await this._fetch(this.backendPath(`/api/log?limit=${this.logLimit}`));
        const data = await r.json();
        if (data?.ok === false || data?.['ariaflow-server']?.reachable === false) {
          this.actionLogEntries = [];
          return;
        }
        this.actionLogEntries = data.items || [];
        // Reset stale filters if selected value no longer exists
        if (this.actionFilter !== 'all' && !this.availableActions.includes(this.actionFilter)) this.actionFilter = 'all';
        if (this.targetFilter !== 'all' && !this.availableTargets.includes(this.targetFilter)) this.targetFilter = 'all';
      } catch (e) {
        this.actionLogEntries = [];
      }
    },
    _applyWebLog(data) {
      this.webLogEntries = data?.items || [];
    },
    get availableActions() {
      return distinctActions(this.mergedActivity);
    },
    get availableTargets() {
      return distinctTargets(this.mergedActivity);
    },
    // Activity panel: backend's /api/log + dashboard's /api/web/log
    // merged into one chronological timeline. Each row carries _source
    // ('server' | 'dashboard') so the UI can badge it. Filters apply
    // to the merged list; the new sourceFilter narrows by origin.
    get mergedActivity() {
      // Memoize on entry-count signature: action log entries are append-only
      // from the FE's perspective (new entries arrive via SSE / refresh,
      // existing rows aren't mutated in place), so length+length is a safe
      // cache key. Saves the spread + sort on every Alpine getter read.
      const sig = `${this.actionLogEntries.length}|${this.webLogEntries.length}`;
      if (this._mergedActivityCache && this._mergedActivitySig === sig) {
        return this._mergedActivityCache;
      }
      const tagged = [
        ...this.actionLogEntries.map((e) => ({ ...e, _source: 'server' })),
        ...this.webLogEntries.map((e) => ({ ...e, _source: 'dashboard' })),
      ];
      tagged.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      this._mergedActivityCache = tagged;
      this._mergedActivitySig = sig;
      return tagged;
    },
    get filteredActionLog() {
      const currentSessionId =
        this.state?.session_id ||
        this.lastLifecycle?.session_id ||
        this.lastDeclaration?.session_id ||
        null;
      const filtered = filterActionLog(this.mergedActivity, {
        actionFilter: this.actionFilter,
        targetFilter: this.targetFilter,
        sessionFilter: this.sessionFilter,
        currentSessionId,
      });
      if (this.sourceFilter === 'all') return filtered;
      return filtered.filter((e) => e._source === this.sourceFilter);
    },
    sanitizeLogValue(value, depth = 0) {
      if (value == null) return value;
      if (depth >= 2) return '[trimmed]';
      if (Array.isArray(value)) {
        if (!value.length) return [];
        if (value.length > 4) return [`[${value.length} items]`];
        return value.map((item) => this.sanitizeLogValue(item, depth + 1));
      }
      if (typeof value !== 'object') return value;
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'bitfield') { result[key] = '[trimmed]'; continue; }
        if (key === 'files') { const f = Array.isArray(entry) ? entry.length : 0; result[key] = `[${f} file${f === 1 ? '' : 's'}]`; continue; }
        if (key === 'uris') { const u = Array.isArray(entry) ? entry.length : 0; result[key] = `[${u} uri${u === 1 ? '' : 's'}]`; continue; }
        result[key] = this.sanitizeLogValue(entry, depth + 1);
      }
      return result;
    },
    summarizePollEntry(entry) {
      const detail = entry?.detail || {};
      const status = detail.status || entry?.outcome || 'unknown';
      const done = detail.completedLength ? this.formatBytes(detail.completedLength) : null;
      const total = detail.totalLength ? this.formatBytes(detail.totalLength) : null;
      const speed = detail.downloadSpeed ? this.formatRate(detail.downloadSpeed) : null;
      const target = this.shortName(detail.url || detail.gid || '-');
      const parts = [target];
      if (done && total) parts.push(`${done}/${total}`);
      if (speed) parts.push(speed);
      return parts.join(' · ');
    },
    // Trailing detail phrase appended to the row's "action target" line.
    // Suppress redundant detail: when the message/reason just repeats
    // the outcome ("converged · queue · converged"), we don't need to
    // print it twice. Same when it repeats action or target.
    logEntryDetail(entry) {
      if (entry.action === 'poll') {
        const summary = this.summarizePollEntry(entry);
        return entry._pollCount > 1 ? `${summary} (${entry._pollCount} polls)` : summary;
      }
      const detail = (entry.message || entry.reason || '').trim();
      if (!detail) return '';
      const dups = [entry.outcome, entry.status, entry.action, entry.target]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      if (dups.includes(detail.toLowerCase())) return '';
      return detail;
    },

    // --- per-item aria2 options ---
    async loadItemOptions(gid) {
      if (!gid) return;
      if (this.itemOptionsGid === gid) { this.itemOptionsGid = null; this.itemOptionsData = null; return; }
      this.itemOptionsGid = gid;
      this.itemOptionsData = null;
      try {
        const r = await this._fetch(this.backendPath(urlAria2GetOption(gid)));
        this.itemOptionsData = await r.json();
      } catch (e) {
        this.itemOptionsData = { error: e.message };
      }
    },

    // --- session history ---

    // --- aria2 options ---
    _applyAria2GlobalOption(data) {
      if (data && data.ok !== false) this.aria2Options = data;
    },
    _applyAria2OptionTiers(data) {
      if (data && !data.error) this.aria2Tiers = data;
    },
    async loadAria2Options() {
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/global_option'));
        this._applyAria2GlobalOption(await r.json());
      } catch (e) {
        this.aria2Options = {};
      }
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/option_tiers'));
        this._applyAria2OptionTiers(await r.json());
      } catch (e) { console.warn('loadAria2Tiers:', e.message); }
    },
    get aria2UnsafeEnabled() { return !!this.getDeclarationPreference('aria2_unsafe_options'); },
    // numeric preference getters (using _numPref helper)
    // retry preferences
    get maxRetries() { return this._numPref('max_retries', 3); },
    get retryBackoff() { return this._numPref('retry_backoff_seconds', 30); },
    get aria2MaxTries() { return this._numPref('aria2_max_tries', 5); },
    get aria2RetryWait() { return this._numPref('aria2_retry_wait', 3); },
    // distribution preferences
    get distributeEnabled() { return !!this.getDeclarationPreference('distribute_completed_downloads'); },
    get distributeSeedRatio() { return this._numPref('distribute_seed_ratio', 1.0); },
    get distributeMaxSeedHours() { return this._numPref('distribute_max_seed_hours', 24); },
    get distributeMaxActiveSeeds() { return this._numPref('distribute_max_active_seeds', 3); },
    get internalTrackerUrl() { return this.getDeclarationPreference('internal_tracker_url') || ''; },
    setAria2UnsafeOptions(enabled) {
      this._queuePrefChange('aria2_unsafe_options', !!enabled, [false, true], 'allow setting any aria2 option via API');
    },
    setRetryPref(name, value) {
      this._queuePrefChange(name, Number(value), [], `retry preference`, 400);
    },
    setDistributePref(name, value) {
      this._queuePrefChange(name, typeof value === 'boolean' ? value : value, [], `distribution preference`, 400);
    },
    _aria2OptTimer: null,
    setAria2Option(key, value) {
      const v = String(value).trim();
      if (!v) return;
      if (this._aria2OptTimer) clearTimeout(this._aria2OptTimer);
      this._aria2OptTimer = setTimeout(() => this._sendAria2Option(key, v), 400);
    },
    async _sendAria2Option(key, value) {
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/change_global_option'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [key]: value }),
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? `${key} = ${value}` : (data.message || 'Failed');
        if (data.ok !== false) this.loadAria2Options();
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },

    // --- per-item aria2 option editing ---
    async setItemAria2Option(gid, key, value) {
      if (!gid || !key) return;
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/change_option'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gid, [key]: String(value) }),
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? `${key} = ${value} (gid ${gid})` : (data.message || 'Failed');
        if (data.ok !== false) this.loadItemOptions(gid);
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },

    // --- aria2 set_limits ---
    async setAria2Limits(limits) {
      try {
        const r = await this._fetch(this.backendPath('/api/aria2/set_limits'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(limits),
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? 'Limits applied' : (data.message || 'Failed');
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },

    // --- torrents ---
    _applyPeers(data) {
      this.peerList = data?.peers || [];
    },
    _applyTorrents(data) {
      this.torrentList = data?.torrents || [];
    },
    async loadTorrents() {
      this.torrentLoading = true;
      try {
        const r = await this._fetch(this.backendPath('/api/torrents'));
        this._applyTorrents(await r.json());
      } catch (e) {
        this.torrentList = [];
      } finally {
        this.torrentLoading = false;
      }
    },
    async stopTorrent(infohash) {
      try {
        const r = await postEmpty(this.backendPath(urlTorrentStop(infohash)));
        const data = await r.json();
        this.resultText = data.ok !== false ? `Stopped seeding ${infohash.slice(0, 8)}` : (data.message || 'Stop failed');
        await this.loadTorrents();
      } catch (e) {
        this.resultText = `Stop failed: ${e.message}`;
      }
    },

    // --- dev ---
    openDocs() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/docs`, '_blank');
    },
    openSpec() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/openapi.yaml`, '_blank');
    },
    async loadSpecVersion() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) { this.specVersion = null; return; }
      try {
        const r = await this._fetch(`${url}/api/openapi.yaml`);
        if (!r.ok) { this.specVersion = null; return; }
        const text = await r.text();
        const m = text.match(/^\s{0,4}version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
        this.specVersion = m ? m[1] : null;
      } catch {
        this.specVersion = null;
      }
    },
    get specVersionMismatch() {
      const runtime = this.lastStatus?.['ariaflow-server']?.version;
      return !!(this.specVersion && runtime && this.specVersion !== runtime);
    },
    async runTests() {
      this.testSummaryVisible = true;
      this.testBadgeText = 'running...';
      this.testBadgeClass = 'badge';
      this.testCountsText = 'Running test suite...';
      this.testResults = [];
      this.testLoading = true;
      try {
        const r = await this._fetch(`${this.backendBaseUrl()}/api/tests`);
        const data = await r.json();
        const passed = data.passed ?? 0;
        const failed = data.failed ?? 0;
        const errors = data.errors ?? 0;
        const total = data.total ?? (passed + failed + errors);
        const ok = failed === 0 && errors === 0 && total > 0;
        this.testBadgeText = total === 0 ? 'no tests' : ok ? 'pass' : 'fail';
        this.testBadgeClass = total === 0 ? 'badge warn' : ok ? 'badge good' : 'badge bad';
        this.testCountsText = total === 0
          ? 'No tests found — backend may be running from a packaged install without test files'
          : `${passed} passed, ${failed} failed, ${errors} errors — ${total} total`;
        this.testResults = data.tests || data.results || [];
        this.lastTestStdout = data.stdout || '';
        this.lastTestStderr = data.stderr || '';
        if (!this.testResults.length) {
          this.testResults = [{ name: total === 0 ? 'No test files available.' : ok ? 'All tests passed.' : 'No test details available.', _placeholder: true }];
        }
      } catch (err) {
        this.testBadgeText = 'error';
        this.testBadgeClass = 'badge bad';
        this.testCountsText = `Failed to reach backend: ${err.message}`;
        this.testResults = [];
      }
      this.testLoading = false;
    },
  }));
});
