// src/ariaflow_dashboard/static/ts/formatters.ts
function formatEta(totalLength, completedLength, speed) {
  const total = Number(totalLength || 0);
  const done = Number(completedLength || 0);
  const rate = Number(speed || 0);
  if (rate <= 0 || total <= done) return null;
  const secs = Math.round((total - done) / rate);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor(secs % 3600 / 60);
  return `${h}h ${m}m`;
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
  if (!text || text === "0" || text === "0M" || text === "0 Mbps" || text === "0 Mbps/s") {
    return "unlimited";
  }
  return text;
}
function shortName(value) {
  if (!value) return "(no name)";
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : url.hostname;
  } catch {
    const parts = value.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : value;
  }
}
function relativeTime(value) {
  if (!value) return "-";
  const now = Date.now();
  const then = new Date(value).getTime();
  if (isNaN(then)) return String(value);
  const diff = Math.floor((now - then) / 1e3);
  if (diff < 0) return String(value);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + " min ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}
function timestampLabel(value) {
  return value ? relativeTime(value) : "-";
}
function badgeClass(status) {
  if (["converged", "ok", "complete"].includes(status)) return "badge good";
  if (["error", "missing", "removed"].includes(status)) return "badge bad";
  if (["paused", "queued", "waiting", "unchanged", "skipped"].includes(status)) {
    return "badge warn";
  }
  return "badge";
}
function sessionLabel(state) {
  if (state?.session_id && !state?.session_closed_at) {
    return `current ${String(state.session_id).slice(0, 8)}`;
  }
  if (state?.session_id && state?.session_closed_at) {
    return `closed ${String(state.session_id).slice(0, 8)}`;
  }
  return "-";
}

// src/ariaflow_dashboard/static/ts/sparkline.ts
function sparklinePoints(data, max, w, h) {
  const step = w / (data.length - 1);
  return data.map((v, i) => `${(i * step).toFixed(1)},${(h - v / max * (h - 2) - 1).toFixed(1)}`).join(" ");
}
function renderItemSparkline(data) {
  if (!data || data.length < 2) return "";
  const max = Math.max(...data, 1);
  const w = 120;
  const h = 28;
  const points = sparklinePoints(data, max, w, h);
  return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px;" viewBox="0 0 ${w} ${h}">
    <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}
function renderGlobalSparkline(dl, ul) {
  if (dl.length < 2) return "";
  const max = Math.max(...dl, ...ul, 1);
  const w = 200;
  const h = 40;
  const dlPoints = sparklinePoints(dl, max, w, h);
  const ulPoints = ul.length >= 2 ? sparklinePoints(ul, max, w, h) : "";
  const peakDl = formatRate(Math.max(...dl));
  const peakUl = Math.max(...ul) > 0 ? ` \u2191 ${formatRate(Math.max(...ul))}` : "";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">
    <polyline points="${dlPoints}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/>
    ${ulPoints ? `<polyline points="${ulPoints}" fill="none" stroke="var(--accent-2)" stroke-width="1" stroke-linejoin="round" stroke-dasharray="3,2"/>` : ""}
  </svg><span style="font-size:0.78rem;color:var(--muted);">peak \u2193 ${peakDl}${peakUl}</span>`;
}

// src/ariaflow_dashboard/static/ts/api.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function apiFetch(url, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(timer));
}
function joinUrl(base, path) {
  return `${base.replace(/\/+$/, "")}${path}`;
}
async function postEmpty(url, opts = {}) {
  return apiFetch(url, { ...opts, method: opts.method ?? "POST" });
}

// src/ariaflow_dashboard/static/ts/runtime.ts
var DEFAULT_BACKEND = "http://127.0.0.1:8000";
var DEFAULT_IP = "127.0.0.1";
var DEFAULT_HOSTNAME = "localhost";
function backendUrl() {
  const v = window.__ARIAFLOW_BACKEND_URL__;
  return typeof v === "string" && v.length > 0 ? v : DEFAULT_BACKEND;
}
function dashboardHostname() {
  const v = window.__ARIAFLOW_DASHBOARD_HOSTNAME__;
  return typeof v === "string" && v.length > 0 ? v : DEFAULT_HOSTNAME;
}
function dashboardHostnameLower() {
  return dashboardHostname().toLowerCase();
}
function localMainIp() {
  const v = window.__ARIAFLOW_DASHBOARD_LOCAL_MAIN_IP__;
  return typeof v === "string" && v.length > 0 ? v : DEFAULT_IP;
}
function dashboardVersion() {
  const v = window.__ARIAFLOW_DASHBOARD_VERSION__;
  return typeof v === "string" && v.length > 0 ? v : "";
}
function dashboardPid() {
  const v = window.__ARIAFLOW_DASHBOARD_PID__;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}
function localIps() {
  const v = window.__ARIAFLOW_DASHBOARD_LOCAL_IPS__;
  return Array.isArray(v) && v.length > 0 ? v.map(String) : [DEFAULT_IP];
}

// src/ariaflow_dashboard/static/ts/storage.ts
var KEYS = {
  refreshInterval: "ariaflow.refresh_interval",
  backends: "ariaflow.backends",
  selectedBackend: "ariaflow.selected_backend"
};
function readString(key, fallback = "") {
  return (localStorage.getItem(key) ?? "").trim() || fallback;
}
function writeString(key, value) {
  localStorage.setItem(key, value);
}
function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
function writeNumber(key, value) {
  localStorage.setItem(key, String(value));
}
function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function readRefreshInterval(fallbackMs = 1e4) {
  return readNumber(KEYS.refreshInterval, fallbackMs);
}
function writeRefreshInterval(ms) {
  writeNumber(KEYS.refreshInterval, ms);
}
function readBackends() {
  const raw = readJson(KEYS.backends, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? "").trim()).filter(Boolean);
}
function writeBackends(list) {
  writeJson(KEYS.backends, list);
}
function readSelectedBackend() {
  return readString(KEYS.selectedBackend);
}
function writeSelectedBackend(url) {
  writeString(KEYS.selectedBackend, url);
}

// src/ariaflow_dashboard/static/ts/vendor/webstyle/looks.ts
var PALETTE_FOR_LOOK = {
  aurora: "aurora",
  fluent: "fluent",
  liquid: "liquid-glass"
};
var LOOK_TOKENS = {
  aurora: {
    dark: {
      "--ws-accent-rgb": "153 162 175",
      "--ws-accent-on": "#ffffff",
      "--ws-good-rgb": "180 239 198",
      "--ws-warn-rgb": "251 235 157",
      "--ws-danger-rgb": "240 186 185",
      "--ws-info-rgb": "223 221 220",
      "--ws-alpha-idle": "0.042",
      "--ws-alpha-hover": "0.072",
      "--ws-alpha-active": "0.108",
      "--ws-alpha-inactive": "0.33",
      "--ws-alpha-border-soft": "0.15",
      "--ws-alpha-border-medium": "0.21",
      "--ws-alpha-border-strong": "0.24",
      "--ws-alpha-border-heavy": "0.3",
      "--ws-alpha-glow": "0.21",
      "--ws-alpha-glow-soft": "0.072",
      "--ws-alpha-shadow": "0.21",
      "--ws-alpha-shadow-overlay": "0.3"
    },
    light: {
      "--ws-accent-rgb": "76 85 97",
      "--ws-accent-on": "#ffffff",
      "--ws-good-rgb": "61 112 73",
      "--ws-warn-rgb": "148 87 57",
      "--ws-danger-rgb": "146 63 55",
      "--ws-info-rgb": "59 56 54",
      "--ws-alpha-idle": "0.03",
      "--ws-alpha-hover": "0.06",
      "--ws-alpha-active": "0.108",
      "--ws-alpha-inactive": "0.33",
      "--ws-alpha-border-soft": "0.15",
      "--ws-alpha-border-medium": "0.18",
      "--ws-alpha-border-strong": "0.18",
      "--ws-alpha-border-heavy": "0.3",
      "--ws-alpha-glow": "0.21",
      "--ws-alpha-glow-soft": "0.072",
      "--ws-alpha-shadow": "0.048",
      "--ws-alpha-shadow-overlay": "0.096"
    }
  },
  fluent: {
    // "fluent" mood = empty mood in MOODS: no color/alpha overrides,
    // Aurora baseline applies. Structural overrides (radii, easing,
    // shadows, blur) come from the :root[data-palette="fluent"] CSS rule.
    dark: {},
    light: {}
  },
  liquid: {
    // Liquid mood = sky shifted +20° (≈ macOS systemBlue). Status
    // colors and alphas stay at Aurora baseline.
    dark: {
      "--ws-accent-rgb": "123 203 255",
      "--ws-accent-on": "#0a0a0a"
    },
    light: {
      "--ws-accent-rgb": "65 102 177",
      "--ws-accent-on": "#ffffff"
    }
  }
};
var A11Y_TOKENS = {
  dark: {
    "--ws-accent-rgb": "140 164 197",
    "--ws-accent-on": "#ffffff",
    "--ws-good-rgb": "56 255 160",
    "--ws-warn-rgb": "255 235 0",
    "--ws-danger-rgb": "255 160 164",
    "--ws-info-rgb": "232 227 224",
    "--ws-alpha-idle": "0.105",
    "--ws-alpha-hover": "0.18",
    "--ws-alpha-active": "0.27",
    "--ws-alpha-inactive": "0.825",
    "--ws-alpha-border-soft": "0.375",
    "--ws-alpha-border-medium": "0.525",
    "--ws-alpha-border-strong": "0.6",
    "--ws-alpha-border-heavy": "0.75",
    "--ws-alpha-glow": "0.525",
    "--ws-alpha-glow-soft": "0.18",
    "--ws-alpha-shadow": "0.525",
    "--ws-alpha-shadow-overlay": "0.75"
  },
  light: {
    "--ws-accent-rgb": "63 85 117",
    "--ws-accent-on": "#ffffff",
    "--ws-good-rgb": "0 71 0",
    "--ws-warn-rgb": "180 0 0",
    "--ws-danger-rgb": "139 0 0",
    "--ws-info-rgb": "16 11 6",
    "--ws-alpha-idle": "0.075",
    "--ws-alpha-hover": "0.15",
    "--ws-alpha-active": "0.27",
    "--ws-alpha-inactive": "0.825",
    "--ws-alpha-border-soft": "0.375",
    "--ws-alpha-border-medium": "0.45",
    "--ws-alpha-border-strong": "0.45",
    "--ws-alpha-border-heavy": "0.75",
    "--ws-alpha-glow": "0.525",
    "--ws-alpha-glow-soft": "0.18",
    "--ws-alpha-shadow": "0.12",
    "--ws-alpha-shadow-overlay": "0.24"
  }
};
function lookTokens(look = "aurora", theme = "dark", a11y = false) {
  return a11y ? A11Y_TOKENS[theme] : LOOK_TOKENS[look][theme];
}
function applyLook(options = {}) {
  const look = options.look ?? "aurora";
  const theme = options.theme ?? "dark";
  const a11y = options.a11y ?? false;
  const el = options.target ?? document.documentElement;
  const tokens = lookTokens(look, theme, a11y);
  const prevPalette = el.dataset.palette;
  const prevTheme = el.dataset.theme;
  el.dataset.palette = PALETTE_FOR_LOOK[look];
  if (theme === "light") el.dataset.theme = "light";
  else delete el.dataset.theme;
  for (const [k, v] of Object.entries(tokens)) {
    el.style.setProperty(k, v);
  }
  return () => {
    for (const k of Object.keys(tokens)) el.style.removeProperty(k);
    if (prevPalette === void 0) delete el.dataset.palette;
    else el.dataset.palette = prevPalette;
    if (prevTheme === void 0) delete el.dataset.theme;
    else el.dataset.theme = prevTheme;
  };
}

// src/ariaflow_dashboard/static/ts/vendor/webstyle/theme-controller.ts
function detectPlatform() {
  const nav = globalThis.navigator;
  if (!nav) return "other";
  const hint = nav.userAgentData?.platform?.toLowerCase();
  const ua = (hint ?? nav.userAgent ?? "").toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac") || ua.includes("darwin")) return "macos";
  if (ua.includes("linux")) return "linux";
  return "other";
}

// src/ariaflow_dashboard/static/ts/vendor/webstyle/simple-theme-controller.ts
function simpleLookForPlatform(p = detectPlatform()) {
  return p === "windows" ? "fluent" : "liquid";
}
var DEFAULT_KEY = "ws-simple-theme-v1";
function createSimpleThemeController(options) {
  const apply = options.apply;
  const target = options.target;
  const storageKey = options.storageKey === void 0 ? DEFAULT_KEY : options.storageKey;
  const storage = resolveStorage(options.storage);
  const mql = resolveMatchMedia(options.matchMedia);
  const look = simpleLookForPlatform();
  const persisted = loadPersisted(storage, storageKey);
  let mode = persisted.mode ?? options.initialMode ?? "auto";
  let cleanup = () => {
  };
  let destroyed = false;
  const subscribers = /* @__PURE__ */ new Set();
  function resolveTheme(m) {
    if (m !== "auto") return m;
    return mql?.matches ? "light" : "dark";
  }
  function snapshot() {
    return { mode, resolved: resolveTheme(mode), look };
  }
  function commit() {
    if (destroyed) return;
    cleanup();
    cleanup = apply({ look, theme: resolveTheme(mode), target });
    save();
    const s = snapshot();
    for (const fn of subscribers) fn(s);
  }
  function save() {
    if (!storage || !storageKey) return;
    try {
      storage.setItem(storageKey, JSON.stringify({ mode }));
    } catch {
    }
  }
  const onSystemChange = () => {
    if (mode === "auto") commit();
  };
  if (mql && typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onSystemChange);
  }
  commit();
  return {
    getState: snapshot,
    getMode: () => mode,
    setMode(next) {
      if (destroyed || next === mode) return;
      mode = next;
      commit();
    },
    cycleMode() {
      const next = mode === "auto" ? "light" : mode === "light" ? "dark" : "auto";
      this.setMode(next);
    },
    getLook: () => look,
    subscribe(fn) {
      subscribers.add(fn);
      fn(snapshot());
      return () => {
        subscribers.delete(fn);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (mql && typeof mql.removeEventListener === "function") {
        mql.removeEventListener("change", onSystemChange);
      }
      cleanup();
      subscribers.clear();
    }
  };
}
function resolveStorage(s) {
  if (s === null) return null;
  if (s !== void 0) return s;
  try {
    const ls = globalThis.localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}
function resolveMatchMedia(m) {
  if (m === null) return null;
  const fn = m ?? globalThis.matchMedia;
  if (typeof fn !== "function") return null;
  try {
    return fn("(prefers-color-scheme: light)");
  } catch {
    return null;
  }
}
function loadPersisted(storage, key) {
  if (!storage || !key) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed.mode === "light" || parsed.mode === "dark" || parsed.mode === "auto") {
      return { mode: parsed.mode };
    }
    return {};
  } catch {
    return {};
  }
}

// src/ariaflow_dashboard/static/ts/backend.ts
function cleanList(items, defaultBackendUrl) {
  return [
    ...new Set(
      items.map((item) => String(item ?? "").trim()).filter((item) => item && item !== defaultBackendUrl)
    )
  ];
}
function reconcileSelected(selected, backends, defaultBackendUrl) {
  return selected === defaultBackendUrl || backends.includes(selected) ? selected : defaultBackendUrl;
}
function loadBackendState(defaultBackendUrl) {
  const backends = cleanList(readBackends(), defaultBackendUrl);
  const selected = reconcileSelected(readSelectedBackend(), backends, defaultBackendUrl);
  return { backends, selected };
}
function saveBackendState(backends, selected, defaultBackendUrl) {
  const clean = cleanList(backends, defaultBackendUrl);
  const nextSelected = reconcileSelected(selected, clean, defaultBackendUrl);
  writeBackends(clean);
  writeSelectedBackend(nextSelected);
  return { backends: clean, selected: nextSelected };
}
function isSelfService(item, localIps2) {
  const localHostLower = dashboardHostnameLower();
  const selfLocal = localHostLower ? `${localHostLower}.local` : "";
  const txtHost = String(item?.txt_hostname ?? "").toLowerCase();
  if (txtHost && localHostLower && txtHost === localHostLower) return true;
  const host = String(item?.host ?? "").toLowerCase().replace(/\.$/, "");
  if (selfLocal && host === selfLocal) return true;
  const ip = String(item?.ip ?? "");
  if (ip && localIps2.includes(ip)) return true;
  if (ip && ip.startsWith("127.")) return true;
  try {
    const urlIp = new URL(String(item?.url ?? "")).hostname;
    if (urlIp === "127.0.0.1") return true;
  } catch {
  }
  return false;
}
function dedupeByName(items) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of items) {
    const name = String(item?.name ?? "").trim();
    if (name && seen.has(name)) continue;
    if (name) seen.add(name);
    out.push(item);
  }
  return out;
}
function mergeDiscoveredItems(rawItems, prevMeta, prevState, options) {
  const list = Array.isArray(rawItems) ? rawItems.filter((item) => !item?.role || item.role !== "web") : [];
  const meta = { ...prevMeta };
  for (const item of list) {
    const url = String(item?.url ?? "").trim();
    if (!url) continue;
    meta[url] = {
      name: String(item?.name ?? "").trim(),
      host: String(item?.host ?? "").trim(),
      ip: String(item?.ip ?? "").trim(),
      txt_hostname: String(item?.txt_hostname ?? "").trim()
    };
  }
  const remote = dedupeByName(list).filter((item) => !isSelfService(item, options.localIps));
  const discovered = remote.map((i) => String(i?.url ?? "").trim()).filter(Boolean);
  if (!discovered.length) {
    return { meta, state: prevState, autoSelectedUrl: null };
  }
  const merged = [.../* @__PURE__ */ new Set([...prevState.backends, ...discovered])];
  const firstDiscovered = discovered[0];
  const shouldAutoSelect = discovered.length === 1 && prevState.selected === options.defaultBackendUrl && firstDiscovered !== prevState.selected;
  const nextSelected = shouldAutoSelect ? firstDiscovered : prevState.selected;
  const state = saveBackendState(merged, nextSelected, options.defaultBackendUrl);
  return { meta, state, autoSelectedUrl: shouldAutoSelect ? firstDiscovered : null };
}
function backendDisplayName(url, meta, defaultBackendUrl, localMainIpValue) {
  if (!url) return "-";
  let addr = url;
  try {
    addr = new URL(url).host;
  } catch {
  }
  if (url === defaultBackendUrl) {
    const host = dashboardHostname();
    let port = "8000";
    try {
      port = new URL(url).port || "8000";
    } catch {
    }
    return `${host} (${localMainIpValue}:${port})`;
  }
  const m = meta[url];
  if (m?.name) {
    const cleanName = m.name.replace(/\s*\(\d+\)\s*$/, "");
    return `${cleanName} (${addr})`;
  }
  return addr;
}
function backendPath(backend, path) {
  return joinUrl(backend, path);
}

// src/ariaflow_dashboard/static/ts/actions.ts
function urlItemAction(itemId, action) {
  return `/api/downloads/${encodeURIComponent(itemId)}/${encodeURIComponent(action)}`;
}
function urlItemFiles(itemId) {
  return `/api/downloads/${encodeURIComponent(itemId)}/files`;
}
function urlLifecycleAction(target, action) {
  return `/api/lifecycle/${encodeURIComponent(target)}/${encodeURIComponent(action)}`;
}
function urlTorrentStop(infohash) {
  return `/api/torrents/${encodeURIComponent(infohash)}/stop`;
}
function urlScheduler(action) {
  return `/api/scheduler/${action}`;
}
function urlAria2GetOption(gid) {
  return `/api/aria2/option?gid=${encodeURIComponent(gid)}`;
}

// src/ariaflow_dashboard/static/ts/filters.ts
function normalizeStatus(status) {
  return (status ?? "unknown").toLowerCase();
}
function matchesStatusFilter(item, filter) {
  if (filter === "all") return true;
  return normalizeStatus(item.status) === filter;
}
function matchesSearch(item, search) {
  if (!search) return true;
  const needle = search.toLowerCase();
  const url = (item.url ?? "").toLowerCase();
  const output = (item.output ?? "").toLowerCase();
  return url.includes(needle) || output.includes(needle);
}
function filterQueueItems(items, filter, search) {
  return items.filter((item) => matchesStatusFilter(item, filter) && matchesSearch(item, search));
}
var STABLE_FILTERS = /* @__PURE__ */ new Set([
  "all",
  "active",
  "paused",
  "complete",
  "error"
]);
function isFilterButtonVisible(filter, filterCounts, selectedFilter) {
  return STABLE_FILTERS.has(filter) || (filterCounts[filter] ?? 0) > 0 || selectedFilter === filter;
}

// src/ariaflow_dashboard/static/ts/events.ts
function isOfflinePayload(data) {
  if (data?.ok === false) return true;
  const aria = data["ariaflow-server"];
  return aria?.reachable === false;
}
function parseStateChangedEvent(raw) {
  if (!raw) return { kind: "invalid", reason: "empty" };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "parse-error" };
  }
  if (!data || typeof data !== "object") {
    return { kind: "invalid", reason: "parse-error" };
  }
  const obj = data;
  if (Array.isArray(obj.items)) {
    return {
      kind: "full",
      data: obj,
      isOffline: isOfflinePayload(obj)
    };
  }
  if (obj.rev != null && (typeof obj.rev === "string" || typeof obj.rev === "number")) {
    return { kind: "rev", rev: obj.rev };
  }
  return { kind: "invalid", reason: "parse-error" };
}
function parseActionLoggedEvent(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch {
  }
  return null;
}
function shouldShowOfflineStatus(consecutiveFailures, hasPriorStatus) {
  return !hasPriorStatus || consecutiveFailures >= 3;
}
var FILTER_TO_BACKEND_STATUS = {
  downloading: "active",
  done: "complete"
};
function buildStatusUrl(basePath, opts = {}) {
  const params = [];
  const qf = opts.queueFilter;
  if (qf && qf !== "all") {
    const backendStatus = FILTER_TO_BACKEND_STATUS[qf] ?? qf;
    params.push(`status=${encodeURIComponent(backendStatus)}`);
  }
  if (opts.sessionFilter === "current") {
    params.push("session=current");
  }
  return params.length ? `${basePath}?${params.join("&")}` : basePath;
}
function nextReconnectDelayMs(attempts, opts = {}) {
  const baseMs = opts.baseMs ?? 5e3;
  const capMs = opts.capMs ?? 6e4;
  const jitter = opts.jitter ?? 0.25;
  const random = opts.random ?? Math.random;
  const safeAttempts = Math.max(0, Math.floor(attempts));
  const exp = Math.min(baseMs * 2 ** safeAttempts, capMs);
  const spread = exp * jitter * (random() * 2 - 1);
  return Math.max(0, Math.round(exp + spread));
}
function isStreamStale(lastActivityAt, now, timeoutMs = 6e4) {
  return now - lastActivityAt > timeoutMs;
}

// src/ariaflow_dashboard/static/ts/speed_history.ts
var SPEED_HISTORY_MAX = 30;
var GLOBAL_SPEED_MAX = 40;
function clampTail(buf, cap) {
  return buf.length > cap ? buf.slice(-cap) : [...buf];
}
function coerceSpeed(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function appendItemSpeed(current, speed, cap = SPEED_HISTORY_MAX) {
  const s = coerceSpeed(speed);
  const buf = current ?? [];
  if (buf.length && buf[buf.length - 1] === s && s === 0) return buf;
  return clampTail([...buf, s], cap);
}
function recordItemSpeed(history2, itemId, speed, cap = SPEED_HISTORY_MAX) {
  if (!itemId) return history2;
  const next = appendItemSpeed(history2[itemId], speed, cap);
  if (next === history2[itemId]) return history2;
  return { ...history2, [itemId]: next };
}
function appendGlobalSpeed(prev, dlSpeed, ulSpeed, cap = GLOBAL_SPEED_MAX) {
  return {
    download: clampTail([...prev.download, coerceSpeed(dlSpeed)], cap),
    upload: clampTail([...prev.upload, coerceSpeed(ulSpeed)], cap)
  };
}

// src/ariaflow_dashboard/static/ts/notifications.ts
function notificationFor(item, status, id) {
  if (status === "complete") {
    return {
      kind: "complete",
      title: "Download complete",
      body: shortName(item.output || item.url || ""),
      tag: `ariaflow-${id}`
    };
  }
  if (status === "error") {
    return {
      kind: "error",
      title: "Download failed",
      body: shortName(item.output || item.url || "") + (item.error_message ? ` \u2014 ${item.error_message}` : ""),
      tag: `ariaflow-${id}`
    };
  }
  return null;
}
function diffItemStatuses(previous, items) {
  const next = { ...previous };
  const notifications = [];
  for (const item of items) {
    const id = String(item.id || item.url || "");
    if (!id) continue;
    const status = String(item.status ?? "").toLowerCase();
    const prev = previous[id];
    if (prev && prev !== status) {
      const n = notificationFor(item, status, id);
      if (n) notifications.push(n);
    }
    next[id] = status;
  }
  return { notifications, nextStatusMap: next };
}

// src/ariaflow_dashboard/static/ts/file_selection.ts
function normalizeFiles(rawFiles) {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles.map((f) => ({
    ...f,
    selected: f?.selected !== false
  }));
}
function selectedFileIndexes(files) {
  const out = [];
  for (const f of files) {
    if (f.selected && typeof f.index === "number") out.push(f.index);
  }
  return out;
}

// src/ariaflow_dashboard/static/ts/log_filter.ts
function passesAxis(value, filter) {
  if (filter === "all") return true;
  return (value ?? "unknown") === filter;
}
function passesSession(entrySessionId, sessionFilter, currentSessionId) {
  if (sessionFilter === "all") return true;
  if (sessionFilter !== "current") return true;
  if (!currentSessionId) return false;
  return entrySessionId === currentSessionId;
}
function shouldCollapse(prev, entry) {
  return prev.action === "poll" && entry.action === "poll" && prev.detail?.gid === entry.detail?.gid;
}
function filterActionLog(entries, opts) {
  const visible = entries.filter(
    (e) => passesAxis(e.action, opts.actionFilter) && passesAxis(e.target, opts.targetFilter) && passesSession(e.session_id, opts.sessionFilter, opts.currentSessionId)
  );
  const collapsed = [];
  for (const entry of visible) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && shouldCollapse(prev, entry)) {
      prev._pollCount = (prev._pollCount ?? 1) + 1;
      prev.detail = entry.detail;
      prev.timestamp = entry.timestamp ?? prev.timestamp;
      continue;
    }
    collapsed.push({ ...entry });
  }
  return collapsed.reverse();
}
function distinctActions(entries) {
  return [...new Set(entries.map((e) => e.action ?? "unknown"))].sort();
}
function distinctTargets(entries) {
  return [...new Set(entries.map((e) => e.target ?? "unknown"))].sort();
}

// src/ariaflow_dashboard/static/ts/freshness.ts
function endpointKey(method, path) {
  return `${method.toUpperCase()} ${path}`;
}
function paramsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (String(a[k]) !== String(b[k])) return false;
  return true;
}
var FreshnessRouter = class {
  constructor(adapters) {
    this.endpoints = /* @__PURE__ */ new Map();
    this.hostVisible = true;
    this.adapters = adapters;
  }
  /** Register endpoint metadata from /api/_meta. Idempotent. */
  registerMeta(meta) {
    const key = endpointKey(meta.method, meta.path);
    const existing = this.endpoints.get(key);
    if (existing) {
      existing.meta = meta;
      return;
    }
    const next = {
      meta,
      subscribers: /* @__PURE__ */ new Map(),
      lastFetchAt: null,
      lastValue: void 0,
      inflight: null,
      timer: null
    };
    this.endpoints.set(key, next);
  }
  /**
   * Subscribe a component to an endpoint.
   *
   * `onUpdate`, if provided, fires after every successful fetch with the
   * parsed value. Use it to drive view state in the subscriber. Callback
   * exceptions are isolated — one bad subscriber doesn't break others.
   * If the endpoint already has a cached value at subscribe time, the
   * callback fires once synchronously with that cached value so the
   * subscriber can render immediately without waiting for the next fetch.
   */
  subscribe(method, path, subscriberId, opts) {
    const key = endpointKey(method, path);
    const ep = this.endpoints.get(key);
    if (!ep) {
      throw new Error(`FreshnessRouter: no meta registered for ${key}`);
    }
    const paramsChanged = opts.params !== void 0 && !paramsEqual(ep.currentParams, opts.params);
    if (paramsChanged) {
      ep.currentParams = opts.params;
      ep.lastValue = void 0;
      ep.lastFetchAt = null;
    }
    const rec = { id: subscriberId, visible: opts.visible };
    if (opts.onUpdate) rec.onUpdate = opts.onUpdate;
    ep.subscribers.set(subscriberId, rec);
    this.log(key, "subscribe", { subscriberId, visible: opts.visible });
    if (opts.onUpdate && ep.lastValue !== void 0) {
      this.invokeOne(rec, ep.lastValue);
    }
    this.reconcile(key);
  }
  unsubscribe(method, path, subscriberId) {
    const key = endpointKey(method, path);
    const ep = this.endpoints.get(key);
    if (!ep) return;
    ep.subscribers.delete(subscriberId);
    this.log(key, "unsubscribe", { subscriberId });
    this.reconcile(key);
  }
  /** Update a subscriber's visibility (component scrolled, tab moved, etc). */
  setSubscriberVisible(subscriberId, visible) {
    for (const [key, ep] of this.endpoints) {
      const rec = ep.subscribers.get(subscriberId);
      if (rec && rec.visible !== visible) {
        rec.visible = visible;
        this.log(key, "visibility-change", { subscriberId, visible });
        this.reconcile(key);
      }
    }
  }
  /** Update the host visibility (browser tab / iframe host). */
  setHostVisible(visible) {
    if (this.hostVisible === visible) return;
    this.hostVisible = visible;
    for (const key of this.endpoints.keys()) {
      this.log(key, "host-visibility-change", { visible });
      this.reconcile(key);
    }
  }
  /**
   * Apply revalidate_on for an action. Call after a successful POST.
   * Endpoints whose meta lists `${METHOD} ${path}` in revalidate_on
   * will be refetched if currently active.
   */
  invalidateByAction(actionMethod, actionPath) {
    const action = endpointKey(actionMethod, actionPath);
    for (const [key, ep] of this.endpoints) {
      const triggers = ep.meta.revalidate_on ?? [];
      if (!triggers.includes(action)) continue;
      this.log(key, "invalidate", { action });
      if (this.isActive(key)) {
        void this.runFetch(key);
      }
    }
  }
  /** Read current cached value for an endpoint, if any. */
  getCached(method, path) {
    const ep = this.endpoints.get(endpointKey(method, path));
    return ep?.lastValue;
  }
  /** Snapshot router state for the Dev-tab Freshness map. */
  status() {
    const out = [];
    for (const [key, ep] of this.endpoints) {
      const visible = this.countVisible(ep);
      const hidden = ep.subscribers.size - visible;
      out.push({
        endpoint: key,
        freshness: ep.meta.freshness,
        ttl_s: ep.meta.ttl_s ?? null,
        visibleSubscribers: visible,
        hiddenSubscribers: hidden,
        hostVisible: this.hostVisible,
        lastFetchAt: ep.lastFetchAt,
        nextFetchAt: this.nextFetchAt(ep),
        active: this.isActive(key)
      });
    }
    return out;
  }
  /** Tear down all timers. Call on app teardown / hot reload. */
  dispose() {
    for (const ep of this.endpoints.values()) {
      if (ep.timer != null) this.adapters.clearTimer(ep.timer);
      ep.timer = null;
    }
  }
  // --- internals ---
  countVisible(ep) {
    let n = 0;
    for (const s of ep.subscribers.values()) if (s.visible) n++;
    return n;
  }
  isActive(key) {
    const ep = this.endpoints.get(key);
    if (!ep) return false;
    if (!this.hostVisible) return false;
    return this.countVisible(ep) > 0;
  }
  nextFetchAt(ep) {
    const ttl = ep.meta.ttl_s;
    if (!ttl) return null;
    if (!ep.lastFetchAt) return this.adapters.now();
    return ep.lastFetchAt + ttl * 1e3;
  }
  reconcile(key) {
    const ep = this.endpoints.get(key);
    if (!ep) return;
    const active = this.isActive(key);
    if (!active) {
      if (ep.timer != null) {
        this.adapters.clearTimer(ep.timer);
        ep.timer = null;
        this.log(key, "pause");
      }
      return;
    }
    switch (ep.meta.freshness) {
      case "bootstrap":
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case "cold":
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case "live":
        return;
      case "on-action":
        if (!ep.lastFetchAt) void this.runFetch(key);
        return;
      case "derived":
        return;
      case "warm":
      case "swr": {
        const ttl = ep.meta.ttl_s ?? 30;
        const due = ep.lastFetchAt == null ? 0 : Math.max(0, ep.lastFetchAt + ttl * 1e3 - this.adapters.now());
        if (ep.timer != null) this.adapters.clearTimer(ep.timer);
        ep.timer = this.adapters.setTimer(() => {
          ep.timer = null;
          if (this.isActive(key)) {
            void this.runFetch(key).then(() => this.reconcile(key));
          }
        }, due);
        if (!ep.lastFetchAt) {
          this.log(key, "resume");
        }
        return;
      }
    }
  }
  async runFetch(key) {
    const ep = this.endpoints.get(key);
    if (!ep) return void 0;
    if (ep.inflight) return ep.inflight;
    this.log(key, "fetch-start");
    const promise = this.adapters.fetchJson(ep.meta.method, ep.meta.path, ep.currentParams, ep.meta.host).then((value) => {
      ep.lastValue = value;
      ep.lastFetchAt = this.adapters.now();
      ep.inflight = null;
      this.log(key, "fetch-end");
      for (const sub of ep.subscribers.values()) this.invokeOne(sub, value);
      return value;
    }).catch((err) => {
      ep.inflight = null;
      this.log(key, "fetch-error", { message: err instanceof Error ? err.message : String(err) });
      throw err;
    });
    ep.inflight = promise;
    return promise;
  }
  invokeOne(sub, value) {
    if (!sub.onUpdate) return;
    try {
      sub.onUpdate(value);
    } catch (err) {
      this.adapters.log?.({
        at: this.adapters.now(),
        endpoint: "",
        event: "fetch-error",
        detail: {
          subscriberId: sub.id,
          message: err instanceof Error ? err.message : String(err)
        }
      });
    }
  }
  log(endpoint, event, detail) {
    if (!this.adapters.log) return;
    const entry = { at: this.adapters.now(), endpoint, event };
    if (detail !== void 0) entry.detail = detail;
    this.adapters.log(entry);
  }
};

// src/ariaflow_dashboard/static/ts/freshness-bootstrap.ts
async function fetchMeta(adapters, url, host) {
  try {
    const raw = await adapters.fetchJson("GET", new URL(url, "http://x").pathname, void 0, host);
    return raw;
  } catch {
    return null;
  }
}
function registerEndpoints(router, body, host) {
  if (!body || body.ok === false || !Array.isArray(body.endpoints)) return;
  for (const m of body.endpoints) {
    if (!m.method || !m.path || !m.freshness) continue;
    const meta = {
      method: m.method,
      path: m.path,
      freshness: m.freshness,
      host
    };
    if (m.ttl_s !== void 0) meta.ttl_s = m.ttl_s;
    if (m.revalidate_on !== void 0) meta.revalidate_on = m.revalidate_on;
    if (m.transport !== void 0) meta.transport = m.transport;
    if (m.transport_topics !== void 0) meta.transport_topics = m.transport_topics;
    router.registerMeta(meta);
  }
}
async function bootstrapFreshnessRouter(adapters) {
  const backendBody = await fetchMeta(adapters, adapters.metaUrl(), "backend");
  if (!backendBody || backendBody.ok === false || !Array.isArray(backendBody.endpoints)) {
    return null;
  }
  const router = new FreshnessRouter(adapters);
  registerEndpoints(router, backendBody, "backend");
  if (adapters.dashboardMetaUrl) {
    const dashboardBody = await fetchMeta(adapters, adapters.dashboardMetaUrl(), "dashboard");
    registerEndpoints(router, dashboardBody, "dashboard");
  }
  return router;
}
function wireHostVisibility(router, win = typeof window !== "undefined" ? window : null, doc = typeof document !== "undefined" ? document : null) {
  let visible = doc ? !doc.hidden : true;
  router.setHostVisible(visible);
  const onDocChange = () => {
    if (!doc) return;
    const next = !doc.hidden;
    if (next !== visible) {
      visible = next;
      router.setHostVisible(visible);
    }
  };
  const onMessage = (ev) => {
    const data = ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type !== "visibility") return;
    const next = data.visible !== false;
    if (next !== visible) {
      visible = next;
      router.setHostVisible(visible);
    }
  };
  if (doc) doc.addEventListener("visibilitychange", onDocChange);
  if (win) win.addEventListener("message", onMessage);
  return {
    dispose: () => {
      if (doc) doc.removeEventListener("visibilitychange", onDocChange);
      if (win) win.removeEventListener("message", onMessage);
    },
    isVisible: () => visible
  };
}

// src/ariaflow_dashboard/static/ts/lifecycle.ts
function isLaunchdLike(name) {
  return name.includes("launchd") || name.includes("auto-start");
}
function lifecycleBadgeClass(record) {
  const result = record?.result;
  if (!result) return "badge";
  const { installed, current, running, expected_running } = result;
  if (installed === null && current === null && running === null) return "badge";
  if (installed === false) return "badge bad";
  if (current === false) return "badge warn";
  if (expected_running != null && running !== expected_running) return "badge warn";
  return isLifecycleHealthy(record) ? "badge good" : "badge";
}
function isLifecycleHealthy(record) {
  const result = record?.result;
  if (!result) return false;
  if (result.installed === false) return false;
  if (result.current === false) return false;
  if (result.expected_running != null) {
    if (result.running !== result.expected_running) return false;
  } else if (result.running === false) {
    return false;
  }
  return true;
}
function describeLifecycleStatus(name, record) {
  const result = record?.result ?? {};
  const { installed, current, running } = result;
  if (installed === null && current === null) {
    if (running === true) return isLaunchdLike(name) ? "loaded" : "running";
    if (running === false) return isLaunchdLike(name) ? "not loaded" : "stopped";
    return "unknown";
  }
  if (installed === false) return "not installed";
  if (current === false) {
    const v = result.version;
    const ev = result.expected_version;
    if (v && ev) return `update available (${v} \u2192 ${ev})`;
    return "update available";
  }
  const suffix = result.managed_by ? ` (${result.managed_by})` : "";
  if (result.expected_running === false && running === false) {
    return `idle \xB7 on-demand${suffix}`;
  }
  if (running === false) return "installed \xB7 stopped";
  if (running === true) return `running \xB7 current${suffix}`;
  return "installed \xB7 current";
}
function lifecycleDetailLines(record) {
  const result = record?.result;
  if (!result) return [];
  const lines = [];
  if (result.message) lines.push(result.message);
  if (result.observation && result.observation !== "ok") {
    lines.push(`Observation: ${result.observation}`);
  }
  if (result.reason && isDiagnosticReason(result.reason)) {
    lines.push(`Reason: ${result.reason}`);
  }
  if (result.completion) lines.push(`Completion: ${result.completion}`);
  return lines;
}
function isDiagnosticReason(reason) {
  return !["match", "ready", "ok", "healthy"].includes(reason);
}
function lifecycleActionsFor(name, record) {
  const result = record?.result;
  if (!result) return [];
  const target = backendTargetFor(name);
  if (!target) return [];
  const { installed, current, running } = result;
  if (installed === null && current === null) {
    if (running === true) return [{ target, action: "uninstall", label: "Unload" }];
    if (running === false) return [{ target, action: "install", label: "Load" }];
    return [];
  }
  if (installed === false) {
    return [{ target, action: "install", label: "Install" }];
  }
  if (current === false) {
    return [
      { target, action: "install", label: "Update" },
      { target, action: "uninstall", label: "Uninstall" }
    ];
  }
  return [{ target, action: "uninstall", label: "Uninstall" }];
}
function backendTargetFor(name) {
  if (name === "ariaflow-server") return "ariaflow-server";
  if (name === "aria2") return "aria2";
  if (isLaunchdLike(name)) return "aria2-launchd";
  return null;
}

// src/ariaflow_dashboard/static/ts/app.ts
document.addEventListener("alpine:init", () => {
  Alpine.data("ariaflow", () => ({
    // --- state ---
    lastStatus: null,
    lastLifecycle: null,
    lastDeclaration: null,
    refreshTimer: null,
    refreshInterval: 1e4,
    _sse: null,
    _sseConnected: false,
    _sseFallbackTimer: null,
    _inBackoff: false,
    // SSE reliability state (see _initSSE / _armSseLivenessTimer):
    //   _sseReconnectAttempts — exponential backoff counter, reset on
    //   each successful 'connected' event.
    //   _sseLastActivityAt — timestamp of the last received SSE event;
    //   the liveness timer reconnects if no traffic arrives for >60s
    //   even when the TCP connection looks healthy.
    _sseReconnectAttempts: 0,
    _sseLastActivityAt: 0,
    _sseLivenessTimer: null,
    SSE_LIVENESS_TIMEOUT_MS: 6e4,
    SSE_LIVENESS_CHECK_MS: 15e3,
    queueFilter: "all",
    queueSearch: "",
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
    page: "dashboard",
    DEFAULT_BACKEND_URL: backendUrl(),
    localIps: localIps(),
    localMainIp: localMainIp(),
    webVersionText: (() => {
      const v = dashboardVersion();
      return v ? `v${v}` : "-";
    })(),
    webPidText: dashboardPid() || "-",
    // Bonjour health: pending (initial) → ok / broken / unavailable after discovery
    bonjourState: "pending",
    backendInput: "",
    backendsDiscovered: null,
    discoveryText: "",
    // URL → {name, host, ip} from Bonjour discovery, for friendly display.
    backendMeta: {},
    urlInput: "",
    addOutput: "",
    addPriority: "",
    addMirrors: "",
    addTorrentData: null,
    addMetalinkData: null,
    addPostActionRule: "",
    declarationText: "",
    actionFilter: "all",
    targetFilter: "all",
    sessionFilter: "current",
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
    get backends() {
      if (this._cachedBackends === null) {
        const s = this.loadBackendState();
        this._cachedBackends = s.backends;
        this._cachedSelectedBackend = s.selected;
      }
      return this._cachedBackends;
    },
    get selectedBackend() {
      if (this._cachedSelectedBackend === null) {
        const s = this.loadBackendState();
        this._cachedBackends = s.backends;
        this._cachedSelectedBackend = s.selected;
      }
      return this._cachedSelectedBackend;
    },
    get state() {
      return this.lastStatus?.state || {};
    },
    // Current transfer = the item matching state.active_gid (BG-30 #5: backend
    // derives this from aria2.tellActive). Falls back to the first item with
    // non-zero download/upload speed — covers HTTP downloads where the
    // backend hasn't stamped active_gid yet (e.g. between a fresh start and
    // the next tellActive read).
    get currentTransfer() {
      const items = this.lastStatus?.items || [];
      const gid = this.state?.active_gid;
      return gid && items.find((it) => it && it.gid === gid) || items.find((it) => it && (Number(it.downloadSpeed) > 0 || Number(it.uploadSpeed) > 0)) || null;
    },
    get currentSpeed() {
      return this.currentTransfer?.downloadSpeed || this.state?.download_speed || null;
    },
    get currentUploadSpeed() {
      return this.currentTransfer?.uploadSpeed || null;
    },
    get itemsWithStatus() {
      return this.lastStatus?.items || [];
    },
    get filteredItems() {
      return this.filterQueueItems(this.itemsWithStatus);
    },
    get backendReachable() {
      if (!this.lastStatus) return true;
      return this.lastStatus?.ok !== false && this.lastStatus?.["ariaflow-server"]?.reachable !== false;
    },
    get filterCounts() {
      const s = this.lastStatus?.summary;
      if (s && !this.queueSearch) {
        return {
          all: s.total || 0,
          queued: s.queued || 0,
          waiting: s.waiting || 0,
          discovering: s.discovering || 0,
          active: s.active || 0,
          paused: s.paused || 0,
          removed: s.removed || 0,
          complete: s.complete || 0,
          error: s.error || 0
        };
      }
      const items = this.itemsWithStatus;
      const counts = { all: items.length, queued: 0, waiting: 0, discovering: 0, active: 0, paused: 0, removed: 0, complete: 0, error: 0 };
      items.forEach((item) => {
        const status = (item.status || "unknown").toLowerCase();
        if (status === "queued") counts.queued++;
        else if (status === "waiting") counts.waiting++;
        else if (status === "discovering") counts.discovering++;
        else if (status === "active") counts.active++;
        else if (status === "paused") counts.paused++;
        else if (status === "removed") counts.removed++;
        else if (status === "complete") counts.complete++;
        else if (status === "error") counts.error++;
      });
      return counts;
    },
    get schedulerStateLabelText() {
      return this.schedulerOverviewLabel(this.state, this.itemsWithStatus, this.currentTransfer);
    },
    get transferSpeedText() {
      if (!this.backendReachable) return "idle";
      const dl = this.currentSpeed ? this.formatRate(this.currentSpeed) : null;
      const ul = this.currentUploadSpeed ? this.formatRate(this.currentUploadSpeed) : null;
      if (dl && ul) return `\u2193 ${dl}  \u2191 ${ul}`;
      if (dl) return `\u2193 ${dl}`;
      return "idle";
    },
    get sessionStartedText() {
      if (!this.backendReachable) return "-";
      return this.timestampLabel(this.state.session_started_at);
    },
    get schedulerBtnText() {
      if (!this.backendReachable) return "Start";
      if (this.state?.dispatch_paused) return "Resume";
      if (this.state?.running) return "Pause";
      return "Start";
    },
    get schedulerBtnDisabled() {
      return !this.backendReachable;
    },
    get backendVersionText() {
      if (!this.backendReachable) return "-";
      const v = this.lastStatus?.["ariaflow-server"]?.version;
      return v ? `v${v}` : "unreported";
    },
    get backendPidText() {
      if (!this.backendReachable) return "-";
      return this.lastStatus?.["ariaflow-server"]?.pid || "unreported";
    },
    // Health data now comes from /api/status.health (BG-8). No separate timer needed.
    get lastHealth() {
      return this.lastStatus?.health || null;
    },
    get diskUsageText() {
      const h = this.lastHealth;
      if (!h || h.disk_usage_percent == null) return "-";
      return `${h.disk_usage_percent}%`;
    },
    get diskOk() {
      return this.lastHealth?.disk_ok !== false;
    },
    get healthUptimeText() {
      const s = this.lastHealth?.uptime_seconds;
      if (s == null) return "-";
      const h = Math.floor(s / 3600);
      const m = Math.floor(s % 3600 / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;
    },
    get downloadCapText() {
      if (!this.backendReachable) return "-";
      const bw = this.lastStatus?.bandwidth;
      return bw?.cap_mbps ? this.humanCap(this.formatMbps(bw.cap_mbps)) : this.humanCap(bw?.limit || "-");
    },
    get lastErrorText() {
      if (!this.backendReachable) return this.lastStatus?.["ariaflow-server"]?.error || "connection refused";
      return this.state.last_error || this.lastStatus?.bandwidth?.reason || "none";
    },
    // Consolidated health surface (#3). Single chip in the header lists
    // a count + opens a panel detailing each issue. Replaces the
    // separate Error + mDNS L1 chips and the implicit per-tab badge
    // duplication when several signals fire at once.
    get healthIssues() {
      const issues = [];
      if (!this.backendReachable) {
        issues.push({ label: `Backend offline: ${this.lastErrorText}`, level: "bad" });
      } else {
        const err = this.lastErrorText;
        if (err && err !== "none") issues.push({ label: `Last error: ${err}`, level: "warn" });
      }
      if (this.bonjourState === "broken") {
        issues.push({ label: "mDNS browse failing", level: "warn" });
      }
      if (this.lastHealth && this.lastHealth.disk_ok === false) {
        issues.push({ label: `Disk: ${this.diskUsageText}`, level: "bad" });
      }
      return issues;
    },
    get healthBadgeText() {
      const n = this.healthIssues.length;
      return n === 0 ? "Healthy" : `${n} issue${n === 1 ? "" : "s"}`;
    },
    get healthBadgeClass() {
      const issues = this.healthIssues;
      if (issues.length === 0) return "chip badge good";
      return issues.some((i) => i.level === "bad") ? "chip badge warn" : "chip badge";
    },
    get sessionIdText() {
      if (!this.backendReachable) return "-";
      return this.sessionLabel(this.state);
    },
    get sumQueued() {
      return this.lastStatus?.summary?.queued ?? 0;
    },
    get sumDone() {
      return this.filterCounts.done ?? 0;
    },
    get sumError() {
      return this.filterCounts.error ?? 0;
    },
    get canArchive() {
      return (this.lastStatus?.summary?.archivable_count ?? this.sumDone + this.sumError) > 0;
    },
    get archiveBtnDisabled() {
      return !this.backendReachable || !this.canArchive;
    },
    // bandwidth panel getters
    get bw() {
      return this.lastStatus?.bandwidth || {};
    },
    get bwInterfaceText() {
      if (!this.backendReachable) return "offline";
      return this.bw.interface_name || "unknown";
    },
    get bwSourceText() {
      if (!this.backendReachable) return "offline";
      return this.bw.source || "-";
    },
    get bwDownBadgeText() {
      if (!this.backendReachable) return "-";
      return this.bw.downlink_mbps ? this.formatMbps(this.bw.downlink_mbps) : "-";
    },
    get bwUpBadgeText() {
      if (!this.backendReachable) return "-";
      return this.bw.uplink_mbps ? this.formatMbps(this.bw.uplink_mbps) : "-";
    },
    get bwDownCapText() {
      if (!this.backendReachable) return "-";
      return this.bw.down_cap_mbps ? this.formatMbps(this.bw.down_cap_mbps) : this.bw.cap_mbps ? this.formatMbps(this.bw.cap_mbps) : "-";
    },
    get bwUpCapText() {
      if (!this.backendReachable) return "-";
      return this.bw.up_cap_mbps ? this.formatMbps(this.bw.up_cap_mbps) : "-";
    },
    get bwCurrentLimitText() {
      if (!this.backendReachable) return "-";
      const limit = this.bw.current_limit;
      return limit ? this.formatBytes(limit) + "/s" : "-";
    },
    get bwResponsivenessText() {
      if (!this.backendReachable) return "-";
      return this.bw.responsiveness_rpm ? Math.round(this.bw.responsiveness_rpm) + " RPM" : "-";
    },
    // bandwidth config getters (names must match backend contracts.py)
    // --- preference getters (numeric) ---
    _numPref(name, def) {
      return Number(this.getDeclarationPreference(name) ?? def);
    },
    get bwDownFreePercent() {
      return this._numPref("bandwidth_down_free_percent", 20);
    },
    get bwDownFreeAbsolute() {
      return this._numPref("bandwidth_down_free_absolute_mbps", 0);
    },
    get bwUpFreePercent() {
      return this._numPref("bandwidth_up_free_percent", 50);
    },
    get bwUpFreeAbsolute() {
      return this._numPref("bandwidth_up_free_absolute_mbps", 0);
    },
    get bwProbeInterval() {
      return this._numPref("bandwidth_probe_interval_seconds", 180);
    },
    get bwConcurrency() {
      return this._numPref("max_simultaneous_downloads", 1);
    },
    get bwDedupValue() {
      return this.getDeclarationPreference("duplicate_active_transfer_action") || "remove";
    },
    // options getters
    get autoPreflightEnabled() {
      return !!this.getDeclarationPreference("auto_preflight_on_run");
    },
    get postActionRuleValue() {
      return this.getDeclarationPreference("post_action_rule") || "pending";
    },
    // lifecycle
    lifecycleRows: [],
    _lifecycleSession: null,
    // cleanup & pagination
    archiveLimit: 100,
    logLimit: 120,
    // session history
    sessionHistory: [],
    // log state
    resultText: "Idle",
    resultJson: "Idle",
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
    aria2OptionResult: "",
    // openapi spec version (FE-29 / BG-37: detect spec/runtime stamp drift)
    specVersion: null,
    // test suite
    testLoading: false,
    uccLoading: false,
    preflightLoading: false,
    testSummaryVisible: false,
    lastTestStdout: "",
    lastTestStderr: "",
    testBadgeText: "-",
    testBadgeClass: "badge",
    testCountsText: "-",
    testResults: [],
    // --- init ---
    init() {
      const path = window.location.pathname.replace(/[/]+$/, "");
      this.page = path === "/bandwidth" ? "bandwidth" : path === "/lifecycle" ? "lifecycle" : path === "/options" ? "options" : path === "/log" ? "log" : path === "/dev" ? "dev" : path === "/archive" ? "archive" : "dashboard";
      this.initTheme();
      this.initNotifications();
      this._runTabMountHooks(this.page);
      window.addEventListener("beforeunload", () => {
        if (this._prefQueue.length) this._flushPrefQueue();
      });
      document.addEventListener("visibilitychange", () => this._onVisibilityChange());
      window.addEventListener("popstate", () => {
        const path2 = window.location.pathname.replace(/[/]+$/, "");
        const target = path2 === "/bandwidth" ? "bandwidth" : path2 === "/lifecycle" ? "lifecycle" : path2 === "/options" ? "options" : path2 === "/log" ? "log" : path2 === "/dev" ? "dev" : path2 === "/archive" ? "archive" : "dashboard";
        this.page = target;
        this._refreshTabOnly(target);
      });
      this._initFreshness();
      this.refreshInterval = readRefreshInterval(1e4);
      this._refreshAll();
      if (this.refreshInterval > 0) {
        this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
      }
      document.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
        const tabs = ["dashboard", "bandwidth", "lifecycle", "options", "log", "dev", "archive"];
        const idx = Number(e.key) - 1;
        if (idx >= 0 && idx < tabs.length) this.navigateTo(tabs[idx]);
      });
      this._initSSE();
      setTimeout(() => this.discoverBackends().catch((e) => console.warn(e.message)), 2e3);
    },
    // --- per-tab data routing ---
    // Each entry maps a tab to one or more endpoints; the FreshnessRouter
    // decides when to fetch (class + ttl + visibility + ref-count) and
    // calls `apply(self, data)` to update view state. Tab entry / exit
    // subscribes / unsubscribes; visibility is delegated to the router.
    // Declaration's "policies" field is surfaced via _applyDeclaration.
    TAB_SUBS: {
      dashboard: [
        { method: "GET", path: "/api/declaration", apply: (s, d) => s._applyDeclaration(d) }
      ],
      bandwidth: [
        { method: "GET", path: "/api/bandwidth", apply: (s, d) => s._applyBandwidth(d) },
        { method: "GET", path: "/api/declaration", apply: (s, d) => s._applyDeclaration(d) }
      ],
      lifecycle: [
        { method: "GET", path: "/api/lifecycle", apply: (s, d) => s._applyLifecycle(d) }
      ],
      options: [
        { method: "GET", path: "/api/aria2/global_option", apply: (s, d) => s._applyAria2GlobalOption(d) },
        { method: "GET", path: "/api/aria2/option_tiers", apply: (s, d) => s._applyAria2OptionTiers(d) },
        { method: "GET", path: "/api/torrents", apply: (s, d) => s._applyTorrents(d) },
        { method: "GET", path: "/api/peers", apply: (s, d) => s._applyPeers(d) },
        { method: "GET", path: "/api/declaration", apply: (s, d) => s._applyDeclaration(d) }
      ],
      log: [
        { method: "GET", path: "/api/web/log", getParams: () => ({ limit: 100 }), apply: (s, d) => s._applyWebLog(d) },
        { method: "GET", path: "/api/sessions/history", apply: (s, d) => s._applySessionHistory(d) },
        { method: "GET", path: "/api/declaration", apply: (s, d) => s._applyDeclaration(d) }
      ],
      archive: [
        {
          method: "GET",
          path: "/api/downloads/archive",
          getParams: (self) => ({ limit: self.archiveLimit }),
          apply: (self, data) => {
            self.archiveItems = data?.items || [];
          }
        }
      ]
    },
    // FE-31: dashboard-served endpoints (/api/web/log, /api/discovery)
    // now arrive via the dashboard's /api/_meta. /api/aria2/option_tiers
    // is the only remaining synthetic mirror — it's a backend endpoint
    // that BG-34 didn't include in the backend /api/_meta registry.
    LOCAL_METAS: [
      { method: "GET", path: "/api/aria2/option_tiers", freshness: "cold" },
      // Backend's /api/sessions/history is a real endpoint but not yet
      // in the backend's /api/_meta registry — register synthetically
      // until backend declares it (see backend gap BG-39).
      { method: "GET", path: "/api/sessions/history", freshness: "swr", ttl_s: 30 }
    ],
    // One-shot actions to run when a tab becomes the active page (either
    // on direct URL load via init() or via navigateTo()). For tab-driven
    // *recurring* fetches use TAB_SUBS instead — the FreshnessRouter
    // handles those. Mount hooks are for things like loadSpecVersion()
    // that don't fit the subscribe model.
    TAB_MOUNT_HOOKS: {
      dev: [(self) => self.loadSpecVersion()]
    },
    _tabHidden: false,
    _currentTabSubs: [],
    _runTabMountHooks(target) {
      const hooks = this.TAB_MOUNT_HOOKS && this.TAB_MOUNT_HOOKS[target] || [];
      for (const fn of hooks) {
        try {
          fn(this);
        } catch (e) {
        }
      }
    },
    _unsubscribeTab() {
      if (!this._freshnessRouter) {
        this._currentTabSubs = [];
        return;
      }
      for (const s of this._currentTabSubs) {
        try {
          this._freshnessRouter.unsubscribe(s.method, s.path, s.id);
        } catch (e) {
        }
      }
      this._currentTabSubs = [];
    },
    _subscribeTab(target) {
      this._unsubscribeTab();
      if (!this._freshnessRouter) return;
      const subs = this.TAB_SUBS && this.TAB_SUBS[target] || [];
      for (const s of subs) {
        const id = `tab:${target}:${s.method} ${s.path}`;
        const params = s.getParams ? s.getParams(this) : void 0;
        try {
          this._freshnessRouter.subscribe(s.method, s.path, id, {
            visible: true,
            params,
            onUpdate: (v) => {
              try {
                s.apply(this, v);
              } catch (e) {
                console.warn(e);
              }
            }
          });
          this._currentTabSubs.push({ method: s.method, path: s.path, id });
        } catch (e) {
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
    navigateTo(target) {
      if (this.page === target) return;
      this.page = target;
      const urlMap = { dashboard: "/", bandwidth: "/bandwidth", lifecycle: "/lifecycle", options: "/options", log: "/log", dev: "/dev", archive: "/archive" };
      history.pushState(null, "", urlMap[target] || "/");
      this._refreshTabOnly(target);
      this._runTabMountHooks(target);
    },
    _onVisibilityChange() {
      const hidden = document.visibilityState === "hidden";
      if (hidden === this._tabHidden) return;
      this._tabHidden = hidden;
      if (hidden) {
        if (this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
        }
        if (this._sseFallbackTimer) {
          clearTimeout(this._sseFallbackTimer);
          this._sseFallbackTimer = null;
        }
        if (this._deferTimer) {
          clearTimeout(this._deferTimer);
          this._deferTimer = null;
        }
        this._unsubscribeTab();
        this._closeSSE();
      } else {
        if (this.refreshInterval > 0) {
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
        }
        this._refreshAll();
        this._initSSE();
      }
    },
    // --- formatting ---
    // --- formatters (delegated to formatters.js) ---
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
    schedulerStateLabel(state, reachable = true) {
      if (!reachable) return "offline";
      if (state?.stop_requested) return "stopping";
      return state?.running ? "running" : "idle";
    },
    schedulerOverviewLabel(state, items, active) {
      if (!state?.running) return "scheduler idle";
      if (state?.dispatch_paused) return "paused";
      if (active && active.status && active.status !== "idle") return active.status;
      if ((items || []).length) return "ready";
      return "idle";
    },
    syncSchedulerResultText() {
      const staleSchedulerMessages = /* @__PURE__ */ new Set([
        "Pause requested",
        "Resume requested",
        "Downloads paused",
        "Downloads resumed",
        "Scheduler started",
        "Scheduler already running"
      ]);
      if (!staleSchedulerMessages.has(this.resultText)) return;
      if (!this.backendReachable) return;
      if (!this.state?.running) {
        this.resultText = "Scheduler idle";
        return;
      }
      this.resultText = this.state?.dispatch_paused ? "Downloads paused" : "Downloads running";
    },
    _offlineStatusLabel() {
      const data = this.lastStatus;
      const error = data?.["ariaflow-server"]?.error || data?.error || "backend unavailable";
      return `Backend unavailable \xB7 ${error}`;
    },
    // --- sparklines (rendering delegated to sparkline.js) ---
    recordSpeed(itemId, speed) {
      const next = recordItemSpeed(this.speedHistory, itemId, speed);
      if (next !== this.speedHistory) this.speedHistory = next;
    },
    renderSparkline(itemId) {
      return renderItemSparkline(this.speedHistory[itemId]);
    },
    recordGlobalSpeed(dlSpeed, ulSpeed) {
      const next = appendGlobalSpeed(
        { download: this.globalSpeedHistory, upload: this.globalUploadHistory },
        dlSpeed,
        ulSpeed
      );
      this.globalSpeedHistory = next.download;
      this.globalUploadHistory = next.upload;
    },
    get globalSparklineSvg() {
      return renderGlobalSparkline(this.globalSpeedHistory, this.globalUploadHistory);
    },
    // --- notifications ---
    checkNotifications(items) {
      const { notifications, nextStatusMap } = diffItemStatuses(this.previousItemStatuses, items);
      this.previousItemStatuses = nextStatusMap;
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      for (const n of notifications) {
        new Notification(n.title, { body: n.body, tag: n.tag });
      }
    },
    initNotifications() {
      if (typeof Notification === "undefined" || Notification.permission !== "default") return;
      const handler = () => {
        Notification.requestPermission();
        document.removeEventListener("click", handler);
      };
      document.addEventListener("click", handler);
    },
    // --- theme (delegated to @bonomani/webstyle/simple-theme-controller:
    // look auto-detected from platform, mode = light/dark/auto, no a11y) ---
    // Cycle: auto → light → dark → auto. Label shows the *next* mode
    // a click selects, not the current state — clearer than reporting
    // "Theme: dark" which doesn't tell the user what clicking will do.
    themeLabel: "Switch to light",
    _themeController: null,
    initTheme() {
      const nextMode = { auto: "light", light: "dark", dark: "auto" };
      this._themeController = createSimpleThemeController({ apply: applyLook });
      this._themeController.subscribe((s) => {
        this.themeLabel = `Switch to ${nextMode[s.mode] ?? "auto"}`;
      });
    },
    toggleTheme() {
      this._themeController?.cycleMode();
    },
    async _initFreshness() {
      try {
        const router = await bootstrapFreshnessRouter({
          metaUrl: () => this.backendPath("/api/_meta"),
          dashboardMetaUrl: () => "/api/_meta",
          now: () => Date.now(),
          setTimer: (cb, ms) => setTimeout(cb, ms),
          clearTimer: (token) => clearTimeout(token),
          fetchJson: async (method, path, params, host) => {
            let url = host === "dashboard" ? path : this.backendPath(path);
            if (params) {
              const qs = new URLSearchParams();
              for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
              const s = qs.toString();
              if (s) url += (url.includes("?") ? "&" : "?") + s;
            }
            const r = await apiFetch(url, { method, timeoutMs: 8e3 });
            return r.json();
          }
        });
        if (!router) return;
        for (const m of this.LOCAL_METAS || []) {
          try {
            router.registerMeta(m);
          } catch (e) {
          }
        }
        this._freshnessRouter = router;
        this._freshnessVisibility = wireHostVisibility(router);
        this._subscribeTab(this.page);
      } catch (e) {
      }
    },
    // --- fetch with timeout ---
    _fetch(url, opts = {}, timeout = 1e4) {
      const promise = apiFetch(url, { ...opts, timeoutMs: timeout });
      const method = (opts && opts.method ? String(opts.method) : "GET").toUpperCase();
      if (method !== "GET" && this._freshnessRouter) {
        promise.then((r) => {
          if (r && r.ok) {
            try {
              const path = new URL(url, window.location.origin).pathname;
              this._freshnessRouter.invalidateByAction(method, path);
            } catch {
            }
          }
        }).catch(() => {
        });
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
      return loadBackendState(this.DEFAULT_BACKEND_URL);
    },
    saveBackendState(backends, selected) {
      const next = saveBackendState(backends || [], selected, this.DEFAULT_BACKEND_URL);
      this._cachedBackends = next.backends;
      this._cachedSelectedBackend = next.selected;
    },
    mergeDiscoveredBackends(items) {
      const result = mergeDiscoveredItems(
        items,
        this.backendMeta,
        this.loadBackendState(),
        { defaultBackendUrl: this.DEFAULT_BACKEND_URL, localIps: this.localIps || [] }
      );
      this.backendMeta = result.meta;
      this._cachedBackends = result.state.backends;
      this._cachedSelectedBackend = result.state.selected;
      if (result.autoSelectedUrl) {
        this._closeSSE();
        this._initSSE();
        this.deferRefresh(0);
      }
    },
    backendDisplayName(url) {
      return backendDisplayName(
        url,
        this.backendMeta,
        this.DEFAULT_BACKEND_URL,
        localMainIp()
      );
    },
    backendPath(path) {
      return backendPath(
        this.loadBackendState().selected || this.DEFAULT_BACKEND_URL,
        path
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
      this._refreshAll();
    },
    addBackend() {
      const value = (this.backendInput || "").trim();
      if (!value) return;
      const state = this.loadBackendState();
      if (value !== this.DEFAULT_BACKEND_URL && !state.backends.includes(value)) state.backends.push(value);
      this.saveBackendState(state.backends, value);
      this.backendInput = "";
      this.deferRefresh(0);
    },
    removeBackend(backend) {
      const state = this.loadBackendState();
      this.saveBackendState(state.backends.filter((item) => item !== backend), state.selected === backend ? this.DEFAULT_BACKEND_URL : state.selected);
      this.deferRefresh(0);
    },
    async discoverBackends() {
      let bonjourItems = [];
      try {
        const r = await this._fetch("/api/discovery");
        const data = await r.json();
        bonjourItems = Array.isArray(data?.items) ? data.items : [];
        if (data?.available === false) {
          this.bonjourState = "unavailable";
        } else if (bonjourItems.length === 0) {
          this.bonjourState = "broken";
        } else {
          this.bonjourState = "ok";
        }
        this.mergeDiscoveredBackends(bonjourItems);
      } catch (e) {
        this.bonjourState = "broken";
      }
      let peerItems = [];
      if (bonjourItems.length === 0 && this.backendReachable) {
        try {
          const r = await this._fetch(this.backendPath("/api/peers"));
          const data = await r.json();
          const peers = Array.isArray(data?.peers) ? data.peers : [];
          peerItems = peers.filter((p) => p && (p.base_url || p.host && p.port)).map((p) => ({
            url: p.base_url || `http://${p.host}:${p.port}`,
            name: p.instance || p.host || "",
            host: p.host || "",
            ip: "",
            role: "backend",
            source: "peers"
          }));
          if (peerItems.length > 0) this.mergeDiscoveredBackends(peerItems);
        } catch (e) {
        }
      }
      const total = bonjourItems.length + peerItems.length;
      this.backendsDiscovered = total > 0;
      this.discoveryText = total > 0 ? `Discovered ${total} backend service(s)${peerItems.length && !bonjourItems.length ? " via /api/peers fallback" : ""}` : "No Bonjour backends discovered";
    },
    get bonjourBadgeText() {
      return { pending: "mDNS \u2026", ok: "mDNS \u2713", broken: "mDNS \u2717", "unavailable": "mDNS N/A" }[this.bonjourState] || "mDNS";
    },
    get bonjourBadgeClass() {
      return { pending: "badge", ok: "badge good", broken: "badge warn", unavailable: "badge" }[this.bonjourState] || "badge";
    },
    get bonjourBadgeTitle() {
      return {
        pending: "Discovering Bonjour services\u2026",
        ok: "Bonjour discovery working",
        broken: "Bonjour returned no results",
        unavailable: "No mDNS tool (dns-sd/avahi) available on this machine"
      }[this.bonjourState] || "";
    },
    // --- queue ---
    filterQueueItems(items) {
      return filterQueueItems(items, this.queueFilter, this.queueSearch);
    },
    setQueueFilter(filter) {
      this.queueFilter = filter;
      this._statusETag = null;
    },
    filterBtnVisible(f) {
      return isFilterButtonVisible(f, this.filterCounts, this.queueFilter);
    },
    // queue item helpers for template
    itemNormalizedStatus(item) {
      return item.status || "unknown";
    },
    itemHasActiveStatus(item) {
      return ["active", "paused"].includes(item.status || "unknown");
    },
    itemShortUrl(item) {
      return this.shortName(item.output || item.url || "(no url)");
    },
    itemDetail(item) {
      const gid = item.gid ? `GID ${String(item.gid).slice(0, 8)}` : null;
      return [
        item.created_at ? `Added ${this.relativeTime(item.created_at)}` : null,
        item.completed_at ? `Done ${this.relativeTime(item.completed_at)}` : null,
        item.error_at ? `Failed ${this.relativeTime(item.error_at)}` : null,
        gid
      ].filter(Boolean).join(" \xB7 ");
    },
    itemLiveStatus(item) {
      return item.live_status || null;
    },
    itemSpeed(item) {
      return item.downloadSpeed;
    },
    itemTotalLength(item) {
      return item.totalLength;
    },
    itemCompletedLength(item) {
      return item.completedLength;
    },
    itemProgress(item) {
      if (item.percent != null) return item.percent;
      const total = Number(item.totalLength || 0);
      const completed = Number(item.completedLength || 0);
      return total > 0 ? completed / total * 100 : 0;
    },
    itemShowTransferPanel(item) {
      return this.itemHasActiveStatus(item) || item.totalLength || item.completedLength || item.percent != null;
    },
    itemRateLabel(item) {
      const speed = this.itemSpeed(item);
      if (speed) return this.formatRate(speed);
      if (item.rpc_failures) {
        return /timed out/i.test(item.rpc_error_message || "") ? "timed out" : "rpc issue";
      }
      if (item.error_code === "rpc_unreachable" || /timed out/i.test(item.error_message || "")) {
        return "timed out";
      }
      if (["active", "waiting"].includes(this.itemNormalizedStatus(item))) return "stale";
      return this.itemNormalizedStatus(item) === "paused" ? "paused" : "idle";
    },
    itemShowPausedAt(item) {
      return this.itemNormalizedStatus(item) === "paused" && !!item.paused_at;
    },
    itemModeBadge(item) {
      const mode = item.mode || item.download_mode || null;
      if (!mode || mode === "http") return null;
      return mode;
    },
    itemPriority(item) {
      return item.priority != null ? item.priority : null;
    },
    itemDisplayUrl(item) {
      return item.url || "";
    },
    itemStateLabel(item) {
      const ns = this.itemNormalizedStatus(item);
      if (item.rpc_failures) {
        const limit = Number(item.rpc_failure_limit || 0);
        const detail = /timed out/i.test(item.rpc_error_message || "") ? "rpc timeout" : "rpc issue";
        return limit > 0 ? `${ns} \xB7 ${detail} ${item.rpc_failures}/${limit}` : `${ns} \xB7 ${detail}`;
      }
      return ns;
    },
    itemAllowedActions(item) {
      return item.allowed_actions || [];
    },
    itemCanPause(item) {
      const aa = this.itemAllowedActions(item);
      return aa.length ? aa.includes("pause") : this.itemNormalizedStatus(item) === "active";
    },
    itemCanResume(item) {
      const aa = this.itemAllowedActions(item);
      return aa.length ? aa.includes("resume") : this.itemNormalizedStatus(item) === "paused";
    },
    itemCanRetry(item) {
      const aa = this.itemAllowedActions(item);
      return aa.length ? aa.includes("retry") : ["error", "removed"].includes(this.itemNormalizedStatus(item));
    },
    itemCanRemove(item) {
      const aa = this.itemAllowedActions(item);
      return aa.length ? aa.includes("remove") : true;
    },
    itemToggleAction(item) {
      if (this.itemCanPause(item)) return this.itemAction(item.id, "pause");
      if (this.itemCanResume(item)) return this.itemAction(item.id, "resume");
      if (this.itemCanRetry(item)) return this.itemAction(item.id, "retry");
    },
    itemToggleLabel(item) {
      if (this.itemCanPause(item)) return "Pause";
      if (this.itemCanResume(item)) return "Resume";
      if (this.itemCanRetry(item)) return "Retry";
      return "";
    },
    itemCanToggle(item) {
      return this.itemCanPause(item) || this.itemCanResume(item) || this.itemCanRetry(item);
    },
    itemEta(item) {
      return this.formatEta(this.itemTotalLength(item), this.itemCompletedLength(item), this.itemSpeed(item));
    },
    itemSparklineSvg(item) {
      if (!item.id) return "";
      if (this.itemHasActiveStatus(item)) this.recordSpeed(item.id, this.itemSpeed(item) || 0);
      return this.renderSparkline(item.id);
    },
    // --- SSE ---
    _initSSE() {
      if (this._sse) {
        this._sse.close();
        this._sse = null;
      }
      const url = this.backendPath("/api/events");
      let es;
      try {
        es = new EventSource(url);
      } catch (e) {
        return;
      }
      this._sse = es;
      const markActivity = () => {
        this._sseLastActivityAt = Date.now();
      };
      es.addEventListener("connected", () => {
        this._sseConnected = true;
        this._sseReconnectAttempts = 0;
        markActivity();
        this._armSseLivenessTimer();
        if (this._sseFallbackTimer) {
          clearTimeout(this._sseFallbackTimer);
          this._sseFallbackTimer = null;
        }
        if (this._deferTimer) {
          clearTimeout(this._deferTimer);
          this._deferTimer = null;
        }
        if (this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = null;
        }
      });
      es.addEventListener("state_changed", (e) => {
        markActivity();
        const evt = parseStateChangedEvent(e.data);
        if (evt.kind === "full") {
          if (evt.isOffline) {
            this._consecutiveFailures++;
            if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
              this.lastStatus = evt.data;
            }
            return;
          }
          this._consecutiveFailures = 0;
          this.lastStatus = evt.data;
          this.lastRev = evt.data._rev || null;
          this.checkNotifications(this.itemsWithStatus);
          this.recordGlobalSpeed(this.currentSpeed || 0, this.currentUploadSpeed || 0);
        } else if (evt.kind === "rev" && evt.rev !== this.lastRev) {
          this.refresh();
        }
      });
      es.addEventListener("action_logged", (e) => {
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
            const r = await this._fetch(this.backendPath("/api/health"), {}, 3e3);
            if (r.ok && !this.refreshTimer && this.refreshInterval > 0) {
              this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
            }
          } catch (e) {
          }
          const delay = nextReconnectDelayMs(this._sseReconnectAttempts);
          this._sseReconnectAttempts++;
          this._sseFallbackTimer = setTimeout(() => this._initSSE(), delay);
        }, 2e3);
      };
    },
    _closeSSE() {
      if (this._sse) {
        this._sse.close();
        this._sse = null;
      }
      this._sseConnected = false;
      this._disarmSseLivenessTimer();
    },
    _armSseLivenessTimer() {
      this._disarmSseLivenessTimer();
      this._sseLivenessTimer = setInterval(() => {
        if (!this._sseConnected) return;
        if (isStreamStale(this._sseLastActivityAt, Date.now(), this.SSE_LIVENESS_TIMEOUT_MS)) {
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
      this._subscribeTab(this.page);
    },
    _deferTimer: null,
    deferRefresh(delay = 300) {
      if (this._deferTimer) clearTimeout(this._deferTimer);
      this._deferTimer = setTimeout(() => {
        this._deferTimer = null;
        this.refresh();
      }, delay);
    },
    _consecutiveFailures: 0,
    _statusETag: null,
    _statusUrl() {
      return buildStatusUrl(this.backendPath("/api/status"), {
        queueFilter: this.queueFilter,
        sessionFilter: this.sessionFilter
      });
    },
    async refresh() {
      if (this.refreshInFlight) return;
      this.refreshInFlight = true;
      try {
        const opts = {};
        if (this._statusETag) opts.headers = { "If-None-Match": this._statusETag };
        const r = await this._fetch(this._statusUrl(), opts);
        if (r.status === 304) {
          this.syncSchedulerResultText();
          return;
        }
        const etag = r.headers.get("ETag");
        if (etag) this._statusETag = etag;
        const data = await r.json();
        if (data?._rev && this.lastRev === data._rev) return;
        this.lastRev = data?._rev || null;
        if (data?.ok === false || data?.["ariaflow-server"]?.reachable === false) {
          this._consecutiveFailures++;
          if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
            this.lastStatus = data;
          }
          this.recordGlobalSpeed(0, 0);
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
        const message = e && e.message ? e.message : "connection refused";
        if (shouldShowOfflineStatus(this._consecutiveFailures, !!this.lastStatus)) {
          this.lastStatus = {
            ...this.lastStatus || {},
            ok: false,
            "ariaflow-server": {
              ...this.lastStatus?.["ariaflow-server"] || {},
              reachable: false,
              error: message
            }
          };
        }
        this.recordGlobalSpeed(0, 0);
      } finally {
        this.refreshInFlight = false;
        if (this._consecutiveFailures > 0 && this.refreshTimer && !this._sseConnected) {
          const backoff = Math.min(this.refreshInterval * Math.pow(2, this._consecutiveFailures), 6e4);
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), backoff);
          this._inBackoff = true;
          this._unsubscribeTab();
        } else if (this._consecutiveFailures === 0 && this._inBackoff && this.refreshTimer) {
          clearInterval(this.refreshTimer);
          this.refreshTimer = setInterval(() => this.refresh(), this.refreshInterval);
          this._inBackoff = false;
          this._subscribeTab(this.page);
        }
      }
    },
    // --- declaration ---
    getDeclarationPreference(name) {
      const prefs = this.lastDeclaration?.uic?.preferences || [];
      const pref = prefs.find((item) => item.name === name);
      return pref ? pref.value : void 0;
    },
    _applyDeclaration(data) {
      this.lastDeclaration = data;
      if (data?.ok === false || data?.["ariaflow-server"]?.reachable === false) return;
      this.declarationText = JSON.stringify(this.lastDeclaration, null, 2);
    },
    async saveDeclaration() {
      let parsed;
      try {
        parsed = JSON.parse(this.declarationText);
      } catch (e) {
        this.resultText = `Invalid JSON: ${e.message}`;
        return;
      }
      const r = await this._fetch(this.backendPath("/api/declaration"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const data = await r.json();
      this.lastDeclaration = data.declaration || data;
      this.resultText = "Declaration saved";
      this.resultJson = JSON.stringify(data, null, 2);
    },
    // --- preference helpers ---
    _prefQueue: [],
    _prefTimer: null,
    _prefSaving: false,
    _queuePrefChange(name, value, options, rationale, delay = 0) {
      this._prefQueue = this._prefQueue.filter((p) => p.name !== name);
      this._prefQueue.push({ name, value, options, rationale });
      if (this.lastDeclaration?.uic?.preferences) {
        const prefs = this.lastDeclaration.uic.preferences;
        const idx = prefs.findIndex((p) => p.name === name);
        const next = { name, value, options, rationale };
        const updated = [...prefs];
        if (idx >= 0) updated[idx] = next;
        else updated.push(next);
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
        const r = await this._fetch(this.backendPath("/api/declaration/preferences"), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (data.declaration) this.lastDeclaration = data.declaration;
      } catch (e) {
        console.warn("Preference save failed:", e.message);
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
      this._queuePrefChange("max_simultaneous_downloads", limit, [1], "1 preserves the sequential default", 400);
    },
    setDuplicateAction(value) {
      this._queuePrefChange("duplicate_active_transfer_action", value, ["remove", "pause", "ignore"], "remove duplicate live jobs by default");
    },
    setAutoPreflightPreference(enabled) {
      this._queuePrefChange("auto_preflight_on_run", !!enabled, [true, false], "default off");
    },
    setPostActionRule(value) {
      this._queuePrefChange("post_action_rule", value, ["pending"], "default placeholder");
    },
    // --- actions ---
    async add() {
      const raw = this.urlInput.trim();
      const urls = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const items = urls.map((url) => {
        const item = { url };
        if (this.addOutput.trim()) item.output = this.addOutput.trim();
        if (this.addPriority !== "") item.priority = Number(this.addPriority);
        const mirrors = this.addMirrors.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (mirrors.length) item.mirrors = mirrors;
        if (this.addTorrentData) item.torrent_data = this.addTorrentData;
        if (this.addMetalinkData) item.metalink_data = this.addMetalinkData;
        if (this.addPostActionRule) item.post_action_rule = this.addPostActionRule;
        return item;
      });
      const payload = { items };
      const r = await this._fetch(this.backendPath("/api/downloads"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (!r.ok || data.ok === false) {
        this.resultText = data.message || "Add request failed";
        this.resultJson = JSON.stringify(data, null, 2);
        return;
      }
      const queued = Array.isArray(data.added) ? data.added.length : 0;
      this.resultText = queued > 1 ? `Queued ${queued} items` : `Queued: ${data.added?.[0]?.url || urls[0] || raw}`;
      this.resultJson = JSON.stringify(data, null, 2);
      this.addOutput = "";
      this.addPriority = "";
      this.addMirrors = "";
      this.addTorrentData = null;
      this.addMetalinkData = null;
      this.addPostActionRule = "";
    },
    handleFileUpload(event, type) {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(",")[1] || "";
        if (type === "torrent") this.addTorrentData = base64;
        else if (type === "metalink") this.addMetalinkData = base64;
      };
      reader.readAsDataURL(file);
    },
    async toggleScheduler() {
      this.schedulerLoading = true;
      try {
        if (!this.state?.running) return await this.schedulerAction("start");
        if (this.state?.dispatch_paused) return await this.resumeDownloads();
        return await this.pauseDownloads();
      } finally {
        this.schedulerLoading = false;
      }
    },
    async schedulerAction(action) {
      if (action !== "start" && action !== "stop") {
        this.resultText = `Unknown scheduler action: ${action}`;
        return;
      }
      const endpoint = `/api/scheduler/${action}`;
      const payload = action === "start" ? { auto_preflight_on_run: this.autoPreflightEnabled } : {};
      try {
        const r = await this._fetch(this.backendPath(endpoint), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const data = await r.json();
        if (!r.ok || data.ok === false) {
          this.resultText = data.message || `Scheduler ${action} failed`;
          this.resultJson = JSON.stringify(data, null, 2);
          return;
        }
        const result = data.result || {};
        if (action === "start") {
          this.resultText = result.started ? "Scheduler started" : "Scheduler already running";
          if (this.lastStatus?.state && result.started) {
            this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, running: true } };
          }
        } else {
          this.resultText = result.stopped ? "Scheduler stopped" : "Scheduler already idle";
          if (this.lastStatus?.state && result.stopped) {
            this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, running: false } };
          }
        }
        this.resultJson = JSON.stringify(data, null, 2);
      } catch (e) {
        this.resultText = `Scheduler ${action} failed: ${e.message}`;
      }
    },
    async pauseDownloads() {
      this.resultText = "";
      try {
        const r = await postEmpty(this.backendPath(urlScheduler("pause")));
        const data = await r.json();
        this.resultText = data.paused ? "Downloads paused" : data.message || (data.reason === "no_active_transfer" ? "No active transfer to pause" : "Pause failed");
        this.resultJson = JSON.stringify(data, null, 2);
        if (this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: true } };
      } catch (e) {
        this.resultText = `Pause failed: ${e.message}`;
      }
    },
    async resumeDownloads() {
      this.resultText = "";
      try {
        const r = await postEmpty(this.backendPath(urlScheduler("resume")));
        const data = await r.json();
        this.resultText = data.resumed ? "Downloads resumed" : data.message || (data.reason === "no_active_transfer" ? "No active transfer to resume" : "Resume failed");
        this.resultJson = JSON.stringify(data, null, 2);
        if (this.lastStatus?.state) this.lastStatus = { ...this.lastStatus, state: { ...this.lastStatus.state, paused: false } };
      } catch (e) {
        this.resultText = `Resume failed: ${e.message}`;
      }
    },
    async itemAction(itemId, action) {
      const prevItems = this.lastStatus?.items ? JSON.parse(JSON.stringify(this.lastStatus.items)) : null;
      const statusMap = { pause: "paused", resume: "queued", retry: "queued" };
      if (this.lastStatus?.items && statusMap[action]) {
        this.lastStatus = { ...this.lastStatus, items: this.lastStatus.items.map((i) => i.id === itemId ? { ...i, status: statusMap[action] } : i) };
      }
      if (action === "remove" && this.lastStatus?.items) {
        this.lastStatus = { ...this.lastStatus, items: this.lastStatus.items.filter((i) => i.id !== itemId) };
      }
      let r, data;
      try {
        r = await postEmpty(this.backendPath(urlItemAction(itemId, action)));
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
      const r = await this._fetch(this.backendPath(urlItemFiles(this.fileSelectionItemId)), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ select: selected })
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
    loadMoreArchive() {
      this.archiveLimit += 100;
      this._subscribeTab("archive");
    },
    async cleanup() {
      this.archiveLoading = true;
      try {
        const r = await this._fetch(this.backendPath("/api/downloads/cleanup"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ max_done_age_days: 7, max_done_count: 100 })
        });
        const data = await r.json();
        this.resultText = data.ok ? `Cleanup complete \u2014 ${data.archived || 0} archived` : data.message || "Cleanup requested";
        this.resultJson = JSON.stringify(data, null, 2);
      } finally {
        this.archiveLoading = false;
      }
    },
    // --- bandwidth ---
    probeLoading: false,
    async runProbe() {
      this.probeLoading = true;
      this.resultText = "Probe running...";
      try {
        const r = await postEmpty(this.backendPath("/api/bandwidth/probe"));
        const data = await r.json();
        this.resultText = data.ok ? "Probe complete" : data.message || "Probe finished";
        this.resultJson = JSON.stringify(data, null, 2);
      } catch (e) {
        this.resultText = `Probe failed: ${e.message}`;
      } finally {
        this.probeLoading = false;
      }
    },
    _applyBandwidth(data) {
      if (data && data.ok !== false) {
        this.lastStatus = { ...this.lastStatus || {}, bandwidth: data };
      }
    },
    // --- lifecycle ---
    _applyLifecycle(data) {
      this.lastLifecycle = data;
      if (data?.ok === false || data?.["ariaflow-server"]?.reachable === false) {
        this.lifecycleRows = [];
        return;
      }
      this.lifecycleRows = [
        {
          name: "ariaflow-server",
          record: data["ariaflow-server"],
          actions: lifecycleActionsFor("ariaflow-server", data["ariaflow-server"])
        },
        { name: "aria2", record: data.aria2, actions: lifecycleActionsFor("aria2", data.aria2) },
        { name: "networkquality", record: data.networkquality, actions: [] },
        {
          name: "aria2 auto-start",
          record: data["aria2-launchd"],
          actions: lifecycleActionsFor("aria2 auto-start", data["aria2-launchd"])
        }
      ];
      this._lifecycleSession = data?.session_id ? data : null;
    },
    async loadLifecycle() {
      try {
        const r = await this._fetch(this.backendPath("/api/lifecycle"));
        this._applyLifecycle(await r.json());
      } catch (e) {
        this.lifecycleRows = [];
      }
    },
    // True if a lifecycle row is in a healthy state — checks the BG-27
    // three axes (installed / current / running, with expected_running
    // from BG-29 modulating the running check).
    lifecycleHealthy(row) {
      if (row?.name?.includes("aria2 auto-start")) return true;
      return isLifecycleHealthy(row?.record);
    },
    get lifecycleErrorCount() {
      return (this.lifecycleRows || []).filter((r) => !this.lifecycleHealthy(r)).length;
    },
    lifecycleStateLabel(name, record) {
      return describeLifecycleStatus(name, record);
    },
    lifecycleBadgeClass(record) {
      return lifecycleBadgeClass(record);
    },
    lifecycleItemOutcome(record) {
      return record?.result?.outcome || "unknown";
    },
    lifecycleItemLines(record) {
      const lines = lifecycleDetailLines(record);
      return lines.length ? lines.join(" \xB7 ") : "No details";
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
        const r = await postEmpty(this.backendPath(urlScheduler("preflight")));
        const data = await r.json();
        this.resultText = data.status === "pass" ? "Preflight passed" : "Preflight needs attention";
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
        const r = await postEmpty(this.backendPath(urlScheduler("ucc")));
        const data = await r.json();
        const outcome = data.result?.outcome || "unknown";
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
      return this.contractTraceItems?.result?.outcome || "unknown";
    },
    async refreshActionLog() {
      if (this.page !== "log") return;
      try {
        const r = await this._fetch(this.backendPath(`/api/log?limit=${this.logLimit}`));
        const data = await r.json();
        if (data?.ok === false || data?.["ariaflow-server"]?.reachable === false) {
          this.actionLogEntries = [];
          return;
        }
        this.actionLogEntries = data.items || [];
        if (this.actionFilter !== "all" && !this.availableActions.includes(this.actionFilter)) this.actionFilter = "all";
        if (this.targetFilter !== "all" && !this.availableTargets.includes(this.targetFilter)) this.targetFilter = "all";
      } catch (e) {
        this.actionLogEntries = [];
      }
    },
    _applyWebLog(data) {
      this.webLogEntries = data?.items || [];
    },
    get availableActions() {
      return distinctActions(this.actionLogEntries);
    },
    get availableTargets() {
      return distinctTargets(this.actionLogEntries);
    },
    get filteredActionLog() {
      const currentSessionId = this.state?.session_id || this.lastLifecycle?.session_id || this.lastDeclaration?.session_id || null;
      return filterActionLog(this.actionLogEntries, {
        actionFilter: this.actionFilter,
        targetFilter: this.targetFilter,
        sessionFilter: this.sessionFilter,
        currentSessionId
      });
    },
    sanitizeLogValue(value, depth = 0) {
      if (value == null) return value;
      if (depth >= 2) return "[trimmed]";
      if (Array.isArray(value)) {
        if (!value.length) return [];
        if (value.length > 4) return [`[${value.length} items]`];
        return value.map((item) => this.sanitizeLogValue(item, depth + 1));
      }
      if (typeof value !== "object") return value;
      const result = {};
      for (const [key, entry] of Object.entries(value)) {
        if (key === "bitfield") {
          result[key] = "[trimmed]";
          continue;
        }
        if (key === "files") {
          const f = Array.isArray(entry) ? entry.length : 0;
          result[key] = `[${f} file${f === 1 ? "" : "s"}]`;
          continue;
        }
        if (key === "uris") {
          const u = Array.isArray(entry) ? entry.length : 0;
          result[key] = `[${u} uri${u === 1 ? "" : "s"}]`;
          continue;
        }
        result[key] = this.sanitizeLogValue(entry, depth + 1);
      }
      return result;
    },
    summarizePollEntry(entry) {
      const detail = entry?.detail || {};
      const status = detail.status || entry?.outcome || "unknown";
      const done = detail.completedLength ? this.formatBytes(detail.completedLength) : null;
      const total = detail.totalLength ? this.formatBytes(detail.totalLength) : null;
      const speed = detail.downloadSpeed ? this.formatRate(detail.downloadSpeed) : null;
      const target = this.shortName(detail.url || detail.gid || "-");
      const parts = [target];
      if (done && total) parts.push(`${done}/${total}`);
      if (speed) parts.push(speed);
      return parts.join(" \xB7 ");
    },
    logEntryLines(entry) {
      if (entry.action === "poll") {
        const summary = this.summarizePollEntry(entry);
        return entry._pollCount > 1 ? `${summary} (${entry._pollCount} polls)` : summary;
      }
      return [
        entry.message || entry.reason || null,
        entry.target ? entry.target : null,
        entry.timestamp ? this.relativeTime(entry.timestamp) : null
      ].filter(Boolean).join(" \xB7 ");
    },
    // --- per-item aria2 options ---
    async loadItemOptions(gid) {
      if (!gid) return;
      if (this.itemOptionsGid === gid) {
        this.itemOptionsGid = null;
        this.itemOptionsData = null;
        return;
      }
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
    _applySessionHistory(data) {
      this.sessionHistory = data?.history || [];
    },
    // --- aria2 options ---
    _applyAria2GlobalOption(data) {
      if (data && data.ok !== false) this.aria2Options = data;
    },
    _applyAria2OptionTiers(data) {
      if (data && !data.error) this.aria2Tiers = data;
    },
    async loadAria2Options() {
      try {
        const r = await this._fetch(this.backendPath("/api/aria2/global_option"));
        this._applyAria2GlobalOption(await r.json());
      } catch (e) {
        this.aria2Options = {};
      }
      try {
        const r = await this._fetch(this.backendPath("/api/aria2/option_tiers"));
        this._applyAria2OptionTiers(await r.json());
      } catch (e) {
        console.warn("loadAria2Tiers:", e.message);
      }
    },
    get aria2UnsafeEnabled() {
      return !!this.getDeclarationPreference("aria2_unsafe_options");
    },
    // numeric preference getters (using _numPref helper)
    // retry preferences
    get maxRetries() {
      return this._numPref("max_retries", 3);
    },
    get retryBackoff() {
      return this._numPref("retry_backoff_seconds", 30);
    },
    get aria2MaxTries() {
      return this._numPref("aria2_max_tries", 5);
    },
    get aria2RetryWait() {
      return this._numPref("aria2_retry_wait", 3);
    },
    // distribution preferences
    get distributeEnabled() {
      return !!this.getDeclarationPreference("distribute_completed_downloads");
    },
    get distributeSeedRatio() {
      return this._numPref("distribute_seed_ratio", 1);
    },
    get distributeMaxSeedHours() {
      return this._numPref("distribute_max_seed_hours", 24);
    },
    get distributeMaxActiveSeeds() {
      return this._numPref("distribute_max_active_seeds", 3);
    },
    get internalTrackerUrl() {
      return this.getDeclarationPreference("internal_tracker_url") || "";
    },
    setAria2UnsafeOptions(enabled) {
      this._queuePrefChange("aria2_unsafe_options", !!enabled, [false, true], "allow setting any aria2 option via API");
    },
    setRetryPref(name, value) {
      this._queuePrefChange(name, Number(value), [], `retry preference`, 400);
    },
    setDistributePref(name, value) {
      this._queuePrefChange(name, typeof value === "boolean" ? value : value, [], `distribution preference`, 400);
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
        const r = await this._fetch(this.backendPath("/api/aria2/change_global_option"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value })
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? `${key} = ${value}` : data.message || "Failed";
        if (data.ok !== false) this.loadAria2Options();
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },
    // --- per-item aria2 option editing ---
    async setItemAria2Option(gid, key, value) {
      if (!gid || !key) return;
      try {
        const r = await this._fetch(this.backendPath("/api/aria2/change_option"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gid, [key]: String(value) })
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? `${key} = ${value} (gid ${gid})` : data.message || "Failed";
        if (data.ok !== false) this.loadItemOptions(gid);
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },
    // --- aria2 set_limits ---
    async setAria2Limits(limits) {
      try {
        const r = await this._fetch(this.backendPath("/api/aria2/set_limits"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(limits)
        });
        const data = await r.json();
        this.aria2OptionResult = data.ok !== false ? "Limits applied" : data.message || "Failed";
      } catch (e) {
        this.aria2OptionResult = `Error: ${e.message}`;
      }
    },
    // --- torrents ---
    _applyPeers(data) {
      this.peerList = data?.peers || [];
    },
    _applyTorrents(data) {
      this.torrentList = data?.torrents || data?.items || [];
    },
    async loadTorrents() {
      this.torrentLoading = true;
      try {
        const r = await this._fetch(this.backendPath("/api/torrents"));
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
        this.resultText = data.ok !== false ? `Stopped seeding ${infohash.slice(0, 8)}` : data.message || "Stop failed";
        await this.loadTorrents();
      } catch (e) {
        this.resultText = `Stop failed: ${e.message}`;
      }
    },
    // --- dev ---
    openDocs() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/docs`, "_blank");
    },
    openSpec() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) return;
      window.open(`${url}/api/openapi.yaml`, "_blank");
    },
    async loadSpecVersion() {
      const url = this.backendBaseUrl();
      if (!/^https?:[/][/]/i.test(url)) {
        this.specVersion = null;
        return;
      }
      try {
        const r = await this._fetch(`${url}/api/openapi.yaml`);
        if (!r.ok) {
          this.specVersion = null;
          return;
        }
        const text = await r.text();
        const m = text.match(/^\s{0,4}version:\s*['"]?([^'"\s]+)['"]?\s*$/m);
        this.specVersion = m ? m[1] : null;
      } catch {
        this.specVersion = null;
      }
    },
    get specVersionMismatch() {
      const runtime = this.lastStatus?.["ariaflow-server"]?.version;
      return !!(this.specVersion && runtime && this.specVersion !== runtime);
    },
    async runTests() {
      this.testSummaryVisible = true;
      this.testBadgeText = "running...";
      this.testBadgeClass = "badge";
      this.testCountsText = "Running test suite...";
      this.testResults = [];
      this.testLoading = true;
      try {
        const r = await this._fetch(`${this.backendBaseUrl()}/api/tests`);
        const data = await r.json();
        const passed = data.passed ?? 0;
        const failed = data.failed ?? 0;
        const errors = data.errors ?? 0;
        const total = data.total ?? passed + failed + errors;
        const ok = failed === 0 && errors === 0 && total > 0;
        this.testBadgeText = total === 0 ? "no tests" : ok ? "pass" : "fail";
        this.testBadgeClass = total === 0 ? "badge warn" : ok ? "badge good" : "badge bad";
        this.testCountsText = total === 0 ? "No tests found \u2014 backend may be running from a packaged install without test files" : `${passed} passed, ${failed} failed, ${errors} errors \u2014 ${total} total`;
        this.testResults = data.tests || data.results || [];
        this.lastTestStdout = data.stdout || "";
        this.lastTestStderr = data.stderr || "";
        if (!this.testResults.length) {
          this.testResults = [{ name: total === 0 ? "No test files available." : ok ? "All tests passed." : "No test details available.", _placeholder: true }];
        }
      } catch (err) {
        this.testBadgeText = "error";
        this.testBadgeClass = "badge bad";
        this.testCountsText = `Failed to reach backend: ${err.message}`;
        this.testResults = [];
      }
      this.testLoading = false;
    }
  }));
});
//# sourceMappingURL=app.js.map
