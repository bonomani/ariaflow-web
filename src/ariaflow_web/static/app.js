document.addEventListener('alpine:init', () => {
  Alpine.data('ariaflow', () => ({
    // --- state ---
    lastStatus: null,
    lastLifecycle: null,
    lastResult: null,
    lastDeclaration: null,
    refreshTimer: null,
    refreshInterval: 10000,
    _sse: null,
    _sseConnected: false,
    _sseFallbackTimer: null,
    _inBackoff: false,
    queueFilter: 'all',
    queueSearch: '',
    speedHistory: {},
    SPEED_HISTORY_MAX: 30,
    globalSpeedHistory: [],
    GLOBAL_SPEED_MAX: 40,
    previousItemStatuses: {},
    refreshInFlight: false,
    lastRev: null,
    page: 'dashboard',
    DEFAULT_BACKEND_URL: window.__ARIAFLOW_BACKEND_URL__ || 'http://127.0.0.1:8000',
    backendInput: '',
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
    fileSelectionItemId: null,
    fileSelectionFiles: [],
    fileSelectionLoading: false,
    archiveItems: [],

    // cached backend state (updated on save, avoids localStorage parse per render)
    _cachedBackends: null,
    _cachedSelectedBackend: null,
    get backends() { if (this._cachedBackends === null) { const s = this.loadBackendState(); this._cachedBackends = s.backends; this._cachedSelectedBackend = s.selected; } return this._cachedBackends; },
    get selectedBackend() { if (this._cachedSelectedBackend === null) { const s = this.loadBackendState(); this._cachedBackends = s.backends; this._cachedSelectedBackend = s.selected; } return this._cachedSelectedBackend; },
    get state() { return this.lastStatus?.state || {}; },
    get active() { return this.lastStatus?.active || null; },
    get actives() {
      return Array.isArray(this.lastStatus?.actives) ? this.lastStatus.actives : (this.lastStatus?.active ? [this.lastStatus.active] : []);
    },
    get currentTransfer() { return this.activeTransfer(this.actives, this.active, this.state); },
    get currentSpeed() { return this.currentTransfer?.downloadSpeed || this.active?.downloadSpeed || this.state?.download_speed || null; },
    get itemsWithStatus() {
      return this.annotateQueueItems(this.lastStatus?.items || [], this.actives, this.state);
    },
    get filteredItems() { return this.filterQueueItems(this.itemsWithStatus); },
    get backendReachable() {
      if (!this.lastStatus) return true;
      return this.lastStatus?.ok !== false && this.lastStatus?.ariaflow?.reachable !== false;
    },
    get filterCounts() {
      // Use backend summary when available (avoids client-side recount)
      const s = this.lastStatus?.summary;
      if (s && !this.queueSearch) {
        return {
          all: s.total || 0,
          queued: s.queued || 0,
          waiting: s.waiting || 0,
          discovering: s.discovering || 0,
          downloading: (s.active || 0) + (s.downloading || 0),
          paused: s.paused || 0,
          stopped: s.stopped || 0,
          done: (s.complete || 0) + (s.done || 0),
          error: (s.error || 0) + (s.failed || 0),
          cancelled: s.cancelled || 0,
        };
      }
      // Fallback: count from items (needed when search is active)
      const items = this.itemsWithStatus;
      const counts = { all: items.length, queued: 0, waiting: 0, discovering: 0, downloading: 0, paused: 0, stopped: 0, done: 0, error: 0, cancelled: 0 };
      items.forEach((item) => {
        const status = ((item.status || 'unknown') === 'recovered' ? 'paused' : (item.status || 'unknown')).toLowerCase();
        if (status === 'queued') counts.queued++;
        else if (status === 'waiting') counts.waiting++;
        else if (status === 'discovering') counts.discovering++;
        else if (['downloading', 'active'].includes(status)) counts.downloading++;
        else if (status === 'paused') counts.paused++;
        else if (status === 'stopped') counts.stopped++;
        else if (['done', 'complete'].includes(status)) counts.done++;
        else if (['error', 'failed'].includes(status)) counts.error++;
        else if (status === 'cancelled') counts.cancelled++;
      });
      return counts;
    },
    get schedulerStateLabelText() {
      return this.schedulerOverviewLabel(this.state, this.itemsWithStatus, this.currentTransfer);
    },
    get schedulerDetailText() {
      if (!this.backendReachable) return 'Backend unavailable';
      if (this.state?.paused) return 'Downloads paused';
      if (this.state?.running) return 'Scheduler running';
      return 'Scheduler idle';
    },
    get activeTransferText() {
      if (!this.backendReachable) return 'none';
      return this.summarizeActiveItem(this.currentTransfer, this.state, this.itemsWithStatus);
    },
    get transferSpeedText() {
      if (!this.backendReachable) return 'idle';
      return this.currentSpeed ? this.formatRate(this.currentSpeed) : 'idle';
    },
    get sessionStateLabelText() {
      if (!this.backendReachable) return 'offline';
      return this.sessionStateLabel(this.state);
    },
    get sessionDetailText() {
      if (!this.backendReachable) return '-';
      return this.sessionLabel(this.state);
    },
    get sessionStartedText() {
      if (!this.backendReachable) return '-';
      return this.timestampLabel(this.state.session_started_at);
    },
    get sessionLastSeenText() {
      if (!this.backendReachable) return '-';
      return this.timestampLabel(this.state.session_last_seen_at);
    },
    get sessionClosedText() {
      if (!this.backendReachable) return '-';
      return this.state.session_closed_at
        ? `${this.state.session_closed_at}${this.state.session_closed_reason ? ` · ${this.state.session_closed_reason}` : ''}`
        : '-';
    },
    get schedulerBtnText() {
      if (!this.backendReachable) return 'Start';
      if (this.state?.stop_requested) return 'Stopping...';
      if (this.state?.paused) return 'Resume';
      if (this.state?.running) return 'Pause';
      return 'Start';
    },
    get schedulerBtnDisabled() {
      return !this.backendReachable || !!this.state?.stop_requested;
    },
    get downloadToggleBtnText() {
      if (!this.backendReachable) return 'Pause downloads';
      return this.state?.paused ? 'Resume downloads' : 'Pause downloads';
    },
    get backendVersionText() {
      if (!this.backendReachable) return '-';
      return this.lastStatus?.ariaflow?.version || 'unreported';
    },
    get backendPidText() {
      if (!this.backendReachable) return '-';
      return this.lastStatus?.ariaflow?.pid || 'unreported';
    },
    get schedulerStatusText() {
      if (!this.backendReachable) return 'offline';
      return this.schedulerStateLabel(this.state);
    },
    get preflightModeText() {
      return this.getDeclarationPreference('auto_preflight_on_run') ? 'auto-check' : 'manual';
    },
    get downloadCapText() {
      if (!this.backendReachable) return '-';
      const bw = this.lastStatus?.bandwidth;
      return bw?.cap_mbps ? this.humanCap(this.formatMbps(bw.cap_mbps)) : this.humanCap(bw?.limit || '-');
    },
    get lastErrorText() {
      if (!this.backendReachable) return this.lastStatus?.ariaflow?.error || 'connection refused';
      return this.state.last_error || this.lastStatus?.bandwidth?.reason || 'none';
    },
    get sessionIdText() {
      if (!this.backendReachable) return '-';
      return this.sessionLabel(this.state);
    },
    get sumQueued() { return this.lastStatus?.summary?.queued ?? 0; },
    get sumDone() { return this.lastStatus?.summary?.done ?? 0; },
    get sumError() { return this.lastStatus?.summary?.error ?? 0; },

    // bandwidth panel getters
    get bw() { return this.lastStatus?.bandwidth || {}; },
    get bwInterfaceText() {
      if (!this.backendReachable) return 'offline';
      return this.bw.interface_name || 'unknown';
    },
    get bwInterfaceDetailText() {
      if (!this.backendReachable) return this._offlineStatusLabel();
      return this.bw.interface_name ? `Active network interface: ${this.bw.interface_name}` : 'Interface not detected';
    },
    get bwSourceText() {
      if (!this.backendReachable) return 'offline';
      return this.bw.source || '-';
    },
    get bwDownText() {
      if (!this.backendReachable) return this._offlineStatusLabel();
      return this.bw.source === 'networkquality'
        ? `Downlink ${this.formatMbps(this.bw.downlink_mbps)}${this.bw.partial ? ' (partial)' : ''}`
        : `No probe available${this.bw.reason ? ` · ${this.bw.reason}` : ''}`;
    },
    get bwDownBadgeText() {
      if (!this.backendReachable) return '-';
      return this.bw.downlink_mbps ? this.formatMbps(this.bw.downlink_mbps) : '-';
    },
    get bwDownDetailText() {
      if (!this.backendReachable) return this._offlineStatusLabel();
      return this.bw.downlink_mbps
        ? `Measured downlink: ${this.formatMbps(this.bw.downlink_mbps)}${this.bw.partial ? ' (partial capture)' : ''}`
        : 'No downlink measurement available';
    },
    get bwUpBadgeText() {
      if (!this.backendReachable) return '-';
      return this.bw.uplink_mbps ? this.formatMbps(this.bw.uplink_mbps) : '-';
    },
    get bwUpDetailText() {
      if (!this.backendReachable) return this._offlineStatusLabel();
      return this.bw.uplink_mbps
        ? `Measured uplink: ${this.formatMbps(this.bw.uplink_mbps)}`
        : 'No uplink measurement available';
    },
    get bwCapText() {
      if (!this.backendReachable) return '-';
      return this.bw.cap_mbps ? this.humanCap(this.formatMbps(this.bw.cap_mbps)) : this.humanCap(this.bw.limit || '-');
    },
    get bwGlobalText() {
      if (!this.backendReachable) return 'Configured limit unavailable';
      return `Configured limit ${this.humanCap(this.bw.limit || '-')}`;
    },
    get bwProbeModeText() {
      if (!this.backendReachable) return '-';
      return this.bw.source || '-';
    },
    get bwProbeDetailText() {
      if (!this.backendReachable) return this._offlineStatusLabel();
      return this.bw.source === 'networkquality'
        ? `Measured ${this.formatMbps(this.bw.downlink_mbps)} down${this.bw.uplink_mbps ? `, ${this.formatMbps(this.bw.uplink_mbps)} up` : ''}, capped at ${this.formatMbps(this.bw.cap_mbps)}${this.bw.partial ? ' from partial output' : ''}`
        : 'Using default floor because no probe was available';
    },

    // bandwidth config getters (names must match backend contracts.py)
    get bwDownFreePercent() { return Number(this.getDeclarationPreference('bandwidth_down_free_percent') ?? 20); },
    get bwDownFreeAbsolute() { return Number(this.getDeclarationPreference('bandwidth_down_free_absolute_mbps') ?? 0); },
    get bwUpFreePercent() { return Number(this.getDeclarationPreference('bandwidth_up_free_percent') ?? 50); },
    get bwUpFreeAbsolute() { return Number(this.getDeclarationPreference('bandwidth_up_free_absolute_mbps') ?? 0); },
    get bwProbeInterval() { return Number(this.getDeclarationPreference('bandwidth_probe_interval_seconds') ?? 180); },
    get bwConcurrency() { return Number(this.getDeclarationPreference('max_simultaneous_downloads') ?? 1); },
    get bwDedupValue() { return this.getDeclarationPreference('duplicate_active_transfer_action') || 'remove'; },

    // options getters
    get autoPreflightEnabled() { return !!this.getDeclarationPreference('auto_preflight_on_run'); },
    get postActionRuleValue() { return this.getDeclarationPreference('post_action_rule') || 'pending'; },

    // lifecycle
    lifecycleRows: [],
    lifecycleSessionHtml: '',
    _lifecycleSession: null,

    // cleanup & pagination
    cleanupMaxAge: 7,
    cleanupMaxCount: 100,
    archiveLimit: 100,
    logLimit: 120,

    // session history
    sessionHistory: [],
    selectedSessionId: null,
    selectedSessionStats: null,

    // log state
    resultText: 'Idle',
    resultJson: 'Idle',
    contractTraceItems: null,
    preflightData: null,
    actionLogEntries: [],

    // api discovery

    // aria2 options (safe subset exposed by backend)
    aria2Options: {},
    aria2Tiers: { managed: [], safe: [], unsafe_enabled: false },
    aria2OptionResult: '',

    // test suite
    testRunning: false,
    testSummaryVisible: false,
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
      window.addEventListener('popstate', () => {
        const path = window.location.pathname.replace(/[/]+$/, '');
        const target = path === '/bandwidth' ? 'bandwidth' : path === '/lifecycle' ? 'lifecycle' : path === '/options' ? 'options' : path === '/log' ? 'log' : path === '/dev' ? 'dev' : path === '/archive' ? 'archive' : 'dashboard';
        this.page = target;
        this._loadPageData(target);
      });

      // Dashboard needs status immediately; other pages defer it
      if (this.page === 'dashboard') {
        this.refresh();
        this.loadDeclaration().catch((e) => console.warn(e.message));
      } else {
        this.deferRefresh(1000);
      }
      this.setRefreshInterval(10000);

      if (this.page === 'lifecycle') this.loadLifecycle();
      if (this.page === 'bandwidth') this.loadDeclaration();
      if (this.page === 'options') { this.loadDeclaration(); this.loadAria2Options(); }
      if (this.page === 'log') { this.loadDeclaration(); this.refreshActionLog(); this.loadSessionHistory(); }
      if (this.page === 'archive') this.loadArchive();

      // SSE for real-time updates (falls back to polling on failure)
      this._initSSE();

      // Discovery is non-critical, defer it
      setTimeout(() => this.discoverBackends().catch((e) => console.warn(e.message)), 2000);
    },

    navigateTo(target) {
      if (this.page === target) return;
      this.page = target;
      const urlMap = { dashboard: '/', bandwidth: '/bandwidth', lifecycle: '/lifecycle', options: '/options', log: '/log', dev: '/dev', archive: '/archive' };
      history.pushState(null, '', urlMap[target] || '/');
      this._loadPageData(target);
    },
    _loadPageData(target) {
      if (target === 'dashboard') { this.refresh(); this.loadDeclaration().catch((e) => console.warn(e.message)); }
      if (target === 'lifecycle') this.loadLifecycle();
      if (target === 'bandwidth') this.loadDeclaration();
      if (target === 'options') { this.loadDeclaration(); this.loadAria2Options(); }
      if (target === 'log') { this.loadDeclaration(); this.refreshActionLog(); this.loadSessionHistory(); }
      if (target === 'archive') this.loadArchive();
    },

    // --- formatting ---
    formatEta(totalLength, completedLength, speed) {
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
    },
    formatBytes(value) {
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
    },
    formatRate(value) {
      if (value == null) return '-';
      return `${this.formatBytes(value)}/s`;
    },
    formatMbps(value) {
      if (value == null) return '-';
      return `${value} Mbps`;
    },
    humanCap(value) {
      if (value == null) return '-';
      const text = String(value).trim();
      if (!text || text === '0' || text === '0M' || text === '0 Mbps' || text === '0 Mbps/s') return 'unlimited';
      return text;
    },
    shortName(value) {
      if (!value) return '(no name)';
      try {
        const url = new URL(value);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : url.hostname;
      } catch (err) {
        const parts = value.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : value;
      }
    },
    relativeTime(value) {
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
    },
    timestampLabel(value) { return value ? this.relativeTime(value) : '-'; },

    // --- badge ---
    badgeClass(status) {
      if (['done', 'converged', 'ok', 'complete'].includes(status)) return 'badge good';
      if (['error', 'failed', 'missing', 'stopped'].includes(status)) return 'badge bad';
      if (['paused', 'queued', 'waiting', 'unchanged', 'skipped', 'cancelled'].includes(status)) return 'badge warn';
      if (status === 'discovering') return 'badge';
      return 'badge';
    },

    // --- state labels ---
    activeStateLabel(active, state) {
      if (state?.paused && active?.recovered) return 'paused';
      if (state?.paused) return 'paused';
      if (active?.recovered) return active.status ? active.status : 'recovered';
      if (active?.status) return active.status;
      if (state?.running) return 'running';
      return 'idle';
    },
    activeDisplayName(active, items) {
      const match = (items || []).find((item) => active?.gid && item.gid === active.gid);
      const url = active?.url || match?.url || '';
      const name = this.shortName(url || active?.gid || 'none');
      return { name, url };
    },
    summarizeActiveItem(active, state, items) {
      const display = this.activeDisplayName(active, items);
      const name = display.name;
      if (state?.paused && active?.recovered) return name;
      if (active?.recovered) return name;
      if (active?.status && active?.status !== 'idle') return `${active.status} · ${name}`;
      if (state?.running) return name;
      return 'none';
    },
    sessionLabel(state) {
      if (state?.session_id && !state?.session_closed_at) return `current ${String(state.session_id).slice(0, 8)}`;
      if (state?.session_id && state?.session_closed_at) return `closed ${String(state.session_id).slice(0, 8)}`;
      return '-';
    },
    schedulerStateLabel(state, reachable = true) {
      if (!reachable) return 'offline';
      if (state?.stop_requested) return 'stopping';
      return state?.running ? 'running' : 'idle';
    },
    schedulerOverviewLabel(state, items, active) {
      if (!state?.running) return 'scheduler idle';
      if (state?.paused) return 'paused';
      if (active && active.status && active.status !== 'idle') return active.status;
      if ((items || []).length) return 'ready';
      return 'idle';
    },
    sessionStateLabel(state) {
      if (state?.session_id && !state?.session_closed_at) return 'open';
      if (state?.session_id && state?.session_closed_at) return 'closed';
      return 'none';
    },
    _offlineStatusLabel() {
      const data = this.lastStatus;
      const error = data?.ariaflow?.error || data?.error || 'backend unavailable';
      return `Backend unavailable · ${error}`;
    },

    // --- sparklines ---
    recordSpeed(itemId, speed) {
      if (!itemId) return;
      const current = this.speedHistory[itemId] || [];
      const updated = [...current, Number(speed || 0)];
      this.speedHistory = { ...this.speedHistory, [itemId]: updated.length > this.SPEED_HISTORY_MAX ? updated.slice(-this.SPEED_HISTORY_MAX) : updated };
    },
    renderSparkline(itemId) {
      const data = this.speedHistory[itemId];
      if (!data || data.length < 2) return '';
      const max = Math.max(...data, 1);
      const w = 120, h = 28;
      const step = w / (data.length - 1);
      const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
      return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px;" viewBox="0 0 ${w} ${h}">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    },
    recordGlobalSpeed(speed) {
      const updated = [...this.globalSpeedHistory, Number(speed || 0)];
      this.globalSpeedHistory = updated.length > this.GLOBAL_SPEED_MAX ? updated.slice(-this.GLOBAL_SPEED_MAX) : updated;
    },
    get globalSparklineSvg() {
      const data = this.globalSpeedHistory;
      if (data.length < 2) return '';
      const max = Math.max(...data, 1);
      const w = 200, h = 40;
      const step = w / (data.length - 1);
      const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
      const peakLabel = this.formatRate(max);
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
      </svg><span style="font-size:0.78rem;color:var(--muted);">peak ${peakLabel}</span>`;
    },

    // --- notifications ---
    checkNotifications(items) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      items.forEach((item) => {
        const id = item.id || item.url || '';
        const status = (item.status || '').toLowerCase();
        const prev = this.previousItemStatuses[id];
        if (prev && prev !== status) {
          if (status === 'done') {
            new Notification('Download complete', { body: this.shortName(item.output || item.url || ''), tag: `ariaflow-${id}` });
          } else if (status === 'error' || status === 'failed') {
            new Notification('Download failed', { body: this.shortName(item.output || item.url || '') + (item.error_message ? ` — ${item.error_message}` : ''), tag: `ariaflow-${id}` });
          }
        }
        this.previousItemStatuses[id] = status;
      });
    },
    initNotifications() {
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
      const handler = () => {
        Notification.requestPermission();
        document.removeEventListener('click', handler);
      };
      document.addEventListener('click', handler);
    },

    // --- theme ---
    themeLabel: 'Theme: system',
    applyTheme(theme) {
      const root = document.documentElement;
      const saved = theme || 'system';
      const next = saved === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : saved;
      root.dataset.theme = next;
      localStorage.setItem('ariaflow.theme', saved);
      this.themeLabel = saved === 'system' ? 'Theme: system' : `Theme: ${saved}`;
    },
    initTheme() {
      const saved = localStorage.getItem('ariaflow.theme') || 'system';
      this.applyTheme(saved);
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const sync = () => {
        if ((localStorage.getItem('ariaflow.theme') || 'system') === 'system') this.applyTheme('system');
      };
      if (mq.addEventListener) mq.addEventListener('change', sync);
      else if (mq.addListener) mq.addListener(sync);
    },
    toggleTheme() {
      const current = localStorage.getItem('ariaflow.theme') || 'system';
      const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
      this.applyTheme(next);
    },

    // --- fetch with timeout ---
    _fetch(url, opts = {}, timeout = 10000) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(id));
    },

    // --- backend management ---
    loadBackendState() {
      let backends = [];
      try { backends = JSON.parse(localStorage.getItem('ariaflow.backends') || '[]'); } catch (e) { backends = []; }
      backends = [...new Set(backends.map((item) => String(item || '').trim()).filter((item) => item && item !== this.DEFAULT_BACKEND_URL))];
      const selected = (localStorage.getItem('ariaflow.selected_backend') || '').trim();
      return {
        backends,
        selected: selected === this.DEFAULT_BACKEND_URL || backends.includes(selected) ? selected : this.DEFAULT_BACKEND_URL,
      };
    },
    saveBackendState(backends, selected) {
      const clean = [...new Set((backends || []).map((item) => String(item || '').trim()).filter((item) => item && item !== this.DEFAULT_BACKEND_URL))];
      const nextSelected = selected === this.DEFAULT_BACKEND_URL || clean.includes(selected) ? selected : this.DEFAULT_BACKEND_URL;
      localStorage.setItem('ariaflow.backends', JSON.stringify(clean));
      localStorage.setItem('ariaflow.selected_backend', nextSelected);
      this._cachedBackends = clean;
      this._cachedSelectedBackend = nextSelected;
    },
    mergeDiscoveredBackends(items) {
      const discovered = Array.isArray(items)
        ? items.map((item) => String(item?.url || '').trim()).filter((item) => item && item !== this.DEFAULT_BACKEND_URL)
        : [];
      if (!discovered.length) return;
      const state = this.loadBackendState();
      const merged = [...new Set([...state.backends, ...discovered])];
      this.saveBackendState(merged, state.selected || this.DEFAULT_BACKEND_URL);
    },
    apiPath(path) {
      const backend = this.loadBackendState().selected || this.DEFAULT_BACKEND_URL;
      return `${backend.replace(/\/+$/, '')}${path}`;
    },
    backendBaseUrl() {
      return this.loadBackendState().selected || this.DEFAULT_BACKEND_URL;
    },
    selectBackend(backend) {
      const state = this.loadBackendState();
      if (!state.backends.includes(backend)) state.backends.push(backend);
      this.saveBackendState(state.backends, backend);
      this._initSSE();
      this.deferRefresh(0);
      if (this.page === 'lifecycle') this.loadLifecycle();
      if (this.page === 'log') this.refreshActionLog();
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
      const r = await this._fetch('/api/discovery');
      const data = await r.json();
      this.lastResult = data;
      this.mergeDiscoveredBackends(data.items || []);
      this.resultText = Array.isArray(data.items) && data.items.length
        ? `Discovered ${data.items.length} backend service(s)`
        : 'No Bonjour backends discovered';
      this.resultJson = JSON.stringify(data, null, 2);
    },

    // --- queue ---
    annotateQueueItems(items, active, state) {
      const liveItems = Array.isArray(active) ? active : (active ? [active] : []);
      return (items || []).map((item) => {
        const matches = liveItems.find((live) => live && (item.gid === live.gid || (state?.active_gid && item.gid === state.active_gid) || (item.url && live.url && item.url === live.url)));
        if (!matches) return item;
        const total = Number(matches.totalLength || item.totalLength || 0);
        const done = Number(matches.completedLength || item.completedLength || 0);
        const computedPercent = total > 0 ? (done / total) * 100 : null;
        const live = {
          percent: matches.percent != null ? matches.percent : computedPercent,
          downloadSpeed: matches.downloadSpeed,
          totalLength: matches.totalLength,
          completedLength: matches.completedLength,
          errorMessage: matches.errorMessage,
          recovered: matches.recovered,
          recovered_at: matches.recovered_at,
          url: matches.url,
          status: matches.status,
          gid: matches.gid,
        };
        return { ...item, live, url: item.url || live.url };
      });
    },
    filterQueueItems(items) {
      let filtered = items;
      if (this.queueFilter !== 'all') {
        filtered = filtered.filter((item) => {
          const status = (item.status || 'unknown').toLowerCase();
          const normalized = status === 'recovered' ? 'paused' : status;
          if (this.queueFilter === 'downloading') return ['downloading', 'active'].includes(normalized);
          if (this.queueFilter === 'done') return ['done', 'complete'].includes(normalized);
          return normalized === this.queueFilter;
        });
      }
      if (this.queueSearch) {
        const search = this.queueSearch.toLowerCase();
        filtered = filtered.filter((item) => {
          const url = (item.url || '').toLowerCase();
          const output = (item.output || '').toLowerCase();
          const liveUrl = (item.live?.url || '').toLowerCase();
          return url.includes(search) || output.includes(search) || liveUrl.includes(search);
        });
      }
      return filtered;
    },
    setQueueFilter(filter) {
      this.queueFilter = filter;
      this._statusETag = null;
    },
    filterBtnVisible(f) {
      return f === 'all' || (this.filterCounts[f] ?? 0) > 0 || this.queueFilter === f;
    },
    filterBtnLabel(f) {
      const count = this.filterCounts[f] ?? 0;
      const label = f.charAt(0).toUpperCase() + f.slice(1);
      return count > 0 ? `${label} (${count})` : label;
    },

    // queue item helpers for template
    itemNormalizedStatus(item) {
      return (item.status || 'unknown') === 'recovered' ? 'paused' : (item.status || 'unknown');
    },
    itemHasActiveStatus(item) {
      const status = item.status || 'unknown';
      return ['downloading', 'paused', 'recovered'].includes(status) || item.recovered;
    },
    itemShortUrl(item) {
      return this.shortName(item.output || item.url || item.live?.url || '(no url)');
    },
    itemDetail(item) {
      return [
        item.created_at ? `Added ${this.relativeTime(item.created_at)}` : null,
        item.completed_at ? `Done ${this.relativeTime(item.completed_at)}` : null,
        item.error_at ? `Failed ${this.relativeTime(item.error_at)}` : null,
        item.gid ? `GID ${item.gid}` : null,
      ].filter(Boolean).join(' · ');
    },
    itemLiveStatus(item) { return item.live?.status || null; },
    itemSpeed(item) { return item.live?.downloadSpeed || item.downloadSpeed; },
    itemTotalLength(item) { return item.live?.totalLength || item.totalLength; },
    itemCompletedLength(item) { return item.live?.completedLength || item.completedLength; },
    itemProgress(item) {
      const live = item.live || {};
      const progress = live.percent != null ? live.percent : item.percent;
      if (progress != null) return progress;
      const total = Number(this.itemTotalLength(item) || 0);
      const completed = Number(this.itemCompletedLength(item) || 0);
      return total > 0 ? (completed / total) * 100 : 0;
    },
    itemShowTransferPanel(item) {
      return this.itemHasActiveStatus(item) || this.itemTotalLength(item) || this.itemCompletedLength(item) || (item.live?.percent != null || item.percent != null);
    },
    itemRateLabel(item) {
      const speed = this.itemSpeed(item);
      if (speed) return this.formatRate(speed);
      return this.itemNormalizedStatus(item) === 'paused' ? 'paused' : 'idle';
    },
    itemModeBadge(item) {
      const mode = item.mode || item.download_mode || null;
      if (!mode || mode === 'http') return null;
      return mode;
    },
    itemPriority(item) { return item.priority != null ? item.priority : null; },
    itemDisplayUrl(item) { return item.url || item.live?.url || ''; },
    itemStateLabel(item) {
      const ns = this.itemNormalizedStatus(item);
      const ls = this.itemLiveStatus(item);
      return ls ? `${ns} · aria2:${ls}` : ns;
    },
    itemCanPause(item) { return ['downloading', 'active'].includes(this.itemNormalizedStatus(item)); },
    itemCanDequeue(item) { return this.itemNormalizedStatus(item) === 'queued'; },
    itemCanResume(item) { return this.itemNormalizedStatus(item) === 'paused'; },
    itemCanRetry(item) { return ['error', 'failed', 'stopped'].includes(this.itemNormalizedStatus(item)); },
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
      const url = this.apiPath('/api/events');
      let es;
      try { es = new EventSource(url); } catch (e) { return; }
      this._sse = es;
      es.addEventListener('connected', () => {
        this._sseConnected = true;
        if (this._sseFallbackTimer) { clearTimeout(this._sseFallbackTimer); this._sseFallbackTimer = null; }
        // Pause polling — SSE will push updates
        if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
      });
      es.addEventListener('state_changed', (e) => {
        try {
          const data = JSON.parse(e.data);
          // If backend pushes full payload (has items array), assign directly
          if (data?.items) {
            if (data?.ok === false || data?.ariaflow?.reachable === false) {
              this._consecutiveFailures++;
              if (!this.lastStatus || this._consecutiveFailures >= 3) this.lastStatus = data;
              return;
            }
            this._consecutiveFailures = 0;
            this.lastStatus = data;
            this.lastRev = data._rev || null;
            this.checkNotifications(this.itemsWithStatus);
            this.recordGlobalSpeed(this.currentSpeed || 0);
          } else if (data?.rev != null && data.rev !== this.lastRev) {
            // Lightweight event with just rev — fetch full status
            this.refresh();
          }
        } catch (err) { /* SSE parse error — ignored to avoid noise */ }
      });
      es.onerror = () => {
        this._sseConnected = false;
        // Debounce: wait 2s before resuming polling (SSE auto-reconnects)
        if (this._sseFallbackTimer) clearTimeout(this._sseFallbackTimer);
        this._sseFallbackTimer = setTimeout(() => {
          this._sseFallbackTimer = null;
          if (!this._sseConnected && !this.refreshTimer && this.refreshInterval > 0) {
            this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          }
        }, 2000);
      };
    },
    _closeSSE() {
      if (this._sse) { this._sse.close(); this._sse = null; }
      this._sseConnected = false;
    },

    // --- refresh ---
    setRefreshInterval(value) {
      this.refreshInterval = Number(value) || 0;
      localStorage.setItem('ariaflow.refresh_interval', String(this.refreshInterval));
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      if (this.refreshInterval > 0) {
        this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
      }
    },

    _deferTimer: null,
    deferRefresh(delay = 300) {
      if (this._deferTimer) clearTimeout(this._deferTimer);
      this._deferTimer = setTimeout(() => { this._deferTimer = null; this.refresh(); }, delay);
    },

    _consecutiveFailures: 0,
    _statusETag: null,
    _statusUrl() {
      let url = this.apiPath('/api/status');
      const params = [];
      if (this.queueFilter && this.queueFilter !== 'all') {
        // Map display names back to backend status names
        const backendStatus = { downloading: 'active', done: 'complete' }[this.queueFilter] || this.queueFilter;
        params.push(`status=${encodeURIComponent(backendStatus)}`);
      }
      if (this.sessionFilter && this.sessionFilter === 'current') params.push('session=current');
      if (params.length) url += '?' + params.join('&');
      return url;
    },
    async refresh() {
      if (this.refreshInFlight) return;
      this.refreshInFlight = true;
      try {
        const opts = {};
        if (this._statusETag) opts.headers = { 'If-None-Match': this._statusETag };
        const r = await this._fetch(this._statusUrl(), opts);
        if (r.status === 304) return; // Not modified
        const etag = r.headers.get('ETag');
        if (etag) this._statusETag = etag;
        const data = await r.json();
        if (data?._rev && this.lastRev === data._rev) return;
        this.lastRev = data?._rev || null;
        if (data?.ok === false || data?.ariaflow?.reachable === false) {
          this._consecutiveFailures++;
          // Show offline immediately if no prior data, or after 3 consecutive failures to avoid flicker
          if (!this.lastStatus || this._consecutiveFailures >= 3) this.lastStatus = data;
          return;
        }
        this._consecutiveFailures = 0;
        this.lastStatus = data;
        const items = this.itemsWithStatus;
        this.checkNotifications(items);
        this.recordGlobalSpeed(this.currentSpeed || 0);
      } catch (e) {
        this._consecutiveFailures++;
      } finally {
        this.refreshInFlight = false;
        // Backoff: increase polling interval on consecutive failures, reset on recovery
        if (this._consecutiveFailures > 0 && this.refreshTimer && !this._sseConnected) {
          const backoff = Math.min(this.refreshInterval * Math.pow(2, this._consecutiveFailures), 60000);
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), backoff);
          this._inBackoff = true;
        } else if (this._consecutiveFailures === 0 && this._inBackoff && this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          this._inBackoff = false;
        }
      }
    },

    // --- declaration ---
    getDeclarationPreference(name) {
      const prefs = this.lastDeclaration?.uic?.preferences || [];
      const pref = prefs.find((item) => item.name === name);
      return pref ? pref.value : undefined;
    },
    async loadDeclaration(force = false) {
      if (!force && this.lastDeclaration && this.lastDeclaration.ok !== false) return;
      const r = await this._fetch(this.apiPath('/api/declaration'));
      this.lastDeclaration = await r.json();
      if (this.lastDeclaration?.ok === false || this.lastDeclaration?.ariaflow?.reachable === false) return;
      this.declarationText = JSON.stringify(this.lastDeclaration, null, 2);
    },
    async saveDeclaration() {
      let parsed;
      try { parsed = JSON.parse(this.declarationText); } catch (e) {
        this.resultText = `Invalid JSON: ${e.message}`;
        return;
      }
      const r = await this._fetch(this.apiPath('/api/declaration'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
      const data = await r.json();
      this.lastResult = data;
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
        const r = await this._fetch(this.apiPath('/api/declaration'));
        const data = await r.json();
        const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
        for (const change of changes) {
          const idx = prefs.findIndex((p) => p.name === change.name);
          const next = { name: change.name, value: change.value, options: change.options, rationale: change.rationale };
          if (idx >= 0) prefs[idx] = next; else prefs.push(next);
        }
        data.uic = data.uic || {};
        data.uic.preferences = prefs;
        const save = await this._fetch(this.apiPath('/api/declaration'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const saved = await save.json();
        // POST returns {"saved": true, "declaration": {...}} — unwrap
        this.lastDeclaration = saved.declaration || saved;
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
      const r = await this._fetch(this.apiPath('/api/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json();
      this.lastResult = data;
      if (!r.ok || data.ok === false) {
        this.resultText = data.message || 'Add request failed';
        this.resultJson = JSON.stringify(data, null, 2);
        return;
      }
      const queued = Array.isArray(data.added) ? data.added.length : 0;
      this.resultText = queued > 1
        ? `Queued ${queued} items`
        : `Queued: ${data.added?.[0]?.url || urls[0] || raw}`;
      this.resultJson = JSON.stringify(data, null, 2);
      this.addOutput = ''; this.addPriority = ''; this.addMirrors = '';
      this.addTorrentData = null; this.addMetalinkData = null; this.addPostActionRule = '';
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
      if (!this.state?.running) return this.schedulerAction('start');
      if (this.state?.paused) return this.resumeDownloads();
      return this.pauseDownloads();
    },
    async schedulerAction(action) {
      const payload = { action };
      if (action === 'start') payload.auto_preflight_on_run = this.autoPreflightEnabled;
      const r = await this._fetch(this.apiPath('/api/run'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json();
      this.lastResult = data;
      if (!r.ok || data.ok === false) {
        this.resultText = data.message || 'Scheduler request failed';
        this.resultJson = JSON.stringify(data, null, 2);
        return;
      }
      const result = data.result || {};
      this.resultText = action === 'start'
        ? (result.started ? 'Scheduler started' : 'Scheduler already running')
        : (result.stopped ? 'Scheduler stopped' : 'Scheduler already stopped');
      this.resultJson = JSON.stringify(data, null, 2);
      if (this.lastStatus?.state) {
        if (action === 'start' && result.started) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, running: true } };
        if (action === 'stop' && result.stopped) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, running: false } };
      }
    },
    async toggleDownloads() {
      const paused = this.state?.paused;
      return paused ? this.resumeDownloads() : this.pauseDownloads();
    },
    async pauseDownloads() {
      const r = await this._fetch(this.apiPath('/api/pause'), { method: 'POST' });
      const data = await r.json();
      this.lastResult = data;
      this.resultText = data.paused ? 'Downloads paused' : 'Pause requested';
      this.resultJson = JSON.stringify(data, null, 2);
      if (data.paused && this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: true } };
    },
    async resumeDownloads() {
      const r = await this._fetch(this.apiPath('/api/resume'), { method: 'POST' });
      const data = await r.json();
      this.lastResult = data;
      this.resultText = data.resumed ? 'Downloads resumed' : 'Resume requested';
      this.resultJson = JSON.stringify(data, null, 2);
      if (data.resumed && this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: false } };
    },
    async newSession() {
      const r = await this._fetch(this.apiPath('/api/session'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'new' }) });
      const data = await r.json();
      this.lastResult = data;
      this.resultText = data.ok ? 'New session started' : 'Session change requested';
      this.resultJson = JSON.stringify(data, null, 2);
      if (this.page === 'lifecycle') this.loadLifecycle();
      if (this.page === 'log') this.refreshActionLog();
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
        r = await this._fetch(this.apiPath(`/api/item/${encodeURIComponent(itemId)}/${encodeURIComponent(action)}`), { method: 'POST' });
        data = await r.json();
      } catch (e) {
        this.resultText = `${action} failed: ${e.message}`;
        if (prevItems && this.lastStatus) this.lastStatus = { ...this.lastStatus, items: prevItems };
        return;
      }
      this.lastResult = data;
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
        const r = await this._fetch(this.apiPath(`/api/item/${encodeURIComponent(itemId)}/files`));
        const data = await r.json();
        this.fileSelectionFiles = (data.files || []).map((f) => ({ ...f, selected: f.selected !== false }));
      } catch (e) {
        this.fileSelectionFiles = [];
      }
      this.fileSelectionLoading = false;
    },
    async saveFileSelection() {
      const selected = this.fileSelectionFiles.filter((f) => f.selected).map((f) => f.index);
      const r = await this._fetch(this.apiPath(`/api/item/${encodeURIComponent(this.fileSelectionItemId)}/files`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ select: selected }),
      });
      await r.json();
      this.fileSelectionItemId = null;
      this.fileSelectionFiles = [];
    },
    closeFileSelection() {
      this.fileSelectionItemId = null;
      this.fileSelectionFiles = [];
    },

    // --- archive & cleanup ---
    async loadArchive() {
      try {
        const r = await this._fetch(this.apiPath(`/api/archive?limit=${this.archiveLimit}`));
        const data = await r.json();
        this.archiveItems = data.items || [];
      } catch (e) {
        this.archiveItems = [];
      }
    },
    loadMoreArchive() {
      this.archiveLimit += 100;
      this.loadArchive();
    },
    async cleanup() {
      const r = await this._fetch(this.apiPath('/api/cleanup'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_done_age_days: this.cleanupMaxAge, max_done_count: this.cleanupMaxCount }),
      });
      const data = await r.json();
      this.lastResult = data;
      this.resultText = data.ok ? `Cleanup complete — ${data.archived || 0} archived` : (data.message || 'Cleanup requested');
      this.resultJson = JSON.stringify(data, null, 2);
    },

    // --- bandwidth ---
    probeRunning: false,
    async runProbe() {
      this.probeRunning = true;
      this.resultText = 'Probe running...';
      try {
        const r = await this._fetch(this.apiPath('/api/bandwidth/probe'), { method: 'POST' });
        const data = await r.json();
        this.lastResult = data;
        this.resultText = data.ok ? 'Probe complete' : (data.message || 'Probe finished');
        this.resultJson = JSON.stringify(data, null, 2);
        await this.refreshBandwidth();
      } catch (e) {
        this.resultText = `Probe failed: ${e.message}`;
      } finally {
        this.probeRunning = false;
      }
    },
    async refreshBandwidth() {
      try {
        const r = await this._fetch(this.apiPath('/api/bandwidth'));
        const data = await r.json();
        if (data && data.ok !== false) {
          this.lastStatus = { ...(this.lastStatus || {}), bandwidth: data };
        }
      } catch (e) {}
    },

    // --- lifecycle ---
    async loadLifecycle() {
      try {
        const r = await this._fetch(this.apiPath('/api/lifecycle'));
        const data = await r.json();
        this.lastLifecycle = data;
        if (data?.ok === false || data?.ariaflow?.reachable === false) {
          this.lifecycleRows = [];
          this.lifecycleSessionHtml = '';
          return;
        }
        this.lifecycleRows = [
          { name: 'ariaflow', record: data.ariaflow, actions: [{ target: 'ariaflow', action: 'install', label: 'Install / Update' }, { target: 'ariaflow', action: 'uninstall', label: 'Remove' }] },
          { name: 'aria2', record: data.aria2, actions: [] },
          { name: 'networkquality', record: data.networkquality, actions: [] },
          { name: 'aria2 auto-start (advanced)', record: data['aria2-launchd'], actions: [{ target: 'aria2-launchd', action: 'install', label: 'Load' }, { target: 'aria2-launchd', action: 'uninstall', label: 'Unload' }] },
        ];
        if (data?.session_id) {
          this.lifecycleSessionHtml = 'has_session';
          this._lifecycleSession = data;
        } else {
          this.lifecycleSessionHtml = '';
          this._lifecycleSession = null;
        }
      } catch (e) {
        this.lifecycleRows = [];
        this.lifecycleSessionHtml = '';
      }
    },
    lifecycleStateLabel(name, record) {
      const result = record && record.result ? record.result : {};
      const reason = result.reason || '';
      if (name === 'ariaflow') {
        if (reason === 'match') return 'installed · current';
        if (reason === 'missing') return 'absent';
        return result.outcome || 'unknown';
      }
      if (name === 'aria2') {
        if (reason === 'match') return 'installed · current';
        if (reason === 'missing') return 'absent';
        return result.outcome || 'unknown';
      }
      if (name === 'networkquality') {
        if (reason === 'ready') return 'installed · usable';
        if (reason === 'timeout' || reason === 'probe_timeout_no_parse' || reason === 'probe_timeout_partial_capture') return 'installed · probe timeout';
        if (reason === 'no_output' || reason === 'probe_no_parse') return 'installed · no parse';
        if (reason === 'missing') return 'absent';
        if (reason === 'error' || reason === 'probe_error') return 'installed · error';
        return result.outcome || 'unknown';
      }
      if (reason === 'match') return 'loaded';
      if (reason === 'missing') return 'not loaded';
      return result.outcome || 'unknown';
    },
    lifecycleItemOutcome(record) {
      return record?.result?.outcome || 'unknown';
    },
    lifecycleItemLines(record) {
      const result = record?.result || {};
      const lines = [];
      if (result.message) lines.push(result.message);
      if (result.reason) lines.push(`Reason: ${result.reason}`);
      if (result.completion) lines.push(`Completion: ${result.completion}`);
      return lines.length ? lines.join(' · ') : 'No details';
    },
    async lifecycleAction(target, action) {
      try {
        const r = await this._fetch(this.apiPath('/api/lifecycle/action'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, action }) });
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
      try {
        const r = await this._fetch(this.apiPath('/api/preflight'), { method: 'POST' });
        const data = await r.json();
        this.lastResult = data;
        this.resultText = data.status === 'pass' ? 'Preflight passed' : 'Preflight needs attention';
        this.resultJson = JSON.stringify(data, null, 2);
        this.preflightData = data;
      } catch (e) {
        this.resultText = `Preflight failed: ${e.message}`;
      }
    },
    async uccRun() {
      try {
        const r = await this._fetch(this.apiPath('/api/ucc'), { method: 'POST' });
        const data = await r.json();
        this.lastResult = data;
        const outcome = data.result?.outcome || 'unknown';
        this.resultText = `UCC result: ${outcome}`;
        this.resultJson = JSON.stringify(data, null, 2);
        this.contractTraceItems = data;
        this.refreshActionLog();
      } catch (e) {
        this.resultText = `UCC failed: ${e.message}`;
      }
    },
    contractTraceOutcome() {
      return this.contractTraceItems?.result?.outcome || 'unknown';
    },
    contractTraceLines() {
      const data = this.contractTraceItems;
      if (!data) return '';
      const result = data.result || {};
      const preflight = data.preflight || {};
      return [
        `Contract: ${data.meta?.contract || 'unknown'} v${data.meta?.version || '-'}`,
        `Outcome: ${result.outcome || 'unknown'}`,
        `Observation: ${result.observation || 'unknown'}`,
        result.message ? `Message: ${result.message}` : null,
        result.reason ? `Reason: ${result.reason}` : null,
        preflight.status ? `Preflight: ${preflight.status}` : null,
      ].filter(Boolean).join(' · ');
    },

    async refreshActionLog() {
      if (this.page !== 'log') return;
      try {
        const r = await this._fetch(this.apiPath(`/api/log?limit=${this.logLimit}`));
        const data = await r.json();
        if (data?.ok === false || data?.ariaflow?.reachable === false) {
          this.actionLogEntries = [];
          return;
        }
        this.actionLogEntries = data.items || [];
      } catch (e) {
        this.actionLogEntries = [];
      }
    },
    get filteredActionLog() {
      const sessionId = this.state?.session_id || this.lastLifecycle?.session_id || this.lastDeclaration?.session_id || null;
      return this.actionLogEntries
        .filter((entry) => this.actionFilter === 'all' || (entry.action || 'unknown') === this.actionFilter)
        .filter((entry) => this.targetFilter === 'all' || (entry.target || 'unknown') === this.targetFilter)
        .filter((entry) => this.sessionFilter === 'all' || (this.sessionFilter === 'current' ? (sessionId ? entry.session_id === sessionId : false) : true))
        .slice()
        .reverse();
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
      const gid = detail.gid || '-';
      const done = detail.completedLength ? this.formatBytes(detail.completedLength) : null;
      const total = detail.totalLength ? this.formatBytes(detail.totalLength) : null;
      const speed = detail.downloadSpeed ? this.formatRate(detail.downloadSpeed) : '0 B/s';
      const target = this.shortName(detail.url || gid);
      return [
        'Historical poll snapshot',
        `gid ${gid}`,
        `${status} · ${target}`,
        done && total ? `${done}/${total}` : null,
        `speed ${speed}`,
      ].filter(Boolean).join(' · ');
    },
    logEntryLines(entry) {
      if (entry.action === 'poll') return this.summarizePollEntry(entry);
      return [
        entry.timestamp ? `At ${entry.timestamp}` : null,
        entry.session_id ? `Session: ${entry.session_id}` : null,
        entry.action ? `Action: ${entry.action}` : null,
        entry.target ? `Target: ${entry.target}` : null,
        entry.reason ? `Reason: ${entry.reason}` : null,
        entry.detail ? `Detail: ${JSON.stringify(this.sanitizeLogValue(entry.detail))}` : null,
        entry.observed_before ? `Before: ${JSON.stringify(this.sanitizeLogValue(entry.observed_before))}` : null,
        entry.observed_after ? `After: ${JSON.stringify(this.sanitizeLogValue(entry.observed_after))}` : null,
        entry.message ? `Message: ${entry.message}` : null,
      ].filter(Boolean).join(' · ');
    },

    // --- session history ---
    async loadSessionHistory() {
      try {
        const r = await this._fetch(this.apiPath('/api/sessions?limit=50'));
        const data = await r.json();
        this.sessionHistory = data.sessions || [];
      } catch (e) {
        this.sessionHistory = [];
      }
    },
    async loadSessionStats(sessionId) {
      this.selectedSessionId = sessionId;
      this.selectedSessionStats = null;
      try {
        const r = await this._fetch(this.apiPath(`/api/session/stats?session_id=${encodeURIComponent(sessionId)}`));
        this.selectedSessionStats = await r.json();
      } catch (e) {
        this.selectedSessionStats = { error: 'Failed to load stats' };
      }
    },

    // --- active transfer helper ---
    activeTransfer(items, active, state) {
      const liveItems = Array.isArray(items) ? items : [];
      return liveItems.find((item) => item && (item.gid === active?.gid || (state?.active_gid && item.gid === state.active_gid) || (active?.url && item.url && active.url === item.url)))
        || active
        || null;
    },

    // --- aria2 options ---
    async loadAria2Options() {
      try {
        const r = await this._fetch(this.apiPath('/api/aria2/get_global_option'));
        const data = await r.json();
        if (data && data.ok !== false) this.aria2Options = data;
      } catch (e) {
        this.aria2Options = {};
      }
      try {
        const r = await this._fetch(this.apiPath('/api/aria2/option_tiers'));
        const data = await r.json();
        if (data && !data.error) this.aria2Tiers = data;
      } catch (e) {}
    },
    get aria2UnsafeEnabled() { return !!this.getDeclarationPreference('aria2_unsafe_options'); },
    setAria2UnsafeOptions(enabled) {
      this._queuePrefChange('aria2_unsafe_options', !!enabled, [false, true], 'allow setting any aria2 option via API');
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
        const r = await this._fetch(this.apiPath('/api/aria2/options'), {
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
    async runTests() {
      this.testSummaryVisible = true;
      this.testBadgeText = 'running...';
      this.testBadgeClass = 'badge';
      this.testCountsText = 'Running test suite...';
      this.testResults = [];
      this.testRunning = true;
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
        if (!this.testResults.length) {
          this.testResults = [{ name: total === 0 ? 'No test files available.' : ok ? 'All tests passed.' : 'No test details available.', _placeholder: true }];
        }
      } catch (err) {
        this.testBadgeText = 'error';
        this.testBadgeClass = 'badge bad';
        this.testCountsText = `Failed to reach backend: ${err.message}`;
        this.testResults = [];
      }
      this.testRunning = false;
    },
  }));
});
