/** Active tab fields the Path chrome cares about. */
export type PathToolbarTab = {
  path: string | null;
  untitled: boolean;
};

/**
 * Value for the read-only Path display given the active tab.
 * Untitled / missing active → empty.
 */
export function pathInputValueForActive(
  active: PathToolbarTab | null | undefined,
): string {
  return active?.path ?? "";
}

export type SaveAction = "save" | "need_save_as";

/**
 * Decide Save from the active tab alone (Path is display-only; no hand-typed Path).
 * Untitled / unbound → Save As via PathPicker; Path-bound → write back.
 */
export function chooseSaveAction(
  active: PathToolbarTab | undefined,
): SaveAction {
  if (!active || active.untitled || !active.path) return "need_save_as";
  return "save";
}
