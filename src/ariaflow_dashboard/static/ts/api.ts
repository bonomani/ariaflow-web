// HTTP layer: typed fetch wrapper with timeout via AbortController.
// Used by the Alpine component in app.ts; will absorb the per-endpoint
// helpers (status, lifecycle, declaration, downloads, ...) as the
// typed split progresses.

export interface ApiFetchOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function apiFetch(url: string, opts: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return fetch(url, { ...rest, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Join a backend base URL with an absolute API path. Strips any
// trailing slashes from the base so `joinUrl('http://h:8000/', '/api/x')`
// and `joinUrl('http://h:8000', '/api/x')` produce the same result.
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

// POST with no body. Returns the raw Response without throwing on
// non-2xx; callers inspect data.ok / data.message after parsing.
// (Matches the rest of the codebase: every backend response carries
// {ok: bool, message?, ...} and call sites need the body even on
// 4xx/5xx for actionable error text. Earlier postJson/getJson
// helpers that threw ApiError on non-2xx were inconsistent with
// this discipline and never adopted.)
export async function postEmpty(url: string, opts: ApiFetchOptions = {}): Promise<Response> {
  return apiFetch(url, { ...opts, method: opts.method ?? 'POST' });
}
