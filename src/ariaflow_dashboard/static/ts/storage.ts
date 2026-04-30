// Typed wrappers around localStorage for the ariaflow.* keys used by
// the dashboard. Centralizes key names, JSON encode/decode, and
// fallbacks so the rest of the app can read/write without sprinkling
// try/catch around localStorage everywhere.

export const KEYS = {
  theme: 'ariaflow.theme',
  refreshInterval: 'ariaflow.refresh_interval',
  backends: 'ariaflow.backends',
  selectedBackend: 'ariaflow.selected_backend',
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

export type Theme = 'system' | 'light' | 'dark';

export function readString(key: StorageKey, fallback = ''): string {
  return (localStorage.getItem(key) ?? '').trim() || fallback;
}

export function writeString(key: StorageKey, value: string): void {
  localStorage.setItem(key, value);
}

export function readNumber(key: StorageKey, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function writeNumber(key: StorageKey, value: number): void {
  localStorage.setItem(key, String(value));
}

export function readJson<T>(key: StorageKey, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: StorageKey, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function readTheme(): Theme {
  const v = readString(KEYS.theme, 'system');
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function writeTheme(value: Theme): void {
  writeString(KEYS.theme, value);
}

export function readRefreshInterval(fallbackMs = 10000): number {
  return readNumber(KEYS.refreshInterval, fallbackMs);
}

export function writeRefreshInterval(ms: number): void {
  writeNumber(KEYS.refreshInterval, ms);
}

export function readBackends(): string[] {
  const raw = readJson<unknown>(KEYS.backends, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
}

export function writeBackends(list: string[]): void {
  writeJson(KEYS.backends, list);
}

export function readSelectedBackend(): string {
  return readString(KEYS.selectedBackend);
}

export function writeSelectedBackend(url: string): void {
  writeString(KEYS.selectedBackend, url);
}
