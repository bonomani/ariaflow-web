// Action enums and typed URL builders.
//
// Centralizes the verb names ("pause", "resume", ...) and the
// parameterized routes (/api/downloads/:id/:action,
// /api/lifecycle/:target/:action, /api/torrents/:infohash/stop) so
// the Alpine component can dispatch actions without hand-encoding URL
// segments at every call site.

export type ItemAction = 'pause' | 'resume' | 'retry' | 'remove' | 'cancel';
export type LifecycleAction = 'enable' | 'disable' | 'reset' | 'retry';
export type SchedulerAction = 'pause' | 'resume';

// /api/downloads/:itemId/:action
export function urlItemAction(itemId: string, action: ItemAction): string {
  return `/api/downloads/${encodeURIComponent(itemId)}/${encodeURIComponent(action)}`;
}

// /api/downloads/:itemId/files
export function urlItemFiles(itemId: string): string {
  return `/api/downloads/${encodeURIComponent(itemId)}/files`;
}

// /api/lifecycle/:target/:action
export function urlLifecycleAction(target: string, action: LifecycleAction | string): string {
  return `/api/lifecycle/${encodeURIComponent(target)}/${encodeURIComponent(action)}`;
}

// /api/torrents/:infohash/stop
export function urlTorrentStop(infohash: string): string {
  return `/api/torrents/${encodeURIComponent(infohash)}/stop`;
}

// /api/scheduler/{pause,resume,preflight,ucc}
export function urlScheduler(action: SchedulerAction | 'preflight' | 'ucc'): string {
  return `/api/scheduler/${action}`;
}

// /api/aria2/option?gid=:gid
export function urlAria2GetOption(gid: string): string {
  return `/api/aria2/option?gid=${encodeURIComponent(gid)}`;
}

// /api/sessions/stats?session_id=:id
export function urlSessionStats(sessionId: string): string {
  return `/api/sessions/stats?session_id=${encodeURIComponent(sessionId)}`;
}
