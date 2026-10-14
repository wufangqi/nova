/** Active tab fields the Path toolbar cares about. */
export type PathToolbarTab = {
  path: string | null;
  untitled: boolean;
};

/**
 * Value for `#path-input` given the active tab.
 * Untitled / missing active → empty so Save cannot reuse another tab's Path.
 */
export function pathInputValueForActive(
  active: PathToolbarTab | null | undefined,
): string {
  return active?.path ?? "";
}

export type SaveAction =
  | "save"
  | "need_path"
  | { saveAs: string };

/**
 * Decide Save from active tab + current path-input (already synced).
 * Callers must pass `pathInputValueForActive(active)` (or user-edited input)
 * — never a Path left over from a previous tab without sync.
 */
export function chooseSaveAction(
  active: PathToolbarTab | undefined,
  pathInputRaw: string,
): SaveAction {
  const path = pathInputRaw.trim();
  if (!active || active.untitled || (path && path !== active.path)) {
    if (!path) return "need_path";
    return { saveAs: path };
  }
  return "save";
}
