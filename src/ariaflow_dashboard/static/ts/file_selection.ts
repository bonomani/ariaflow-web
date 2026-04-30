// File-selection helpers for the per-item file picker dialog.
// Backend returns the file list under `data.files`; each file may
// carry an explicit `selected` flag. The picker convention is
// "selected unless explicitly set to false" — so missing or null
// counts as selected. These helpers pin that rule and the inverse
// shape (selected indexes) the backend expects on save.

export interface FilePickerEntry {
  index?: number;
  path?: string | null;
  length?: string | number;
  /** May be missing on first load; treat absent as selected. */
  selected?: boolean | null;
}

export interface NormalizedFile extends FilePickerEntry {
  selected: boolean;
}

// Map a raw /api/downloads/:id/files response into entries with a
// boolean `selected` flag. The truthy-default rule (`selected !==
// false`) means missing / null / true → true; only an explicit false
// flips to unselected.
export function normalizeFiles(rawFiles: unknown): NormalizedFile[] {
  if (!Array.isArray(rawFiles)) return [];
  return (rawFiles as FilePickerEntry[]).map((f) => ({
    ...f,
    selected: f?.selected !== false,
  }));
}

// Pull the indexes the user has chosen, ready to POST back as
// {select: [...]}. Skips entries without a numeric index.
export function selectedFileIndexes(files: readonly NormalizedFile[]): number[] {
  const out: number[] = [];
  for (const f of files) {
    if (f.selected && typeof f.index === 'number') out.push(f.index);
  }
  return out;
}

export function isAllSelected(files: readonly NormalizedFile[]): boolean {
  if (files.length === 0) return false;
  return files.every((f) => f.selected);
}

export function isSomeSelected(files: readonly NormalizedFile[]): boolean {
  return files.some((f) => f.selected) && files.some((f) => !f.selected);
}

export function setAllSelected<T extends NormalizedFile>(
  files: readonly T[],
  selected: boolean,
): T[] {
  return files.map((f) => ({ ...f, selected }));
}
