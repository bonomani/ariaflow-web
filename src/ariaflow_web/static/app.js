    let lastStatus = null;
    let lastLifecycle = null;
    let lastResult = null;
    let refreshTimer = null;
    let refreshInterval = 10000;
    let lastDeclaration = null;
    function escapeHtml(str) {
      if (str == null) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    let queueFilter = 'all';
    let queueSearch = '';
    const speedHistory = {};
    const SPEED_HISTORY_MAX = 30;
    let previousItemStatuses = {};

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

    function recordSpeed(itemId, speed) {
      if (!itemId) return;
      if (!speedHistory[itemId]) speedHistory[itemId] = [];
      speedHistory[itemId].push(Number(speed || 0));
      if (speedHistory[itemId].length > SPEED_HISTORY_MAX) speedHistory[itemId].shift();
    }

    function renderSparkline(itemId) {
      const data = speedHistory[itemId];
      if (!data || data.length < 2) return '';
      const max = Math.max(...data, 1);
      const w = 120, h = 28;
      const step = w / (data.length - 1);
      const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
      return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px;" viewBox="0 0 ${w} ${h}">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
      </svg>`;
    }

    const globalSpeedHistory = [];
    const GLOBAL_SPEED_MAX = 40;

    function recordGlobalSpeed(speed) {
      globalSpeedHistory.push(Number(speed || 0));
      if (globalSpeedHistory.length > GLOBAL_SPEED_MAX) globalSpeedHistory.shift();
    }

    function renderGlobalSparkline() {
      const el = document.getElementById('global-speed-chart');
      if (!el) return;
      const data = globalSpeedHistory;
      if (data.length < 2) { el.innerHTML = ''; return; }
      const max = Math.max(...data, 1);
      const w = 200, h = 40;
      const step = w / (data.length - 1);
      const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`).join(' ');
      const peakLabel = formatRate(max);
      el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
      </svg><span style="font-size:0.78rem;color:var(--muted);">peak ${peakLabel}</span>`;
    }

    function checkNotifications(items) {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      items.forEach((item) => {
        const id = item.id || item.url || '';
        const status = (item.status || '').toLowerCase();
        const prev = previousItemStatuses[id];
        if (prev && prev !== status) {
          if (status === 'done') {
            new Notification('Download complete', { body: shortName(item.output || item.url || ''), tag: `ariaflow-${id}` });
          } else if (status === 'error' || status === 'failed') {
            new Notification('Download failed', { body: shortName(item.output || item.url || '') + (item.error_message ? ` — ${item.error_message}` : ''), tag: `ariaflow-${id}` });
          }
        }
        previousItemStatuses[id] = status;
      });
    }

    function initNotifications() {
      if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
      // Browser requires a user gesture to prompt — attach to first click
      const handler = () => {
        Notification.requestPermission();
        document.removeEventListener('click', handler);
      };
      document.addEventListener('click', handler);
    }

    function setQueueFilter(filter) {
      queueFilter = filter;
      document.querySelectorAll('#queue-filters .filter-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });
      renderFilteredQueue();
    }
    function setQueueSearch(value) {
      queueSearch = (value || '').toLowerCase();
      renderFilteredQueue();
    }
    function filterQueueItems(items) {
      let filtered = items;
      if (queueFilter !== 'all') {
        filtered = filtered.filter((item) => {
          const status = (item.status || 'unknown').toLowerCase();
          const normalized = status === 'recovered' ? 'paused' : status;
          if (queueFilter === 'downloading') return ['downloading', 'active'].includes(normalized);
          return normalized === queueFilter;
        });
      }
      if (queueSearch) {
        filtered = filtered.filter((item) => {
          const url = (item.url || '').toLowerCase();
          const output = (item.output || '').toLowerCase();
          const liveUrl = (item.live?.url || '').toLowerCase();
          return url.includes(queueSearch) || output.includes(queueSearch) || liveUrl.includes(queueSearch);
        });
      }
      return filtered;
    }
    function renderFilteredQueue() {
      if (!lastStatus) return;
      const state = lastStatus.state || {};
      const active = lastStatus.active || null;
      const actives = Array.isArray(lastStatus.actives) ? lastStatus.actives : (lastStatus.active ? [lastStatus.active] : []);
      const items = enrichQueueItems(lastStatus.items || [], actives, state);
      const filtered = filterQueueItems(items);
      document.getElementById('queue').innerHTML = filtered.length
        ? filtered.map(renderQueueItem).join("")
        : `<div class='item'>No ${queueFilter === 'all' ? '' : queueFilter + ' '}items.</div>`;
      updateFilterCounts(items);
    }
    function updateFilterCounts(items) {
      const counts = { all: items.length, queued: 0, downloading: 0, paused: 0, done: 0, error: 0 };
      items.forEach((item) => {
        const status = ((item.status || 'unknown') === 'recovered' ? 'paused' : (item.status || 'unknown')).toLowerCase();
        if (status === 'queued') counts.queued++;
        else if (['downloading', 'active'].includes(status)) counts.downloading++;
        else if (status === 'paused') counts.paused++;
        else if (status === 'done') counts.done++;
        else if (status === 'error') counts.error++;
      });
      document.querySelectorAll('#queue-filters .filter-btn').forEach((btn) => {
        const f = btn.dataset.filter;
        const count = counts[f] ?? 0;
        const label = f.charAt(0).toUpperCase() + f.slice(1);
        btn.textContent = count > 0 ? `${label} (${count})` : label;
      });
    }
    const path = window.location.pathname.replace(/[/]+$/, "");
    const page = path === "/bandwidth"
      ? "bandwidth"
      : path === "/lifecycle"
        ? "lifecycle"
        : path === "/options"
          ? "options"
          : path === "/log"
            ? "log"
            : path === "/dev"
              ? "dev"
              : "dashboard";

    function applyPage() {
      document.body.classList.add(`page-${page}`);
      document.querySelectorAll('.nav a').forEach((link) => {
        link.classList.toggle('active', link.dataset.page === page);
      });
      if (page === 'dashboard') {
        document.querySelectorAll('.show-dashboard').forEach((el) => el.style.display = '');
      } else if (page === 'bandwidth') {
        document.querySelectorAll('.show-bandwidth').forEach((el) => el.style.display = '');
      } else if (page === 'lifecycle') {
        document.querySelectorAll('.show-lifecycle').forEach((el) => el.style.display = '');
      } else if (page === 'options') {
        document.querySelectorAll('.show-options').forEach((el) => el.style.display = '');
      } else if (page === 'log') {
        document.querySelectorAll('.show-log').forEach((el) => el.style.display = '');
      } else if (page === 'dev') {
        document.querySelectorAll('.show-dev').forEach((el) => el.style.display = '');
      }
    }

    function applyTheme(theme) {
      const root = document.documentElement;
      const saved = theme || 'system';
      const next = saved === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : saved;
      root.dataset.theme = next;
      localStorage.setItem('ariaflow.theme', saved);
      const btn = document.getElementById('theme-btn');
      if (btn) btn.textContent = saved === 'system' ? 'Theme: system' : `Theme: ${saved}`;
    }

    function initTheme() {
      const saved = localStorage.getItem('ariaflow.theme') || 'system';
      applyTheme(saved);
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const sync = () => {
        if ((localStorage.getItem('ariaflow.theme') || 'system') === 'system') {
          applyTheme('system');
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', sync);
      else if (mq.addListener) mq.addListener(sync);
    }

    const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";

    function loadBackendState() {
      let backends = [];
      try {
        backends = JSON.parse(localStorage.getItem('ariaflow.backends') || '[]');
      } catch (err) {
        backends = [];
      }
      backends = [...new Set(backends.map((item) => String(item || '').trim()).filter((item) => item && item !== DEFAULT_BACKEND_URL))];
      const selected = (localStorage.getItem('ariaflow.selected_backend') || '').trim();
      return {
        backends,
        selected: selected === DEFAULT_BACKEND_URL || backends.includes(selected) ? selected : DEFAULT_BACKEND_URL,
      };
    }

    function saveBackendState(backends, selected) {
      const clean = [...new Set((backends || []).map((item) => String(item || '').trim()).filter((item) => item && item !== DEFAULT_BACKEND_URL))];
      const nextSelected = selected === DEFAULT_BACKEND_URL || clean.includes(selected) ? selected : DEFAULT_BACKEND_URL;
      localStorage.setItem('ariaflow.backends', JSON.stringify(clean));
      localStorage.setItem('ariaflow.selected_backend', nextSelected);
      renderBackendPanel();
    }

    function mergeDiscoveredBackends(items) {
      const discovered = Array.isArray(items)
        ? items.map((item) => String(item?.url || '').trim()).filter((item) => item && item !== DEFAULT_BACKEND_URL)
        : [];
      if (!discovered.length) return;
      const state = loadBackendState();
      const merged = [...new Set([...state.backends, ...discovered])];
      saveBackendState(merged, state.selected || DEFAULT_BACKEND_URL);
    }

    function apiPath(path) {
      const backend = loadBackendState().selected || DEFAULT_BACKEND_URL;
      const u = new URL(path, window.location.origin);
      u.searchParams.set('backend', backend);
      return `${u.pathname}${u.search}`;
    }

    function renderBackendPanel() {
      const panel = document.getElementById('backend-panel');
      if (!panel) return;
      const { backends, selected } = loadBackendState();
      const localLabel = DEFAULT_BACKEND_URL;
      const renderManual = (backend) => {
        const encoded = encodeURIComponent(backend);
        return `
          <span class="chip">
            <button class="${backend === selected ? '' : 'secondary'}" onclick="selectBackend(decodeURIComponent('${encoded}'))">${backend}</button>
            <button class="secondary icon-btn" onclick="removeBackend(decodeURIComponent('${encoded}'))" title="Remove backend" aria-label="Remove backend">×<span class="sr-only">Remove backend</span></button>
          </span>
        `;
      };
      panel.innerHTML = `
        <button class="${selected === DEFAULT_BACKEND_URL ? '' : 'secondary'}" onclick="selectBackend('${DEFAULT_BACKEND_URL}')">${localLabel}</button>
        ${backends.map(renderManual).join('')}
      `;
      const input = document.getElementById('backend-input');
      if (input && !input.value) input.value = selected === DEFAULT_BACKEND_URL ? '' : selected;
    }

    function selectBackend(backend) {
      const state = loadBackendState();
      if (!state.backends.includes(backend)) state.backends.push(backend);
      saveBackendState(state.backends, backend);
      refresh();
      if (page === 'lifecycle') loadLifecycle();
      if (page === 'log') refreshActionLog();
    }

    function addBackend() {
      const input = document.getElementById('backend-input');
      const value = (input?.value || '').trim();
      if (!value) return;
      const state = loadBackendState();
      if (value !== DEFAULT_BACKEND_URL && !state.backends.includes(value)) state.backends.push(value);
      saveBackendState(state.backends, value);
      if (input) input.value = '';
      refresh();
    }

    function removeBackend(backend) {
      const state = loadBackendState();
      saveBackendState(state.backends.filter((item) => item !== backend), state.selected === backend ? DEFAULT_BACKEND_URL : state.selected);
      refresh();
    }

    async function discoverBackends() {
      const r = await fetch('/api/discovery');
      const data = await r.json();
      lastResult = data;
      mergeDiscoveredBackends(data.items || []);
      document.getElementById('result').textContent = Array.isArray(data.items) && data.items.length
        ? `Discovered ${data.items.length} backend service(s)`
        : 'No Bonjour backends discovered';
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }

    function toggleTheme() {
      const current = localStorage.getItem('ariaflow.theme') || 'system';
      const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
      applyTheme(next);
    }
    function syncRefreshControl() {
      const el = document.getElementById('refresh-interval');
      if (!el) return;
      const value = String(Number(refreshInterval || 10000) || 10000);
      if (el.value !== value) el.value = value;
    }
    function getDeclarationPreference(name) {
      const prefs = lastDeclaration?.uic?.preferences || [];
      const pref = prefs.find((item) => item.name === name);
      return pref ? pref.value : undefined;
    }
    function renderOptionCard(title, value, hint, widget) {
      return `
        <div class="item">
          <div class="item-top">
            <div class="item-url">${title}</div>
            ${widget || `<span class="badge">${value ?? '-'}</span>`}
          </div>
          <div class="meta"><span>${hint}</span></div>
        </div>
      `;
    }
    function renderBandwidthConfigPanel(declaration) {
      const prefs = declaration?.uic?.preferences || [];
      const freePercent = prefs.find((item) => item.name === 'bandwidth_free_percent');
      const freeAbsolute = prefs.find((item) => item.name === 'bandwidth_free_absolute_mbps');
      const floor = prefs.find((item) => item.name === 'bandwidth_floor_mbps');
      const dedup = prefs.find((item) => item.name === 'duplicate_active_transfer_action');
      const concurrency = prefs.find((item) => item.name === 'max_simultaneous_downloads');
      return [
        renderOptionCard(
          'Min free bandwidth (%)',
          `${Number(freePercent?.value ?? 20)}%`,
          'Reserve this percentage of measured bandwidth. Downloads are capped to use only the remainder. Default: 20%.',
          `<label class="refresh-control" style="justify-content:flex-start;">
            <input type="number" min="0" max="90" step="1" value="${Number(freePercent?.value ?? 20)}" oninput="setBandwidthPref('bandwidth_free_percent', Number(this.value), 20)" style="width:80px; padding:0 8px; height:32px;">
            <span>%</span>
          </label>`
        ),
        renderOptionCard(
          'Min free bandwidth (absolute)',
          `${Number(freeAbsolute?.value ?? 0)} Mbps`,
          'Always reserve at least this many Mbps regardless of probe result. Default: 0 Mbps.',
          `<label class="refresh-control" style="justify-content:flex-start;">
            <input type="number" min="0" step="0.5" value="${Number(freeAbsolute?.value ?? 0)}" oninput="setBandwidthPref('bandwidth_free_absolute_mbps', Number(this.value), 0)" style="width:100px; padding:0 8px; height:32px;">
            <span>Mbps</span>
          </label>`
        ),
        renderOptionCard(
          'Bandwidth floor',
          `${Number(floor?.value ?? 2)} Mbps`,
          'Minimum download cap when no probe is available. Default: 2 Mbps.',
          `<label class="refresh-control" style="justify-content:flex-start;">
            <input type="number" min="0.5" step="0.5" value="${Number(floor?.value ?? 2)}" oninput="setBandwidthPref('bandwidth_floor_mbps', Number(this.value), 2)" style="width:100px; padding:0 8px; height:32px;">
            <span>Mbps</span>
          </label>`
        ),
        renderOptionCard(
          'Simultaneous downloads',
          `${Number(concurrency?.value || 1)} job${Number(concurrency?.value || 1) === 1 ? '' : 's'}`,
          'Limit how many downloads ariaflow may keep active at once. Default is 1 for sequential downloads.',
          `<label class="refresh-control" style="justify-content:flex-start;">
            <span>Max</span>
            <input type="number" min="1" step="1" value="${Number(concurrency?.value || 1)}" oninput="setSimultaneousLimit(this.value)" style="width:110px; padding:0 8px; height:32px;">
            <span>jobs</span>
          </label>`
        ),
        renderOptionCard(
          'Duplicate active transfer',
          dedup?.value || 'remove',
          'When aria2 exposes duplicate active jobs for the same URL, choose the action.',
          `<select onchange="setDuplicateAction(this.value)">
            <option value="remove" ${dedup?.value === 'remove' ? 'selected' : ''}>Remove duplicates</option>
            <option value="pause" ${dedup?.value === 'pause' ? 'selected' : ''}>Pause duplicates</option>
            <option value="ignore" ${dedup?.value === 'ignore' ? 'selected' : ''}>Ignore duplicates</option>
          </select>`
        ),
      ].join('');
    }
    function renderOptionsPanel(declaration) {
      const prefs = declaration?.uic?.preferences || [];
      const autoPreflight = prefs.find((item) => item.name === 'auto_preflight_on_run');
      const postAction = prefs.find((item) => item.name === 'post_action_rule');
      return [
        renderOptionCard(
          'Auto preflight',
          autoPreflight?.value ? 'enabled' : 'disabled',
          'Run UIC preflight automatically before starting the queue.',
          `<label class="refresh-control"><input type="checkbox" ${autoPreflight?.value ? 'checked' : ''} onchange="setAutoPreflightPreference(this.checked)">Toggle</label>`
        ),
        renderOptionCard(
          'Post-action rule',
          postAction?.value || 'pending',
          'Placeholder policy used after a download finishes.',
          `<select onchange="setPostActionRule(this.value)">
            <option value="pending" ${postAction?.value === 'pending' ? 'selected' : ''}>Pending</option>
          </select>`
        ),
      ].join('');
    }
    function syncDeclarationUi() {
      const enabled = !!getDeclarationPreference('auto_preflight_on_run');
      document.querySelectorAll('input[type="checkbox"][onchange="setAutoPreflightPreference(this.checked)"]').forEach((input) => {
        input.checked = enabled;
      });
      const declarationBox = document.getElementById('declaration');
      if (declarationBox && lastDeclaration) declarationBox.value = JSON.stringify(lastDeclaration, null, 2);
    }
    async function setAutoPreflightPreference(enabled) {
      const r = await fetch(apiPath('/api/declaration'));
      const data = await r.json();
      const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
      const idx = prefs.findIndex((item) => item.name === 'auto_preflight_on_run');
      const next = { name: 'auto_preflight_on_run', value: !!enabled, options: [true, false], rationale: 'default off' };
      if (idx >= 0) prefs[idx] = next;
      else prefs.push(next);
      data.uic = data.uic || {};
      data.uic.preferences = prefs;
      const save = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      lastDeclaration = await save.json();
      syncDeclarationUi();
      const options = document.getElementById('options-panel');
      if (options) options.innerHTML = renderOptionsPanel(lastDeclaration);
      syncDeclarationUi();
    }
    async function setDuplicateAction(value) {
      const r = await fetch(apiPath('/api/declaration'));
      const data = await r.json();
      const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
      const idx = prefs.findIndex((item) => item.name === 'duplicate_active_transfer_action');
      const next = { name: 'duplicate_active_transfer_action', value: value, options: ['remove', 'pause', 'ignore'], rationale: 'remove duplicate live jobs by default' };
      if (idx >= 0) prefs[idx] = next;
      else prefs.push(next);
      data.uic = data.uic || {};
      data.uic.preferences = prefs;
      const save = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      lastDeclaration = await save.json();
      syncDeclarationUi();
      const options = document.getElementById('options-panel');
      if (options) options.innerHTML = renderOptionsPanel(lastDeclaration);
      syncDeclarationUi();
    }
    async function setSimultaneousLimit(value) {
      const r = await fetch(apiPath('/api/declaration'));
      const data = await r.json();
      const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
      const idx = prefs.findIndex((item) => item.name === 'max_simultaneous_downloads');
      const limit = Math.max(1, parseInt(value, 10) || 1);
      const next = { name: 'max_simultaneous_downloads', value: limit, options: [1], rationale: '1 preserves the sequential default' };
      if (idx >= 0) prefs[idx] = next;
      else prefs.push(next);
      data.uic = data.uic || {};
      data.uic.preferences = prefs;
      const save = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      lastDeclaration = await save.json();
      syncDeclarationUi();
      const options = document.getElementById('options-panel');
      if (options) options.innerHTML = renderOptionsPanel(lastDeclaration);
      syncDeclarationUi();
    }
    async function setBandwidthPref(name, value, defaultValue) {
      const r = await fetch(apiPath('/api/declaration'));
      const data = await r.json();
      const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
      const idx = prefs.findIndex((item) => item.name === name);
      const next = { name, value: value, options: [defaultValue], rationale: `default ${defaultValue}` };
      if (idx >= 0) prefs[idx] = next;
      else prefs.push(next);
      data.uic = data.uic || {};
      data.uic.preferences = prefs;
      const save = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      lastDeclaration = await save.json();
      const bwConfig = document.getElementById('bw-config-panel');
      if (bwConfig) bwConfig.innerHTML = renderBandwidthConfigPanel(lastDeclaration);
    }
    async function runProbe() {
      const badge = document.getElementById('bw-source');
      if (badge) badge.textContent = 'probing...';
      const r = await fetch(apiPath('/api/bandwidth/probe'), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      await refreshBandwidth();
      await refresh();
    }
    async function refreshBandwidth() {
      try {
        const r = await fetch(apiPath('/api/bandwidth'));
        const data = await r.json();
        if (data && data.ok !== false) {
          lastStatus = lastStatus || {};
          lastStatus.bandwidth = data;
        }
        updateBandwidthPanel();
      } catch (e) {}
    }
    function updateBandwidthPanel() {
      const bw = lastStatus?.bandwidth || {};
      document.getElementById('bw-interface').textContent = bw.interface_name || 'unknown';
      document.getElementById('bw-interface-detail').textContent = bw.interface_name
        ? `Active network interface: ${bw.interface_name}`
        : 'Interface not detected';
      document.getElementById('bw-source').textContent = bw.source || '-';
      document.getElementById('bw-down').textContent = bw.source === 'networkquality'
        ? `Downlink ${formatMbps(bw.downlink_mbps)}${bw.partial ? ' (partial)' : ''}`
        : `No probe available${bw.reason ? ` · ${bw.reason}` : ''}`;
      document.getElementById('bw-down-badge').textContent = bw.downlink_mbps ? formatMbps(bw.downlink_mbps) : '-';
      document.getElementById('bw-down-detail').textContent = bw.downlink_mbps
        ? `Measured downlink: ${formatMbps(bw.downlink_mbps)}${bw.partial ? ' (partial capture)' : ''}`
        : 'No downlink measurement available';
      document.getElementById('bw-up-badge').textContent = bw.uplink_mbps ? formatMbps(bw.uplink_mbps) : '-';
      document.getElementById('bw-up-detail').textContent = bw.uplink_mbps
        ? `Measured uplink: ${formatMbps(bw.uplink_mbps)}`
        : 'No uplink measurement available';
      document.getElementById('bw-cap').textContent = bw.cap_mbps ? humanCap(formatMbps(bw.cap_mbps)) : humanCap(bw.limit || '-');
      document.getElementById('bw-global').textContent = `Configured limit ${humanCap(bw.limit || '-')}`;
      document.getElementById('bw-probe-mode').textContent = bw.source || '-';
      document.getElementById('bw-probe-detail').textContent = bw.source === 'networkquality'
        ? `Measured ${formatMbps(bw.downlink_mbps)} down${bw.uplink_mbps ? `, ${formatMbps(bw.uplink_mbps)} up` : ''}, capped at ${formatMbps(bw.cap_mbps)}${bw.partial ? ' from partial output' : ''}`
        : 'Using default floor because no probe was available';
    }
    async function setPostActionRule(value) {
      const r = await fetch(apiPath('/api/declaration'));
      const data = await r.json();
      const prefs = Array.isArray(data?.uic?.preferences) ? data.uic.preferences : [];
      const idx = prefs.findIndex((item) => item.name === 'post_action_rule');
      const next = { name: 'post_action_rule', value: value, options: ['pending'], rationale: 'default placeholder' };
      if (idx >= 0) prefs[idx] = next;
      else prefs.push(next);
      data.uic = data.uic || {};
      data.uic.preferences = prefs;
      const save = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) });
      lastDeclaration = await save.json();
      const options = document.getElementById('options-panel');
      if (options) options.innerHTML = renderOptionsPanel(lastDeclaration);
    }
    function setRefreshInterval(value) {
      refreshInterval = Number(value) || 0;
      localStorage.setItem('ariaflow.refresh_interval', String(refreshInterval));
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (refreshInterval > 0) {
        refreshTimer = setInterval(refresh, refreshInterval);
      }
    }

    function badgeClass(status) {
      if (["done", "converged", "ok", "complete"].includes(status)) return "badge good";
      if (["error", "failed", "missing"].includes(status)) return "badge bad";
      if (["paused", "queued", "unchanged", "skipped"].includes(status)) return "badge warn";
      return "badge";
    }
    function formatBytes(value) {
      if (value == null) return "-";
      let size = Number(value);
      const units = ["B", "KiB", "MiB", "GiB", "TiB"];
      for (const unit of units) {
        if (Math.abs(size) < 1024 || unit === units[units.length - 1]) {
          return unit === "B" ? `${Math.round(size)} ${unit}` : `${size.toFixed(1)} ${unit}`;
        }
        size /= 1024;
      }
      return `${size.toFixed(1)} TiB`;
    }
    function formatRate(value) {
      if (value == null) return "-";
      return `${formatBytes(value)}/s`;
    }
    function formatMbps(value) {
      if (value == null) return "-";
      return `${value} Mbps`;
    }
    function humanCap(value) {
      if (value == null) return "-";
      const text = String(value).trim();
      if (!text || text === "0" || text === "0M" || text === "0 Mbps" || text === "0 Mbps/s") return "unlimited";
      return text;
    }
    function activeStateLabel(active, state) {
      if (state?.paused && active?.recovered) return "paused";
      if (state?.paused) return "paused";
      if (active?.recovered) return active.status ? active.status : "recovered";
      if (active?.status) return active.status;
      if (state?.running) return "running";
      return "idle";
    }
    function activeDisplayName(active, items) {
      const match = (items || []).find((item) => active?.gid && item.gid === active.gid);
      const url = active?.url || match?.url || "";
      const name = shortName(url || active?.gid || "none");
      return { name, url };
    }
    function summarizeActiveItem(active, state, items) {
      const display = activeDisplayName(active, items);
      const name = display.name;
      if (state?.paused && active?.recovered) return name;
      if (active?.recovered) return name;
      if (active?.status && active?.status !== "idle") return `${active.status} · ${name}`;
      if (state?.running) return name;
      return "none";
    }
    function sessionLabel(state) {
      if (state?.session_id && !state?.session_closed_at) return `current ${String(state.session_id).slice(0, 8)}`;
      if (state?.session_id && state?.session_closed_at) return `closed ${String(state.session_id).slice(0, 8)}`;
      return "-";
    }
    function runnerStateLabel(state, reachable=true) {
      if (!reachable) return 'offline';
      return state?.running ? 'running' : 'idle';
    }
    function queueStateLabel(state, items, active) {
      if (!state?.running) return 'waiting for engine';
      if (state?.paused) return 'paused';
      if (active && active.status && active.status !== 'idle') return active.status;
      if ((items || []).length) return 'ready';
      return 'idle';
    }
    function sessionStateLabel(state) {
      if (state?.session_id && !state?.session_closed_at) return 'open';
      if (state?.session_id && state?.session_closed_at) return 'closed';
      return 'none';
    }
    function timestampLabel(value) {
      return value || '-';
    }
    function backendUnavailableLabel(data) {
      const error = data?.backend?.error || data?.error || 'backend unavailable';
      return `Backend unavailable · ${error}`;
    }
    function enrichQueueItems(items, active, state) {
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
    }
    function renderQueueItem(item) {
      const status = item.status || "unknown";
      const normalizedStatus = status === 'recovered' ? 'paused' : status;
      const detail = [
        item.created_at ? `Created ${item.created_at}` : null,
        item.gid ? `GID ${item.gid}` : null,
      ].filter(Boolean).join(" · ");
      const live = item.live || {};
      const shortUrl = shortName(item.output || item.url || live.url || '(no url)');
      const activeish = ["downloading", "paused", "recovered"].includes(status) || item.recovered;
      const liveStatus = live.status || null;
      const speed = live.downloadSpeed || item.downloadSpeed;
      const totalLength = live.totalLength || item.totalLength;
      const completedLength = live.completedLength || item.completedLength;
      const progress = live.percent != null ? live.percent : item.percent;
      const computedProgress = progress != null
        ? progress
        : (Number(totalLength || 0) > 0 ? (Number(completedLength || 0) / Number(totalLength || 1)) * 100 : 0);
      const displayUrl = item.url || live.url || "";
      const ariaBadge = liveStatus ? `<span class="badge ${badgeClass(liveStatus)}">aria2: ${escapeHtml(liveStatus)}</span>` : "";
      const showTransferPanel = activeish || totalLength || completedLength || progress != null;
      const rateLabel = speed
        ? formatRate(speed)
        : normalizedStatus === 'paused'
          ? 'paused'
          : 'idle';
      const recoveredMeta = item.recovered_at ? `<span>Recovered ${escapeHtml(item.recovered_at)}</span>` : "";
      const eta = formatEta(totalLength, completedLength, speed);
      if (item.id && activeish) recordSpeed(item.id, speed || 0);
      const sparkline = item.id ? renderSparkline(item.id) : '';
      const activePanel = showTransferPanel ? `
        <div class="meter"><div style="width:${Math.round(Number(computedProgress || 0))}%"></div></div>
        <div class="statusline">
          <span>${Math.round(Number(computedProgress || 0))}% done${eta ? ` · ETA ${eta}` : ''}</span>
          <span>${rateLabel}</span>
        </div>
        <div class="meta">
          ${totalLength ? `<span>Total ${formatBytes(totalLength)}</span>` : ""}
          ${completedLength ? `<span>Done ${formatBytes(completedLength)}</span>` : ""}
          ${recoveredMeta}
          ${item.error_message ? `<span class="mono">${escapeHtml(item.error_message)}</span>` : ""}
        </div>
        ${sparkline}
      ` : "";
      const stateLabel = liveStatus ? `${escapeHtml(normalizedStatus)} · aria2:${escapeHtml(liveStatus)}` : escapeHtml(normalizedStatus);
      const itemId = item.id || '';
      const safeItemId = escapeHtml(itemId);
      const canPause = normalizedStatus === 'downloading';
      const canResume = normalizedStatus === 'paused';
      const canRetry = ['error', 'failed', 'stopped'].includes(normalizedStatus);
      const actionBtns = safeItemId ? `
        <div class="action-strip" style="margin-top:8px;">
          ${canPause ? `<button class="secondary icon-btn" onclick="itemAction('${safeItemId}','pause')" title="Pause">&#9646;&#9646;<span class="sr-only">Pause</span></button>` : ''}
          ${canResume ? `<button class="secondary icon-btn" onclick="itemAction('${safeItemId}','resume')" title="Resume">&#9654;<span class="sr-only">Resume</span></button>` : ''}
          ${canRetry ? `<button class="secondary icon-btn" onclick="itemAction('${safeItemId}','retry')" title="Retry">&#8635;<span class="sr-only">Retry</span></button>` : ''}
          <button class="secondary icon-btn" onclick="itemAction('${safeItemId}','remove')" title="Remove">&#10005;<span class="sr-only">Remove</span></button>
        </div>
      ` : '';
      return `
        <div class="item compact ${activeish ? 'active-item' : ''}">
        <div class="item-top">
          <div class="item-url">${escapeHtml(shortUrl)}</div>
          <span class="${badgeClass(normalizedStatus)}">${stateLabel}</span>
        </div>
        <div class="meta">
          ${ariaBadge}
          ${displayUrl ? `<span title="${escapeHtml(displayUrl)}">${escapeHtml(displayUrl)}</span>` : ""}
          ${detail ? `<span class="mono">${escapeHtml(detail)}</span>` : ""}
        </div>
          ${activePanel}
          ${actionBtns}
        </div>
      `;
    }
    function shortName(value) {
      if (!value) return "(no name)";
      try {
        const url = new URL(value);
        const parts = url.pathname.split("/").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : url.hostname;
      } catch (err) {
        const parts = value.split("/").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : value;
      }
    }
    function activeTransfer(items, active, state) {
      const liveItems = Array.isArray(items) ? items : [];
      return liveItems.find((item) => item && (item.gid === active?.gid || (state?.active_gid && item.gid === state.active_gid) || (active?.url && item.url && active.url === item.url)))
        || active
        || null;
    }
    function lifecycleStateLabel(name, record) {
      const result = record && record.result ? record.result : {};
      const reason = result.reason || "";
      if (name === "ariaflow") {
        if (reason === "match") return "installed · current";
        if (reason === "missing") return "absent";
        return result.outcome || "unknown";
      }
      if (name === "aria2") {
        if (reason === "match") return "installed · current";
        if (reason === "missing") return "absent";
        return result.outcome || "unknown";
      }
      if (name === "networkquality") {
        if (reason === "ready") return "installed · usable";
        if (reason === "timeout" || reason === "probe_timeout_no_parse" || reason === "probe_timeout_partial_capture") return "installed · probe timeout";
        if (reason === "no_output" || reason === "probe_no_parse") return "installed · no parse";
        if (reason === "missing") return "absent";
        if (reason === "error" || reason === "probe_error") return "installed · error";
        return result.outcome || "unknown";
      }
      if (reason === "match") return "loaded";
      if (reason === "missing") return "not loaded";
      return result.outcome || "unknown";
    }
    function renderLifecycleItem(name, record, actions = []) {
      const result = record && record.result ? record.result : {};
      const lines = [];
      if (result.message) lines.push(escapeHtml(result.message));
      if (result.reason) lines.push(`Reason: ${escapeHtml(result.reason)}`);
      if (result.completion) lines.push(`Completion: ${escapeHtml(result.completion)}`);
      const buttons = actions.length ? `
        <div class="action-strip" style="justify-content:flex-start; margin-top:8px;">
          ${actions.map((action) => `<button class="secondary icon-btn" onclick="lifecycleAction('${escapeHtml(action.target)}','${escapeHtml(action.action)}')" title="${escapeHtml(action.label)}">${escapeHtml(action.label)}</button>`).join("")}
        </div>
      ` : "";
      return `
        <div class="item">
          <div class="item-top">
            <div class="item-url">${escapeHtml(name)}</div>
            <span class="${badgeClass(result.outcome)}">${escapeHtml(lifecycleStateLabel(name, record))}</span>
          </div>
          <div class="meta">
            <span>${lines.join(" · ") || "No details"}</span>
          </div>
          ${buttons}
        </div>
      `;
    }
    function renderLifecycleSummary(data) {
      const rows = [
        {
          name: "ariaflow",
          record: data.ariaflow,
          actions: [
            { target: "ariaflow", action: "install", label: "Install / Update" },
            { target: "ariaflow", action: "uninstall", label: "Remove" },
          ],
        },
        {
          name: "aria2",
          record: data.aria2,
          actions: [],
        },
        {
          name: "networkquality",
          record: data.networkquality,
          actions: [],
        },
        {
          name: "aria2 auto-start (advanced)",
          record: data["aria2-launchd"],
          actions: [
            { target: "aria2-launchd", action: "install", label: "Load" },
            { target: "aria2-launchd", action: "uninstall", label: "Unload" },
          ],
        },
      ];
      const session = data?.session_id ? `
        <div class="item" style="margin-bottom:12px;">
          <div class="item-top">
            <div class="item-url">Run</div>
            <span class="badge ${data.session_closed_at ? 'warn' : 'good'}">${data.session_closed_at ? 'closed' : 'current'}</span>
          </div>
          <div class="meta"><span class="mono">${escapeHtml(data.session_id)}</span></div>
          <div class="meta">
            <span>${data.session_started_at ? `Started ${escapeHtml(data.session_started_at)}` : 'Start time unknown'}</span>
            <span>${data.session_last_seen_at ? `Last seen ${escapeHtml(data.session_last_seen_at)}` : 'Last seen unknown'}</span>
            ${data.session_closed_at ? `<span>Closed ${escapeHtml(data.session_closed_at)}${data.session_closed_reason ? ` · ${escapeHtml(data.session_closed_reason)}` : ''}</span>` : ""}
          </div>
        </div>
      ` : "";
      return `${session}${rows.map((row) => renderLifecycleItem(row.name, row.record, row.actions)).join("")}`;
    }
    function renderQueueSummary(summary) {
      document.getElementById('sum-queued').textContent = summary?.queued ?? 0;
      document.getElementById('sum-done').textContent = summary?.done ?? 0;
      document.getElementById('sum-error').textContent = summary?.error ?? 0;
    }
    function renderPreflight(data) {
      const gates = (data.gates || []).map((gate) => `
        <div class="item">
          <div class="item-top">
            <div class="item-url">${escapeHtml(gate.name)}</div>
            <span class="${gate.satisfied ? 'badge good' : 'badge bad'}">${gate.satisfied ? 'ready' : 'blocked'}</span>
          </div>
          <div class="meta"><span>${escapeHtml(gate.class || 'gate')} · ${escapeHtml(gate.blocking || 'unknown')}</span></div>
        </div>
      `).join("");
      const warnings = (data.warnings || []).map((warning) => `
        <div class="item">
          <div class="item-top">
            <div class="item-url">${escapeHtml(warning.name)}</div>
            <span class="badge warn">warning</span>
          </div>
          <div class="meta"><span>${escapeHtml(warning.message)}</span></div>
        </div>
      `).join("");
      const failures = (data.hard_failures || []).map((failure) => `
        <div class="item">
          <div class="item-top">
            <div class="item-url">${escapeHtml(failure)}</div>
            <span class="badge bad">blocked</span>
          </div>
        </div>
      `).join("");
      return `
        ${gates || "<div class='item'>No gates defined.</div>"}
        ${warnings ? `<div class='item'><div class='item-url' style='margin-bottom:8px;'>Warnings</div>${warnings}</div>` : ""}
        ${failures ? `<div class='item'><div class='item-url' style='margin-bottom:8px;'>Hard failures</div>${failures}</div>` : ""}
      `;
    }
    function renderContractTrace(data) {
      if (!data) return "Idle";
      const result = data.result || {};
      const preflight = data.preflight || {};
      const lines = [
        `Contract: ${escapeHtml(data.meta?.contract || "unknown")} v${escapeHtml(data.meta?.version || "-")}`,
        `Outcome: ${escapeHtml(result.outcome || "unknown")}`,
        `Observation: ${escapeHtml(result.observation || "unknown")}`,
        result.message ? `Message: ${escapeHtml(result.message)}` : null,
        result.reason ? `Reason: ${escapeHtml(result.reason)}` : null,
        preflight.status ? `Preflight: ${escapeHtml(preflight.status)}` : null,
      ].filter(Boolean);
      return `
        <div class="item">
          <div class="item-top">
            <div class="item-url">UCC execution</div>
            <span class="${badgeClass(result.outcome)}">${escapeHtml(result.outcome || "unknown")}</span>
          </div>
          <div class="meta"><span>${lines.join(" · ")}</span></div>
        </div>
      `;
    }
    function sanitizeLogValue(value, depth = 0) {
      if (value == null) return value;
      if (depth >= 2) return '[trimmed]';
      if (Array.isArray(value)) {
        if (!value.length) return [];
        if (value.length > 4) return [`[${value.length} items]`];
        return value.map((item) => sanitizeLogValue(item, depth + 1));
      }
      if (typeof value !== 'object') return value;
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'bitfield') {
          result[key] = '[trimmed]';
          continue;
        }
        if (key === 'files') {
          const files = Array.isArray(entry) ? entry.length : 0;
          result[key] = `[${files} file${files === 1 ? '' : 's'}]`;
          continue;
        }
        if (key === 'uris') {
          const uris = Array.isArray(entry) ? entry.length : 0;
          result[key] = `[${uris} uri${uris === 1 ? '' : 's'}]`;
          continue;
        }
        result[key] = sanitizeLogValue(entry, depth + 1);
      }
      return result;
    }
    function summarizePollEntry(entry) {
      const detail = entry?.detail || {};
      const status = detail.status || entry?.outcome || 'unknown';
      const gid = detail.gid || '-';
      const done = detail.completedLength ? formatBytes(detail.completedLength) : null;
      const total = detail.totalLength ? formatBytes(detail.totalLength) : null;
      const speed = detail.downloadSpeed ? formatRate(detail.downloadSpeed) : '0 B/s';
      const target = shortName(detail.url || gid);
      const fragments = [
        `Historical poll snapshot`,
        `gid ${gid}`,
        `${status} · ${target}`,
        done && total ? `${done}/${total}` : null,
        `speed ${speed}`,
      ].filter(Boolean);
      return fragments.join(' · ');
    }
    function renderActionLog(entries) {
      if (!entries || !entries.length) return "<div class='item'>No action log yet.</div>";
      const currentFilter = document.getElementById('action-filter')?.value || 'all';
      const currentTarget = document.getElementById('target-filter')?.value || 'all';
      const currentSession = document.getElementById('session-filter')?.value || 'all';
      const sessionId = lastStatus?.state?.session_id || lastLifecycle?.session_id || lastDeclaration?.session_id || null;
      return entries
        .filter((entry) => currentFilter === 'all' ? true : (entry.action || 'unknown') === currentFilter)
        .filter((entry) => currentTarget === 'all' ? true : (entry.target || 'unknown') === currentTarget)
        .filter((entry) => currentSession === 'all' ? true : (currentSession === 'current' ? (sessionId ? entry.session_id === sessionId : false) : true))
        .slice()
        .reverse()
        .map((entry) => {
        const status = entry.outcome || entry.status || "unknown";
        const lines = entry.action === 'poll'
          ? [escapeHtml(summarizePollEntry(entry))]
          : [
          entry.timestamp ? `At ${escapeHtml(entry.timestamp)}` : null,
          entry.session_id ? `Session: ${escapeHtml(entry.session_id)}` : null,
          entry.action ? `Action: ${escapeHtml(entry.action)}` : null,
          entry.target ? `Target: ${escapeHtml(entry.target)}` : null,
          entry.reason ? `Reason: ${escapeHtml(entry.reason)}` : null,
          entry.detail ? `Detail: ${escapeHtml(JSON.stringify(sanitizeLogValue(entry.detail)))}` : null,
          entry.observed_before ? `Before: ${escapeHtml(JSON.stringify(sanitizeLogValue(entry.observed_before)))}` : null,
          entry.observed_after ? `After: ${escapeHtml(JSON.stringify(sanitizeLogValue(entry.observed_after)))}` : null,
          entry.message ? `Message: ${escapeHtml(entry.message)}` : null,
        ].filter(Boolean).join(" · ");
        const hint = entry.action === 'poll' ? 'Historical event' : 'Historical record';
        return `
          <div class="item">
            <div class="item-top">
              <div class="item-url">${escapeHtml(entry.action || "event")}</div>
              <span class="${badgeClass(status)}">${escapeHtml(status)}</span>
            </div>
            <div class="meta"><span>${hint} · ${lines || "No details"}</span></div>
          </div>
        `;
      }).join("");
    }
    let refreshInFlight = false;
    async function refresh() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      try {
        const r = await fetch(apiPath('/api/status'));
        const data = await r.json();
        lastStatus = data;
        if (data?.ok === false || data?.backend?.reachable === false) {
          document.getElementById('queue').innerHTML = `<div class='item'>${backendUnavailableLabel(data)}</div>`;
          document.getElementById('backend-version').textContent = '-';
          document.getElementById('backend-pid').textContent = '-';
          document.getElementById('backend-runner').textContent = 'offline';
          document.getElementById('backend-session').textContent = '-';
          document.getElementById('backend-error').textContent = data?.backend?.error || 'connection refused';
          document.getElementById('backend-startup').textContent = getDeclarationPreference('auto_preflight_on_run') ? 'auto-check' : 'manual';
          document.getElementById('backend-cap').textContent = '-';
          document.getElementById('queue-state').textContent = 'offline';
          document.getElementById('queue-state-badge').textContent = 'offline';
          document.getElementById('queue-detail').textContent = 'Backend unavailable';
          document.getElementById('queue-active').textContent = 'none';
          document.getElementById('queue-speed').textContent = 'idle';
          document.getElementById('session-state').textContent = 'offline';
          document.getElementById('session-detail').textContent = '-';
          document.getElementById('session-started').textContent = '-';
          document.getElementById('session-last-seen').textContent = '-';
          document.getElementById('session-closed').textContent = '-';
          document.getElementById('bw-interface').textContent = 'offline';
          document.getElementById('bw-interface-detail').textContent = backendUnavailableLabel(data);
          document.getElementById('bw-source').textContent = 'offline';
          document.getElementById('bw-down').textContent = backendUnavailableLabel(data);
          document.getElementById('bw-down-badge').textContent = '-';
          document.getElementById('bw-down-detail').textContent = backendUnavailableLabel(data);
          document.getElementById('bw-up-badge').textContent = '-';
          document.getElementById('bw-up-detail').textContent = backendUnavailableLabel(data);
          document.getElementById('bw-cap').textContent = '-';
          document.getElementById('bw-global').textContent = 'Configured limit unavailable';
          document.getElementById('bw-probe-mode').textContent = '-';
          document.getElementById('bw-probe-detail').textContent = backendUnavailableLabel(data);
          document.getElementById('runner-btn').textContent = 'Start engine';
          document.getElementById('toggle-btn').textContent = 'Pause queue';
          renderQueueSummary({ queued: 0, done: 0, error: 0 });
          syncRefreshControl();
          return;
        }
        const state = data.state || {};
        const active = data.active || null;
        const actives = Array.isArray(data.actives) ? data.actives : (data.active ? [data.active] : []);
        const liveActive = activeTransfer(actives, active, state);
        const speed = liveActive?.downloadSpeed || active?.downloadSpeed || data.state?.download_speed || null;
        const items = enrichQueueItems(data.items || [], actives, state);
        checkNotifications(items);
        const filtered = filterQueueItems(items);
        document.getElementById('queue').innerHTML = filtered.length
          ? filtered.map(renderQueueItem).join("")
          : `<div class='item'>No ${queueFilter === 'all' ? '' : queueFilter + ' '}items.</div>`;
        updateFilterCounts(items);
        document.getElementById('backend-version').textContent = data.backend?.version || 'unreported';
        document.getElementById('backend-pid').textContent = data.backend?.pid || 'unreported';
        document.getElementById('backend-error').textContent = state.last_error || data.bandwidth?.reason || 'none';
        document.getElementById('backend-cap').textContent = data.bandwidth?.cap_mbps ? humanCap(formatMbps(data.bandwidth.cap_mbps)) : humanCap(data.bandwidth?.limit || '-');
        document.getElementById('backend-runner').textContent = runnerStateLabel(state);
        document.getElementById('backend-session').textContent = sessionLabel(state);
        const toggleButton = document.getElementById('toggle-btn');
        if (toggleButton) toggleButton.textContent = data.state && data.state.paused ? 'Resume queue' : 'Pause queue';
        const runnerButton = document.getElementById('runner-btn');
        if (runnerButton) runnerButton.textContent = data.state && data.state.running ? 'Stop engine' : 'Start engine';
        document.getElementById('backend-startup').textContent = getDeclarationPreference('auto_preflight_on_run') ? 'auto-check' : 'manual';
        document.getElementById('queue-state').textContent = queueStateLabel(state, items, liveActive);
        document.getElementById('queue-state-badge').textContent = queueStateLabel(state, items, liveActive);
        document.getElementById('queue-detail').textContent = state?.paused ? 'Queue is paused' : (state?.running ? 'Queue can advance' : 'Waiting for engine start');
        document.getElementById('queue-active').textContent = summarizeActiveItem(liveActive, state, items);
        document.getElementById('queue-speed').textContent = speed ? formatRate(speed) : "idle";
        recordGlobalSpeed(speed || 0);
        renderGlobalSparkline();
        document.getElementById('session-state').textContent = sessionStateLabel(state);
        document.getElementById('session-detail').textContent = sessionLabel(state);
        document.getElementById('session-started').textContent = timestampLabel(state.session_started_at);
        document.getElementById('session-last-seen').textContent = timestampLabel(state.session_last_seen_at);
        document.getElementById('session-closed').textContent = state.session_closed_at
          ? `${state.session_closed_at}${state.session_closed_reason ? ` · ${state.session_closed_reason}` : ''}`
          : '-';
        renderQueueSummary(data.summary);
        updateBandwidthPanel();
        syncRefreshControl();
      } finally {
        refreshInFlight = false;
      }
    }
    async function loadLifecycle() {
      const r = await fetch(apiPath('/api/lifecycle'));
      const data = await r.json();
      lastLifecycle = data;
      if (data?.ok === false || data?.backend?.reachable === false) {
        document.getElementById('lifecycle').innerHTML = `<div class='item'>${backendUnavailableLabel(data)}</div>`;
        return;
      }
      document.getElementById('lifecycle').innerHTML = renderLifecycleSummary(data);
    }
    async function pauseQueue() {
      const r = await fetch(apiPath('/api/pause'), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      document.getElementById('result').textContent = data.paused ? "Queue paused" : "Pause requested";
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }
    async function resumeQueue() {
      const r = await fetch(apiPath('/api/resume'), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      document.getElementById('result').textContent = data.resumed ? "Queue resumed" : "Resume requested";
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }
    async function toggleQueue() {
      const paused = lastStatus?.state?.paused
        ?? document.getElementById('toggle-btn')?.textContent?.includes('Resume');
      return paused ? resumeQueue() : pauseQueue();
    }
    async function add() {
      const raw = document.getElementById('url').value.trim();
      const urls = raw.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
      const payload = { items: urls.map((url) => ({ url })) };
      const r = await fetch(apiPath('/api/add'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await r.json();
      lastResult = data;
      if (!r.ok || data.ok === false) {
        document.getElementById('result').textContent = data.message || 'Add request failed';
        document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
        return;
      }
      const queued = Array.isArray(data.added) ? data.added.length : 0;
      document.getElementById('result').textContent = queued > 1
        ? `Queued ${queued} items`
        : `Queued: ${data.added?.[0]?.url || urls[0] || raw}`;
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }
    async function preflightRun() {
      const r = await fetch(apiPath('/api/preflight'), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      document.getElementById('result').textContent = data.status === 'pass' ? "Preflight passed" : "Preflight needs attention";
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      document.getElementById('preflight').innerHTML = renderPreflight(data);
      await refresh();
    }
    async function runnerAction(action) {
      const autoPreflight = document.getElementById('auto-preflight')?.checked;
      const payload = { action };
      if (action === 'start') payload.auto_preflight_on_run = !!autoPreflight;
      const r = await fetch(apiPath('/api/run'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
      const data = await r.json();
      lastResult = data;
      if (!r.ok || data.ok === false) {
        document.getElementById('result').textContent = data.message || 'Runner request failed';
        document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
        await refresh();
        return;
      }
      const result = data.result || {};
      document.getElementById('result').textContent = action === 'start'
        ? (result.started ? "Queue runner started" : "Queue runner already running")
        : (result.stopped ? "Queue runner stopped" : "Queue runner already stopped");
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }
    async function toggleRunner() {
      return runnerAction(lastStatus?.state?.running ? 'stop' : 'start');
    }
    async function uccRun() {
      const r = await fetch(apiPath('/api/ucc'), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      const outcome = data.result && data.result.outcome ? data.result.outcome : "unknown";
      document.getElementById('result').textContent = `UCC result: ${outcome}`;
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      const trace = document.getElementById('contract-trace');
      if (trace) trace.innerHTML = renderContractTrace(data);
      const actionLog = document.getElementById('action-log');
      if (actionLog && lastStatus) actionLog.innerHTML = renderActionLog(lastStatus.action_log || []);
      await refresh();
    }
    async function lifecycleAction(target, action) {
      const r = await fetch(apiPath('/api/lifecycle/action'), {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ target, action }),
      });
      const data = await r.json();
      const lifecycle = data.lifecycle || data;
      lastLifecycle = lifecycle;
      document.getElementById('lifecycle').innerHTML = renderLifecycleSummary(lifecycle);
      document.getElementById('result').textContent = `${target} ${action} requested`;
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
    }
    async function itemAction(itemId, action) {
      const r = await fetch(apiPath(`/api/item/${encodeURIComponent(itemId)}/${encodeURIComponent(action)}`), { method: 'POST' });
      const data = await r.json();
      lastResult = data;
      if (!r.ok || data.ok === false) {
        document.getElementById('result').textContent = data.message || `${action} failed`;
        document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
        await refresh();
        return;
      }
      document.getElementById('result').textContent = `Item ${action} done`;
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
    }
    function backendBaseUrl() {
      return loadBackendState().selected || DEFAULT_BACKEND_URL;
    }
    function openDocs() {
      const url = backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/docs`, '_blank');
    }
    function openSpec() {
      const url = backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/openapi.yaml`, '_blank');
    }
    async function runTests() {
      const summary = document.getElementById('test-summary');
      const results = document.getElementById('test-results');
      const badge = document.getElementById('test-badge');
      const counts = document.getElementById('test-counts');
      if (summary) summary.style.display = '';
      if (badge) { badge.textContent = 'running...'; badge.className = 'badge'; }
      if (counts) counts.textContent = 'Running test suite...';
      if (results) results.innerHTML = '<div class="item">Running...</div>';
      try {
        const r = await fetch(`${backendBaseUrl()}/api/tests`);
        const data = await r.json();
        const passed = data.passed ?? 0;
        const failed = data.failed ?? 0;
        const errors = data.errors ?? 0;
        const total = data.total ?? (passed + failed + errors);
        const ok = failed === 0 && errors === 0;
        if (badge) { badge.textContent = ok ? 'pass' : 'fail'; badge.className = ok ? 'badge good' : 'badge bad'; }
        if (counts) counts.textContent = `${passed} passed, ${failed} failed, ${errors} errors — ${total} total`;
        const tests = data.tests || data.results || [];
        if (results) {
          results.innerHTML = tests.length ? tests.map((t) => {
            const name = t.name || t.test || 'unknown';
            const status = t.outcome || t.status || 'unknown';
            return `<div class="item compact">
              <div class="item-top">
                <div class="item-url">${name}</div>
                <span class="${badgeClass(status)}">${status}</span>
              </div>
              ${t.message ? `<div class="meta"><span>${t.message}</span></div>` : ''}
            </div>`;
          }).join('') : `<div class="item">${ok ? 'All tests passed.' : 'No test details available.'}</div>`;
        }
      } catch (err) {
        if (badge) { badge.textContent = 'error'; badge.className = 'badge bad'; }
        if (counts) counts.textContent = `Failed to reach backend: ${err.message}`;
        if (results) results.innerHTML = '';
      }
    }
    async function newSession() {
      const r = await fetch(apiPath('/api/session'), {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'new' }),
      });
      const data = await r.json();
      lastResult = data;
      document.getElementById('result').textContent = data.ok ? 'New session started' : 'Session change requested';
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
      await refresh();
      if (page === 'lifecycle') loadLifecycle();
      if (page === 'log') refreshActionLog();
    }
    async function loadDeclaration() {
      const r = await fetch(apiPath('/api/declaration'));
      lastDeclaration = await r.json();
      if (lastDeclaration?.ok === false || lastDeclaration?.backend?.reachable === false) {
        const options = document.getElementById('options-panel');
        if (options) options.innerHTML = `<div class='item'>${backendUnavailableLabel(lastDeclaration)}</div>`;
        return;
      }
      syncDeclarationUi();
      const options = document.getElementById('options-panel');
      if (options) options.innerHTML = renderOptionsPanel(lastDeclaration);
      const bwConfig = document.getElementById('bw-config-panel');
      if (bwConfig) bwConfig.innerHTML = renderBandwidthConfigPanel(lastDeclaration);
      const limit = document.querySelector('input[oninput="setSimultaneousLimit(this.value)"]');
      if (limit) limit.value = String(getDeclarationPreference('max_simultaneous_downloads') ?? 1);
    }
    async function saveDeclaration() {
      const value = document.getElementById('declaration').value;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch (e) {
        document.getElementById('result').textContent = `Invalid JSON: ${e.message}`;
        return;
      }
      const r = await fetch(apiPath('/api/declaration'), { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(parsed) });
      const data = await r.json();
      lastResult = data;
      document.getElementById('result').textContent = "Declaration saved";
      document.getElementById('result-json').textContent = JSON.stringify(data, null, 2);
    }
    async function refreshActionLog() {
      if (page !== 'log') return;
      const sessionFilter = document.getElementById('session-filter');
      if (sessionFilter && !sessionFilter.value) sessionFilter.value = 'current';
      const r = await fetch(apiPath('/api/log?limit=120'));
      const data = await r.json();
      if (data?.ok === false || data?.backend?.reachable === false) {
        const actionLog = document.getElementById('action-log');
        if (actionLog) actionLog.innerHTML = `<div class='item'>${backendUnavailableLabel(data)}</div>`;
        return;
      }
      const actionLog = document.getElementById('action-log');
      if (actionLog) actionLog.innerHTML = renderActionLog(data.items || []);
    }
    document.getElementById('action-filter')?.addEventListener('change', refreshActionLog);
    document.getElementById('session-filter')?.addEventListener('change', refreshActionLog);
    initTheme();
    initNotifications();
    refresh();
    setRefreshInterval(10000);
    if (page === 'lifecycle') loadLifecycle();
    if (page === 'bandwidth') loadDeclaration();
    if (page === 'options') loadDeclaration();
    if (page === 'log') {
      loadDeclaration();
      refreshActionLog();
    }
    if (page === 'dashboard') {
      loadDeclaration().catch(() => {});
    }
    renderBackendPanel();
    discoverBackends().catch(() => {});
    applyPage();
