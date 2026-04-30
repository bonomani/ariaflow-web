// Pure queue-item filtering: status filter (all / downloading / paused
// / done / error / ...) + free-text search across url, output, and
// live.url. Stays decoupled from Alpine state so the predicate is
// reusable and testable.

export type QueueFilter = 'all' | 'downloading' | 'paused' | 'done' | 'error' | string;

export interface FilterableItem {
  status?: string | null;
  url?: string | null;
  output?: string | null;
  live?: { url?: string | null } | null;
  [k: string]: unknown;
}

// Status aliasing rules used by the dashboard:
//   - "recovered" is shown alongside "paused"
//   - "downloading" filter accepts "downloading" + "active"
//   - "done" filter accepts "done" + "complete"
const FILTER_ALIASES: Record<string, readonly string[]> = {
  downloading: ['downloading', 'active'],
  done: ['done', 'complete'],
};

export function normalizeStatus(status: string | null | undefined): string {
  const s = (status ?? 'unknown').toLowerCase();
  return s === 'recovered' ? 'paused' : s;
}

export function matchesStatusFilter(item: FilterableItem, filter: QueueFilter): boolean {
  if (filter === 'all') return true;
  const normalized = normalizeStatus(item.status);
  const accepted = FILTER_ALIASES[filter];
  return accepted ? accepted.includes(normalized) : normalized === filter;
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
  'downloading',
  'paused',
  'done',
  'error',
]);

export function isFilterButtonVisible(
  filter: QueueFilter,
  filterCounts: Readonly<Record<string, number>>,
  selectedFilter: QueueFilter,
): boolean {
  return STABLE_FILTERS.has(filter) || (filterCounts[filter] ?? 0) > 0 || selectedFilter === filter;
}
