/**
 * WUF-108 — compact shell chrome: toolbar + simple File menu + shortcuts.
 *
 * Toolbar buttons, File menu items, and Ctrl+N/O/S/Shift+S/F share one action
 * table so every entry has the same effect. Demo stays a toolbar-only action.
 * Encoding / Language menus are deferred (not part of this Stage).
 */

export type ShellFileAction = "new" | "open" | "save" | "save_as" | "find";

export type ShellChromeAction = ShellFileAction | "demo";

export type ShellFileMenuItem = {
  id: ShellFileAction;
  label: string;
  accelerator: string;
};

/** File menu entries — mirrors toolbar file actions, nothing else. */
export const SHELL_FILE_MENU_ITEMS: readonly ShellFileMenuItem[] = [
  { id: "new", label: "New", accelerator: "Ctrl+N" },
  { id: "open", label: "Open…", accelerator: "Ctrl+O" },
  { id: "save", label: "Save", accelerator: "Ctrl+S" },
  { id: "save_as", label: "Save As…", accelerator: "Ctrl+Shift+S" },
  { id: "find", label: "Find…", accelerator: "Ctrl+F" },
] as const;

/** Toolbar file actions — same set / order as the File menu. */
export const SHELL_TOOLBAR_FILE_ACTIONS: readonly ShellFileAction[] =
  SHELL_FILE_MENU_ITEMS.map((item) => item.id);

/** Demo remains reachable on the toolbar; not part of the File menu. */
export const SHELL_DEMO_ACTION = "demo" as const;

/** Productized later — must not appear in this Stage's File menu. */
export const SHELL_DEFERRED_MENU_LABELS = ["Encoding", "Language"] as const;

export type ShellChromeHandlers = {
  [K in ShellChromeAction]: () => void | Promise<void>;
};

export type ShellShortcutEvent = {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
};

/**
 * Map a key event to a file chrome action.
 * Requires Ctrl (not Alt/Meta) so Ctrl+Alt+N global evoke stays distinct.
 */
export function resolveShellShortcut(
  ev: ShellShortcutEvent,
): ShellFileAction | null {
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const key = ev.key.toLowerCase();
  if (key === "n" && !ev.shiftKey) return "new";
  if (key === "o" && !ev.shiftKey) return "open";
  if (key === "s" && !ev.shiftKey) return "save";
  if (key === "s" && ev.shiftKey) return "save_as";
  if (key === "f" && !ev.shiftKey) return "find";
  return null;
}

/** Dispatch a chrome action through the shared handler table. */
export function runShellAction(
  action: ShellChromeAction,
  handlers: ShellChromeHandlers,
): void | Promise<void> {
  return handlers[action]();
}
