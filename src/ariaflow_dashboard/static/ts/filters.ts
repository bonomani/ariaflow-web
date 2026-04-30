// Pure queue-item filtering: status filter (all / active / paused
// / complete / error / waiting / removed / queued / discovering) +
// free-text search across url, output, and live.url. Stays decoupled
// from Alpine state so the predicate is reusable and testable.
//
// Vocabulary aligns with aria2 (BG-30): the six aria2-native statuses
// (active / waiting / paused / error / complete / removed) plus two
// backend-only pre-aria2 states (discovering / queued). No phantom
// statuses ('recovered', 'failed', 'downloading', 'done', 'cancelled')
// — every status here has a real producer.

export type QueueFilter =
  | 'all'
  | 'active'
  | 'waiting'
  | 'paused'
  | 'complete'
  | 'error'
  | 'removed'
  | 'queued'
  | 'discovering'
  | string;

export interface FilterableItem {
  status?: string | null;
  url?: string | null;
  output?: string | null;
  live?: { url?: string | null } | null;
  [k: string]: unknown;
}

export function normalizeStatus(status: string | null | undefined): string {
  return (status ?? 'unknown').toLowerCase();
}

export function matchesStatusFilter(item: FilterableItem, filter: QueueFilter): boolean {
  if (filter === 'all') return true;
  return normalizeStatus(item.status) === filter;
}

export function matchesSearch(item: FilterableItem, search: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  const url = (item.url ?? '').toLowerCase();
  const output = (item.output ?? '').toLowerCase();
  const liveUrl = (item.live?.url ?? '').toLowerCase();
  return url.includes(needle) || output.includes(needle) || liveUrl.includes(needle);
}

export function filterQueueItems<T extends FilterableItem>(
  items: readonly T[],
  filter: QueueFilter,
  search: string,
): T[] {
  return items.filter((item) => matchesStatusFilter(item, filter) && matchesSearch(item, search));
}

// Stable filter buttons that should always render in the bar even
// when the count is zero. Other filters appear only when they have
// items or when the user has selected them.
const STABLE_FILTERS: ReadonlySet<string> = new Set([
  'all',
  'active',
  'paused',
  'complete',
  'error',
]);

export function isFilterButtonVisible(
  filter: QueueFilter,
  filterCounts: Readonly<Record<string, number>>,
  selectedFilter: QueueFilter,
): boolean {
  return STABLE_FILTERS.has(filter) || (filterCounts[filter] ?? 0) > 0 || selectedFilter === filter;
}
