// Status-change → desktop notification mapping.
//
// The browser Notification API (permission grant flow, `new
// Notification(...)`) stays in app.ts because it has side effects.
// Here we just compute *what* notifications should fire given the
// previous and current item snapshots, plus the updated status map
// to persist for next time.

import { shortName } from './formatters';

export type NotificationKind = 'complete' | 'error';

export interface DesktopNotification {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Used as the Notification `tag` so repeats coalesce per item. */
  tag: string;
}

export interface NotifiableItem {
  id?: string | null;
  url?: string | null;
  output?: string | null;
  status?: string | null;
  error_message?: string | null;
}

export type StatusMap = Readonly<Record<string, string>>;

function notificationFor(
  item: NotifiableItem,
  status: string,
  id: string,
): DesktopNotification | null {
  if (status === 'complete') {
    return {
      kind: 'complete',
      title: 'Download complete',
      body: shortName(item.output || item.url || ''),
      tag: `ariaflow-${id}`,
    };
  }
  if (status === 'error') {
    return {
      kind: 'error',
      title: 'Download failed',
      body:
        shortName(item.output || item.url || '') +
        (item.error_message ? ` — ${item.error_message}` : ''),
      tag: `ariaflow-${id}`,
    };
  }
  return null;
}

export interface DiffResult {
  notifications: DesktopNotification[];
  nextStatusMap: StatusMap;
}

// Compare the previous status map (id → last-seen status) with a
// fresh items snapshot. Returns the notifications to fire and the
// updated status map. Items missing an id+url are skipped (no stable
// key). Items appearing for the first time prime the map but do NOT
// fire a notification — only true status transitions do.
export function diffItemStatuses(
  previous: StatusMap,
  items: readonly NotifiableItem[],
): DiffResult {
  const next: Record<string, string> = { ...previous };
  const notifications: DesktopNotification[] = [];
  for (const item of items) {
    const id = String(item.id || item.url || '');
    if (!id) continue;
    const status = String(item.status ?? '').toLowerCase();
    const prev = previous[id];
    if (prev && prev !== status) {
      const n = notificationFor(item, status, id);
      if (n) notifications.push(n);
    }
    next[id] = status;
  }
  return { notifications, nextStatusMap: next };
}
