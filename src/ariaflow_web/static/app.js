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
    queueFilter: 'all',
    queueSearch: '',
    speedHistory: {},
    SPEED_HISTORY_MAX: 30,
    globalSpeedHistory: [],
    globalUploadHistory: [],
    GLOBAL_SPEED_MAX: 40,
    previousItemStatuses: {},
    refreshInFlight: false,
    lastRev: null,
    page: 'dashboard',
    DEFAULT_BACKEND_URL: window.__ARIAFLOW_BACKEND_URL__ || 'http://127.0.0.1:8000',
    localIps: window.__ARIAFLOW_WEB_LOCAL_IPS__ || ['127.0.0.1'],
    localMainIp: window.__ARIAFLOW_WEB_LOCAL_MAIN_IP__ || '127.0.0.1',
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
    fileSelectionItemId: null,
    fileSelectionFiles: [],
    fileSelectionLoading: false,
    archiveItems: [],
    torrentList: [],
    torrentLoading: false,
    peerList: [],

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
    get currentUploadSpeed() { return this.currentTransfer?.uploadSpeed || this.active?.uploadSpeed || null; },
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
    get transferSpeedText() {
      if (!this.backendReachable) return 'idle';
      const dl = this.currentSpeed ? this.formatRate(this.currentSpeed) : null;
      const ul = this.currentUploadSpeed ? this.formatRate(this.currentUploadSpeed) : null;
      if (dl && ul) return `↓ ${dl}  ↑ ${ul}`;
      if (dl) return `↓ ${dl}`;
      return 'idle';
    },
    get sessionStartedText() {
      if (!this.backendReachable) return '-';
      return this.timestampLabel(this.state.session_started_at);
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
    get backendVersionText() {
      if (!this.backendReachable) return '-';
      const v = this.lastStatus?.ariaflow?.version;
      return v ? `v${v}` : 'unreported';
    },
    get backendPidText() {
      if (!this.backendReachable) return '-';
      return this.lastStatus?.ariaflow?.pid || 'unreported';
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
    get bwSourceText() {
      if (!this.backendReachable) return 'offline';
      return this.bw.source || '-';
    },
    get bwDownBadgeText() {
      if (!this.backendReachable) return '-';
      return this.bw.downlink_mbps ? this.formatMbps(this.bw.downlink_mbps) : '-';
    },
    get bwUpBadgeText() {
      if (!this.backendReachable) return '-';
      return this.bw.uplink_mbps ? this.formatMbps(this.bw.uplink_mbps) : '-';
    },
    get bwDownCapText() {
      if (!this.backendReachable) return '-';
      return this.bw.down_cap_mbps ? this.formatMbps(this.bw.down_cap_mbps) : (this.bw.cap_mbps ? this.formatMbps(this.bw.cap_mbps) : '-');
    },
    get bwUpCapText() {
      if (!this.backendReachable) return '-';
      return this.bw.up_cap_mbps ? this.formatMbps(this.bw.up_cap_mbps) : '-';
    },
    get bwCurrentLimitText() {
      if (!this.backendReachable) return '-';
      const limit = this.bw.current_limit;
      return limit ? this.formatBytes(limit) + '/s' : '-';
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

    // lifecycle
    lifecycleRows: [],
    _lifecycleSession: null,

    // cleanup & pagination
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
    webLogEntries: [],

    // api discovery

    // aria2 options (safe subset exposed by backend)
    itemOptionsGid: null,
    itemOptionsData: null,
    aria2Options: {},
    aria2Tiers: { managed: [], safe: [], unsafe_enabled: false },
    aria2OptionResult: '',

    // test suite
    testRunning: false,
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
      window.addEventListener('beforeunload', () => { if (this._prefQueue.length) this._flushPrefQueue(); });
      document.addEventListener('visibilitychange', () => this._onVisibilityChange());
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
      if (this.page === 'log') { this.loadDeclaration(); this.refreshActionLog(); this.loadSessionHistory(); this.loadWebLog(); }
      if (this.page === 'archive') this.loadArchive();
      this._updateTabTimers(this.page);

      // SSE for real-time updates (falls back to polling on failure)
      this._initSSE();

      // Discovery is non-critical, defer it
      setTimeout(() => this.discoverBackends().catch((e) => console.warn(e.message)), 2000);
    },

    _mediumTimer: null,
    _slowTimer: null,
    MEDIUM_INTERVAL: 30000,
    SLOW_INTERVAL: 120000,

    // Per-tab refresh policies
    _TAB_MEDIUM: {
      // refreshActionLog removed — backend now pushes action_logged SSE events (BG-7)
      log: ['loadWebLog'],
      bandwidth: ['refreshBandwidth'],
      lifecycle: ['loadLifecycle'],
    },
    _TAB_SLOW: {
      dashboard: ['loadDeclaration'],
      log: ['loadSessionHistory'],
      options: ['loadDeclaration', 'loadAria2Options', 'loadTorrents', 'loadPeers'],
      bandwidth: ['loadDeclaration'],
    },
    _tabHidden: false,

    navigateTo(target) {
      if (this.page === target) return;
      this.page = target;
      const urlMap = { dashboard: '/', bandwidth: '/bandwidth', lifecycle: '/lifecycle', options: '/options', log: '/log', dev: '/dev', archive: '/archive' };
      history.pushState(null, '', urlMap[target] || '/');
      this._loadPageData(target);
      this._updateTabTimers(target);
    },
    _runTabMethods(methods) {
      for (const m of methods || []) { if (typeof this[m] === 'function') this[m](); }
    },
    _pauseTabTimers() {
      if (this._mediumTimer) { clearInterval(this._mediumTimer); this._mediumTimer = null; }
      if (this._slowTimer) { clearInterval(this._slowTimer); this._slowTimer = null; }
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
        this._pauseTabTimers();
        this._closeSSE();
      } else {
        // Tab visible: refresh immediately + restart all timers
        if (this.refreshInterval > 0) {
          this.refresh();
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          this._updateTabTimers(this.page);
        }
        this._initSSE();
      }
    },
    _updateTabTimers(target) {
      this._pauseTabTimers();
      if (this.refreshInterval === 0) return; // "Off" = no background activity
      const medium = this._TAB_MEDIUM[target];
      const slow = this._TAB_SLOW[target];
      const mediumMs = Math.max(this.MEDIUM_INTERVAL, this.refreshInterval);
      const slowMs = Math.max(this.SLOW_INTERVAL, this.refreshInterval);
      if (medium) this._mediumTimer = setInterval(() => this._runTabMethods(medium), mediumMs);
      if (slow) this._slowTimer = setInterval(() => this._runTabMethods(slow), slowMs);
    },
    _loadPageData(target) {
      if (target === 'dashboard') { this.refresh(); this.loadDeclaration().catch((e) => console.warn(e.message)); }
      if (target === 'lifecycle') this.loadLifecycle();
      if (target === 'bandwidth') this.loadDeclaration();
      if (target === 'options') { this.loadDeclaration(); this.loadAria2Options(); this.loadTorrents(); this.loadPeers(); }
      if (target === 'log') { this.loadDeclaration(); this.refreshActionLog(); this.loadSessionHistory(); this.loadWebLog(); }
      if (target === 'archive') this.loadArchive();
    },

    // --- formatting ---
    // --- formatters (delegated to formatters.js) ---
    formatEta, formatBytes, formatRate, formatMbps, humanCap, shortName,
    relativeTime, timestampLabel, badgeClass, sessionLabel,

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
      this.resultText = this.state?.paused ? 'Downloads paused' : 'Downloads running';
    },
    _offlineStatusLabel() {
      const data = this.lastStatus;
      const error = data?.ariaflow?.error || data?.error || 'backend unavailable';
      return `Backend unavailable · ${error}`;
    },

    // --- sparklines (rendering delegated to sparkline.js) ---
    recordSpeed(itemId, speed) {
      if (!itemId) return;
      const s = Number(speed || 0);
      const current = this.speedHistory[itemId] || [];
      // Skip if speed unchanged — avoids Alpine reactivity churn
      if (current.length && current[current.length - 1] === s && s === 0) return;
      const updated = [...current, s];
      this.speedHistory = { ...this.speedHistory, [itemId]: updated.length > this.SPEED_HISTORY_MAX ? updated.slice(-this.SPEED_HISTORY_MAX) : updated };
    },
    renderSparkline(itemId) { return renderItemSparkline(this.speedHistory[itemId]); },
    recordGlobalSpeed(dlSpeed, ulSpeed) {
      const dlUpdated = [...this.globalSpeedHistory, Number(dlSpeed || 0)];
      this.globalSpeedHistory = dlUpdated.length > this.GLOBAL_SPEED_MAX ? dlUpdated.slice(-this.GLOBAL_SPEED_MAX) : dlUpdated;
      const ulUpdated = [...this.globalUploadHistory, Number(ulSpeed || 0)];
      this.globalUploadHistory = ulUpdated.length > this.GLOBAL_SPEED_MAX ? ulUpdated.slice(-this.GLOBAL_SPEED_MAX) : ulUpdated;
    },
    get globalSparklineSvg() { return renderGlobalSparkline(this.globalSpeedHistory, this.globalUploadHistory); },

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
      // Extract backend-role services only (skip web frontends).
      const list = Array.isArray(items)
        ? items.filter((item) => !item?.role || item.role !== 'web')
        : [];
      // Build URL→metadata map for friendly display.
      const meta = { ...this.backendMeta };
      for (const item of list) {
        const url = String(item?.url || '').trim();
        if (!url) continue;
        meta[url] = {
          name: String(item?.name || '').trim(),
          host: String(item?.host || '').trim(),
          ip: String(item?.ip || '').trim(),
          txt_hostname: String(item?.txt_hostname || '').trim(),
        };
      }
      this.backendMeta = meta;

      // Determine which items refer to this same machine (self).
      // Primary check: compare the backend's hostname TXT record (from BG-6)
      // against our injected local hostname — exact, case-insensitive match.
      // Fallbacks (for old backends without the TXT field): .local hostname
      // parsing, IP match, loopback detection.
      const localHostLower = String(window.__ARIAFLOW_WEB_HOSTNAME__ || '').toLowerCase();
      const selfLocal = localHostLower ? `${localHostLower}.local` : '';
      const localIps = this.localIps || [];
      const isSelf = (item) => {
        // Primary: TXT hostname (BG-6)
        const txtHost = String(item?.txt_hostname || '').toLowerCase();
        if (txtHost && localHostLower && txtHost === localHostLower) return true;
        // Fallback: SRV .local hostname (strip trailing dot, lowercase)
        const host = String(item?.host || '').toLowerCase().replace(/\.$/, '');
        if (selfLocal && host === selfLocal) return true;
        // Fallback: IP match
        const ip = String(item?.ip || '');
        if (ip && localIps.includes(ip)) return true;
        if (ip && ip.startsWith('127.')) return true;
        try {
          const urlIp = new URL(String(item?.url || '')).hostname;
          if (urlIp === '127.0.0.1') return true;
        } catch { /* ignore */ }
        return false;
      };

      // Dedupe by instance name, then drop self entries for the dropdown.
      const seenNames = new Set();
      const deduped = [];
      for (const item of list) {
        const name = String(item?.name || '').trim();
        if (name && seenNames.has(name)) continue;
        if (name) seenNames.add(name);
        deduped.push(item);
      }
      const remote = deduped.filter((item) => !isSelf(item));
      const discovered = remote.map((i) => String(i?.url || '').trim()).filter(Boolean);

      if (!discovered.length) return;
      const state = this.loadBackendState();
      const merged = [...new Set([...state.backends, ...discovered])];
      const firstDiscovered = discovered[0];
      const autoSelect = discovered.length === 1
        && state.selected === this.DEFAULT_BACKEND_URL
        && firstDiscovered !== state.selected;
      this.saveBackendState(merged, autoSelect ? firstDiscovered : state.selected);
      if (autoSelect) { this._closeSSE(); this._initSSE(); this.deferRefresh(0); }
    },
    backendDisplayName(url) {
      if (!url) return '-';
      // Extract address (host:port) shown in parens
      let addr = url;
      try { addr = new URL(url).host; } catch { /* keep raw */ }
      // Default backend: substitute real LAN IP (Google trick) for loopback
      if (url === this.DEFAULT_BACKEND_URL) {
        const host = window.__ARIAFLOW_WEB_HOSTNAME__ || 'localhost';
        const mainIp = window.__ARIAFLOW_WEB_LOCAL_MAIN_IP__ || '127.0.0.1';
        let port = '8000';
        try { port = new URL(url).port || '8000'; } catch { /* keep default */ }
        return `${host} (${mainIp}:${port})`;
      }
      // Discovered backend with Bonjour name
      const meta = this.backendMeta[url];
      if (meta?.name) {
        const name = meta.name.replace(/\s*\(\d+\)\s*$/, '');
        return `${name} (${addr})`;
      }
      // Fallback: host:port only
      return addr;
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
      try {
        const r = await this._fetch('/api/discovery');
        const data = await r.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        if (data?.available === false) {
          this.bonjourState = 'unavailable';
        } else if (items.length === 0) {
          this.bonjourState = 'broken';
        } else {
          this.bonjourState = 'ok';
        }
        this.mergeDiscoveredBackends(items);
        this.backendsDiscovered = items.length > 0;
        this.discoveryText = this.backendsDiscovered
          ? `Discovered ${items.length} backend service(s)`
          : 'No Bonjour backends discovered';
      } catch (e) {
        this.bonjourState = 'broken';
      }
    },
    get bonjourBadgeText() {
      return ({ pending: 'mDNS …', ok: 'mDNS ✓', broken: 'mDNS ✗', 'unavailable': 'mDNS N/A' })[this.bonjourState] || 'mDNS';
    },
    get bonjourBadgeClass() {
      return ({ pending: 'badge', ok: 'badge good', broken: 'badge warn', unavailable: 'badge' })[this.bonjourState] || 'badge';
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
      const stableFilters = new Set(['all', 'downloading', 'paused', 'done', 'error']);
      return stableFilters.has(f) || (this.filterCounts[f] ?? 0) > 0 || this.queueFilter === f;
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
      return ['active', 'downloading', 'paused', 'recovered'].includes(status) || item.recovered;
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
      if (item.rpc_failures) {
        return /timed out/i.test(item.rpc_error_message || '') ? 'timed out' : 'rpc issue';
      }
      if (item.error_code === 'rpc_unreachable' || /timed out/i.test(item.error_message || '')) {
        return 'timed out';
      }
      if (['active', 'downloading', 'waiting'].includes(this.itemNormalizedStatus(item))) return 'stale';
      return this.itemNormalizedStatus(item) === 'paused' ? 'paused' : 'idle';
    },
    itemShowPausedAt(item) {
      return this.itemNormalizedStatus(item) === 'paused' && !!item.paused_at;
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
      if (item.rpc_failures) {
        const limit = Number(item.rpc_failure_limit || 0);
        const detail = /timed out/i.test(item.rpc_error_message || '') ? 'rpc timeout' : 'rpc issue';
        return limit > 0 ? `${ns} · ${detail} ${item.rpc_failures}/${limit}` : `${ns} · ${detail}`;
      }
      const ls = this.itemLiveStatus(item);
      return ls ? `${ns} · aria2:${ls}` : ns;
    },
    itemAllowedActions(item) { return item.allowed_actions || []; },
    itemCanPause(item) { const aa = this.itemAllowedActions(item); return aa.length ? aa.includes('pause') : ['downloading', 'active'].includes(this.itemNormalizedStatus(item)); },
    itemCanResume(item) { const aa = this.itemAllowedActions(item); return aa.length ? aa.includes('resume') : this.itemNormalizedStatus(item) === 'paused'; },
    itemCanRetry(item) { const aa = this.itemAllowedActions(item); return aa.length ? aa.includes('retry') : ['error', 'failed', 'stopped'].includes(this.itemNormalizedStatus(item)); },
    itemCanRemove(item) { const aa = this.itemAllowedActions(item); return aa.length ? aa.includes('remove') : this.itemNormalizedStatus(item) !== 'cancelled'; },
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
        if (this._deferTimer) { clearTimeout(this._deferTimer); this._deferTimer = null; }
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
            this.recordGlobalSpeed(this.currentSpeed || 0, this.currentUploadSpeed || 0);
          } else if (data?.rev != null && data.rev !== this.lastRev) {
            // Lightweight event with just rev — fetch full status
            this.refresh();
          }
        } catch (err) { /* SSE parse error — ignored to avoid noise */ }
      });
      // BG-7: backend pushes individual action log entries in real-time
      es.addEventListener('action_logged', (e) => {
        try {
          const entry = JSON.parse(e.data);
          if (entry && typeof entry === 'object') {
            this.actionLogEntries = [entry, ...this.actionLogEntries].slice(0, this.logLimit || 120);
          }
        } catch (err) { /* ignore */ }
      });
      es.onerror = () => {
        this._sseConnected = false;
        if (this._sseFallbackTimer) clearTimeout(this._sseFallbackTimer);
        this._sseFallbackTimer = setTimeout(async () => {
          this._sseFallbackTimer = null;
          if (this._sseConnected) return;
          try {
            const r = await this._fetch(this.apiPath('/api/health'), {}, 3000);
            if (r.ok && !this.refreshTimer && this.refreshInterval > 0) {
              this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
            }
          } catch (e) {
            this._sseFallbackTimer = setTimeout(() => this._initSSE(), 5000);
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
      // Update tab timers — respects "Off" and new interval
      this._updateTabTimers(this.page);
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
        if (r.status === 304) {
          this.syncSchedulerResultText();
          return; // Not modified
        }
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
        this.syncSchedulerResultText();
        const items = this.itemsWithStatus;
        this.checkNotifications(items);
        this.recordGlobalSpeed(this.currentSpeed || 0, this.currentUploadSpeed || 0);
      } catch (e) {
        this._consecutiveFailures++;
        const message = e && e.message ? e.message : 'connection refused';
        if (!this.lastStatus || this._consecutiveFailures >= 3) {
          this.lastStatus = {
            ...(this.lastStatus || {}),
            ok: false,
            ariaflow: {
              ...(this.lastStatus?.ariaflow || {}),
              reachable: false,
              error: message,
            },
          };
        }
      } finally {
        this.refreshInFlight = false;
        // Backoff: increase polling interval on consecutive failures, reset on recovery
        if (this._consecutiveFailures > 0 && this.refreshTimer && !this._sseConnected) {
          const backoff = Math.min(this.refreshInterval * Math.pow(2, this._consecutiveFailures), 60000);
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), backoff);
          this._inBackoff = true;
          // Pause tab timers — backend is unreachable
          this._pauseTabTimers();
        } else if (this._consecutiveFailures === 0 && this._inBackoff && this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          this._inBackoff = false;
          // Resume tab timers — backend is back
          this._updateTabTimers(this.page);
        }
      }
    },

    // --- declaration ---
    getDeclarationPreference(name) {
      const prefs = this.lastDeclaration?.uic?.preferences || [];
      const pref = prefs.find((item) => item.name === name);
      return pref ? pref.value : undefined;
    },
    _declarationLoadedAt: 0,
    async loadDeclaration(force = false) {
      if (!force && this.lastDeclaration && this.lastDeclaration.ok !== false && Date.now() - this._declarationLoadedAt < 30000) return;
      const r = await this._fetch(this.apiPath('/api/declaration'));
      this.lastDeclaration = await r.json();
      if (this.lastDeclaration?.ok === false || this.lastDeclaration?.ariaflow?.reachable === false) return;
      this.declarationText = JSON.stringify(this.lastDeclaration, null, 2);
      this._declarationLoadedAt = Date.now();
    },
    async saveDeclaration() {
      let parsed;
      try { parsed = JSON.parse(this.declarationText); } catch (e) {
        this.resultText = `Invalid JSON: ${e.message}`;
        return;
      }
      const r = await this._fetch(this.apiPath('/api/declaration'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) });
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
        const r = await this._fetch(this.apiPath('/api/declaration/preferences'), {
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
      const r = await this._fetch(this.apiPath('/api/downloads/add'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await r.json();
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
      if (action !== 'start') {
        this.resultText = 'Stop not supported';
        return;
      }
      const endpoint = '/api/scheduler/resume';
      const payload = { auto_preflight_on_run: this.autoPreflightEnabled };
      try {
        const r = await this._fetch(this.apiPath(endpoint), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await r.json();
        if (!r.ok || data.ok === false) {
          this.resultText = data.message || 'Scheduler request failed';
          this.resultJson = JSON.stringify(data, null, 2);
          return;
        }
        const result = data.result || {};
        this.resultText = result.started ? 'Scheduler started' : 'Scheduler already running';
        this.resultJson = JSON.stringify(data, null, 2);
        if (this.lastStatus?.state) {
          if (result.started) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, running: true } };
        }
      } catch (e) {
        this.resultText = `Scheduler ${action} failed: ${e.message}`;
      }
    },
    async pauseDownloads() {
      try {
        const r = await this._fetch(this.apiPath('/api/scheduler/pause'), { method: 'POST' });
        const data = await r.json();
        this.resultText = data.paused
          ? 'Downloads paused'
          : (data.message || (data.reason === 'no_active_transfer' ? 'No active transfer to pause' : 'Pause failed'));
        this.resultJson = JSON.stringify(data, null, 2);
        if (data.paused && this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: true } };
      } catch (e) {
        this.resultText = `Pause failed: ${e.message}`;
      }
    },
    async resumeDownloads() {
      try {
        const r = await this._fetch(this.apiPath('/api/scheduler/resume'), { method: 'POST' });
        const data = await r.json();
        this.resultText = data.resumed
          ? 'Downloads resumed'
          : (data.message || (data.reason === 'no_active_transfer' ? 'No active transfer to resume' : 'Resume failed'));
        this.resultJson = JSON.stringify(data, null, 2);
        if (data.resumed && this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: false } };
      } catch (e) {
        this.resultText = `Resume failed: ${e.message}`;
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
        r = await this._fetch(this.apiPath(`/api/downloads/${encodeURIComponent(itemId)}/${encodeURIComponent(action)}`), { method: 'POST' });
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
        const r = await this._fetch(this.apiPath(`/api/downloads/${encodeURIComponent(itemId)}/files`));
        const data = await r.json();
        this.fileSelectionFiles = (data.files || []).map((f) => ({ ...f, selected: f.selected !== false }));
      } catch (e) {
        this.fileSelectionFiles = [];
      }
      this.fileSelectionLoading = false;
    },
    async saveFileSelection() {
      const selected = this.fileSelectionFiles.filter((f) => f.selected).map((f) => f.index);
      const r = await this._fetch(this.apiPath(`/api/downloads/${encodeURIComponent(this.fileSelectionItemId)}/files`), {
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
        const r = await this._fetch(this.apiPath(`/api/downloads/archive?limit=${this.archiveLimit}`));
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
      const r = await this._fetch(this.apiPath('/api/downloads/cleanup'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_done_age_days: 7, max_done_count: 100 }),
      });
      const data = await r.json();
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
      } catch (e) { console.warn('refreshBandwidth:', e.message); }
    },

    // --- lifecycle ---
    async loadLifecycle() {
      try {
        const r = await this._fetch(this.apiPath('/api/lifecycle'));
        const data = await r.json();
        this.lastLifecycle = data;
        if (data?.ok === false || data?.ariaflow?.reachable === false) {
          this.lifecycleRows = [];
          return;
        }
        this.lifecycleRows = [
          { name: 'ariaflow', record: data.ariaflow, actions: [{ target: 'ariaflow', action: 'install', label: 'Install / Update' }, { target: 'ariaflow', action: 'uninstall', label: 'Remove' }] },
          { name: 'aria2', record: data.aria2, actions: [] },
          { name: 'networkquality', record: data.networkquality, actions: [] },
          { name: 'aria2 auto-start (advanced)', record: data['aria2-launchd'], actions: [{ target: 'aria2-launchd', action: 'install', label: 'Load' }, { target: 'aria2-launchd', action: 'uninstall', label: 'Unload' }] },
        ];
        if (data?.session_id) {
          this._lifecycleSession = data;
        } else {
          this._lifecycleSession = null;
        }
      } catch (e) {
        this.lifecycleRows = [];
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
      if (result.observation && result.observation !== 'ok') lines.push(`Observation: ${result.observation}`);
      if (result.reason) lines.push(`Reason: ${result.reason}`);
      if (result.completion) lines.push(`Completion: ${result.completion}`);
      return lines.length ? lines.join(' · ') : 'No details';
    },
    async lifecycleAction(target, action) {
      try {
        const r = await this._fetch(this.apiPath(`/api/lifecycle/${encodeURIComponent(target)}/${encodeURIComponent(action)}`), { method: 'POST' });
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
        const r = await this._fetch(this.apiPath('/api/scheduler/preflight'), { method: 'POST' });
        const data = await r.json();
        this.resultText = data.status === 'pass' ? 'Preflight passed' : 'Preflight needs attention';
        this.resultJson = JSON.stringify(data, null, 2);
        this.preflightData = data;
      } catch (e) {
        this.resultText = `Preflight failed: ${e.message}`;
      }
    },
    async uccRun() {
      try {
        const r = await this._fetch(this.apiPath('/api/scheduler/ucc'), { method: 'POST' });
        const data = await r.json();
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
        // Reset stale filters if selected value no longer exists
        if (this.actionFilter !== 'all' && !this.availableActions.includes(this.actionFilter)) this.actionFilter = 'all';
        if (this.targetFilter !== 'all' && !this.availableTargets.includes(this.targetFilter)) this.targetFilter = 'all';
      } catch (e) {
        this.actionLogEntries = [];
      }
    },
    async loadWebLog() {
      try {
        const r = await this._fetch('/api/web/log?limit=100');
        const data = await r.json();
        this.webLogEntries = data.items || [];
      } catch (e) {
        this.webLogEntries = [];
      }
    },
    get availableActions() {
      return [...new Set(this.actionLogEntries.map((e) => e.action || 'unknown'))].sort();
    },
    get availableTargets() {
      return [...new Set(this.actionLogEntries.map((e) => e.target || 'unknown'))].sort();
    },
    get filteredActionLog() {
      const sessionId = this.state?.session_id || this.lastLifecycle?.session_id || this.lastDeclaration?.session_id || null;
      const entries = this.actionLogEntries
        .filter((entry) => this.actionFilter === 'all' || (entry.action || 'unknown') === this.actionFilter)
        .filter((entry) => this.targetFilter === 'all' || (entry.target || 'unknown') === this.targetFilter)
        .filter((entry) => this.sessionFilter === 'all' || (this.sessionFilter === 'current' ? (sessionId ? entry.session_id === sessionId : false) : true));
      // Collapse consecutive poll entries with same gid into one
      const collapsed = [];
      for (const entry of entries) {
        if (entry.action === 'poll' && collapsed.length) {
          const prev = collapsed[collapsed.length - 1];
          if (prev.action === 'poll' && prev.detail?.gid === entry.detail?.gid) {
            prev._pollCount = (prev._pollCount || 1) + 1;
            prev.detail = entry.detail;
            prev.timestamp = entry.timestamp;
            continue;
          }
        }
        collapsed.push({ ...entry });
      }
      return collapsed.slice().reverse();
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
    logEntryLines(entry) {
      if (entry.action === 'poll') {
        const summary = this.summarizePollEntry(entry);
        return entry._pollCount > 1 ? `${summary} (${entry._pollCount} polls)` : summary;
      }
      return [
        entry.message || entry.reason || null,
        entry.target ? entry.target : null,
        entry.timestamp ? this.relativeTime(entry.timestamp) : null,
      ].filter(Boolean).join(' · ');
    },

    // --- per-item aria2 options ---
    async loadItemOptions(gid) {
      if (!gid) return;
      if (this.itemOptionsGid === gid) { this.itemOptionsGid = null; this.itemOptionsData = null; return; }
      this.itemOptionsGid = gid;
      this.itemOptionsData = null;
      try {
        const r = await this._fetch(this.apiPath(`/api/aria2/get_option?gid=${encodeURIComponent(gid)}`));
        this.itemOptionsData = await r.json();
      } catch (e) {
        this.itemOptionsData = { error: e.message };
      }
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
        const r = await this._fetch(this.apiPath(`/api/sessions/stats?session_id=${encodeURIComponent(sessionId)}`));
        this.selectedSessionStats = await r.json();
      } catch (e) {
        this.selectedSessionStats = { error: 'Failed to load stats' };
      }
    },

    async newSession() {
      try {
        const r = await this._fetch(this.apiPath('/api/sessions/new'), { method: 'POST' });
        const data = await r.json();
        this.resultText = data.ok !== false ? `New session: ${data.session || 'created'}` : (data.message || 'Failed');
        this.loadSessionHistory();
        this.refresh();
      } catch (e) {
        this.resultText = `New session failed: ${e.message}`;
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
        const r = await this._fetch(this.apiPath('/api/aria2/change_global_option'), {
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
        const r = await this._fetch(this.apiPath('/api/aria2/change_option'), {
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
        const r = await this._fetch(this.apiPath('/api/aria2/set_limits'), {
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
    async loadPeers() {
      try {
        const r = await this._fetch(this.apiPath('/api/peers'));
        const data = await r.json();
        this.peerList = data.peers || [];
      } catch (e) {
        this.peerList = [];
      }
    },
    async loadTorrents() {
      this.torrentLoading = true;
      try {
        const r = await this._fetch(this.apiPath('/api/torrents'));
        const data = await r.json();
        this.torrentList = data.torrents || data.items || [];
      } catch (e) {
        this.torrentList = [];
      } finally {
        this.torrentLoading = false;
      }
    },
    async stopTorrent(infohash) {
      try {
        const r = await this._fetch(this.apiPath(`/api/torrents/${encodeURIComponent(infohash)}/stop`), { method: 'POST' });
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
      this.testRunning = false;
    },
  }));
});
