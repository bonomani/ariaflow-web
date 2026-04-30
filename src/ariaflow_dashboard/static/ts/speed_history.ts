// Bounded ring buffers for download/upload speed sparklines.
//
// Two flavors:
//   - per-item history: `speedHistory[itemId] = number[]`, capped at
//     SPEED_HISTORY_MAX (30 samples) — fed into the per-row sparkline.
//   - global history: two parallel arrays for download and upload,
//     capped at GLOBAL_SPEED_MAX (40 samples) — fed into the header
//     sparkline.
//
// Pure helpers: caller owns the state, this module just produces the
// next array. Stable reference is preserved when no change occurs so
// Alpine reactivity stays quiet.

export const SPEED_HISTORY_MAX = 30;
export const GLOBAL_SPEED_MAX = 40;

function clampTail(buf: readonly number[], cap: number): number[] {
  return buf.length > cap ? buf.slice(-cap) : [...buf];
}

function coerceSpeed(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Append a sample to a per-item series. Skips the append when the
// last sample and the new sample are both 0 — keeps idle items from
// growing churny ring-buffer updates that Alpine would re-render.
export function appendItemSpeed(
  current: readonly number[] | undefined,
  speed: unknown,
  cap: number = SPEED_HISTORY_MAX,
): readonly number[] {
  const s = coerceSpeed(speed);
  const buf = current ?? [];
  if (buf.length && buf[buf.length - 1] === s && s === 0) return buf;
  return clampTail([...buf, s], cap);
}

export type SpeedHistoryMap = Readonly<Record<string, readonly number[]>>;

// Push a new sample for itemId into the map; returns a new map (or
// the same reference when the no-op rule kicks in).
export function recordItemSpeed(
  history: SpeedHistoryMap,
  itemId: string,
  speed: unknown,
  cap: number = SPEED_HISTORY_MAX,
): SpeedHistoryMap {
  if (!itemId) return history;
  const next = appendItemSpeed(history[itemId], speed, cap);
  if (next === history[itemId]) return history;
  return { ...history, [itemId]: next };
}

export interface GlobalSpeedSnapshot {
  download: readonly number[];
  upload: readonly number[];
}

export function appendGlobalSpeed(
  prev: GlobalSpeedSnapshot,
  dlSpeed: unknown,
  ulSpeed: unknown,
  cap: number = GLOBAL_SPEED_MAX,
): GlobalSpeedSnapshot {
  return {
    download: clampTail([...prev.download, coerceSpeed(dlSpeed)], cap),
    upload: clampTail([...prev.upload, coerceSpeed(ulSpeed)], cap),
  };
}
