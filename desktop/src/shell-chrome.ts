/**
 * WUF-115 — menu-first shell chrome: File + Help menus, shortcuts, no toolbar.
 *
 * File menu + Ctrl+N/O/S/Shift+S/F share one action table.
 * Help menu exposes Demo… and About (version from app config).
 * Ctrl+W closes the active tab via the same handler as the tab × (three-way dirty).
 * No File → Close. Encoding / Language menus remain deferred.
 */

export type ShellFileAction = "new" | "open" | "save" | "save_as" | "find";

export type ShellHelpAction = "demo" | "about";

/** Tab close — keyboard only; not listed on File or Help. */
export type ShellCloseAction = "close";

export type ShellChromeAction =
  | ShellFileAction
  | ShellHelpAction
  | ShellCloseAction;

export type ShellFileMenuItem = {
  id: ShellFileAction;
  label: string;
  accelerator: string;
};

export type ShellHelpMenuItem = {
  id: ShellHelpAction;
  label: string;
  accelerator?: string;
};

/** File menu entries — file ops only; never Close. */
export const SHELL_FILE_MENU_ITEMS: readonly ShellFileMenuItem[] = [
  { id: "new", label: "New", accelerator: "Ctrl+N" },
  { id: "open", label: "Open…", accelerator: "Ctrl+O" },
  { id: "save", label: "Save", accelerator: "Ctrl+S" },
  { id: "save_as", label: "Save As…", accelerator: "Ctrl+Shift+S" },
  { id: "find", label: "Find…", accelerator: "Ctrl+F" },
] as const;

/** Help menu — Demo + About; Demo is not on the File menu. */
export const SHELL_HELP_MENU_ITEMS: readonly ShellHelpMenuItem[] = [
  { id: "demo", label: "Demo…" },
  { id: "about", label: "About" },
] as const;

/** Ctrl+W accelerator for the shared tab-close path. */
export const SHELL_CLOSE_ACCELERATOR = "Ctrl+W" as const;

/** Productized later — must not appear in this Stage's menus. */
export const SHELL_DEFERRED_MENU_LABELS = ["Encoding", "Language"] as const;

/**
 * About modal content. Version must come from app package / Tauri config
 * (same string the release build ships), not a hard-coded UI literal elsewhere.
 */
export type AboutInfo = {
  name: string;
  version: string;
  blurb: string;
};

export type AppVersionConfig = {
  productName: string;
  version: string;
};

const DEFAULT_ABOUT_BLURB =
  "AI-native notepad — Buffer-centric editing with Intent and Actions.";

/** Map app config → About modal fields. */
export function aboutInfoFromConfig(config: AppVersionConfig): AboutInfo {
  return {
    name: config.productName,
    version: config.version,
    blurb: DEFAULT_ABOUT_BLURB,
  };
}

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
 * Map a key event to a chrome action (file ops or Ctrl+W close).
 * Requires Ctrl (not Alt/Meta) so Ctrl+Alt+N global evoke stays distinct.
 */
export function resolveShellShortcut(
  ev: ShellShortcutEvent,
): ShellFileAction | ShellCloseAction | null {
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const key = ev.key.toLowerCase();
  if (key === "n" && !ev.shiftKey) return "new";
  if (key === "o" && !ev.shiftKey) return "open";
  if (key === "s" && !ev.shiftKey) return "save";
  if (key === "s" && ev.shiftKey) return "save_as";
  if (key === "f" && !ev.shiftKey) return "find";
  if (key === "w" && !ev.shiftKey) return "close";
  return null;
}

/** Dispatch a chrome action through the shared handler table. */
export function runShellAction(
  action: ShellChromeAction,
  handlers: ShellChromeHandlers,
): void | Promise<void> {
  return handlers[action]();
}

/**
 * Whether a pointer/click outside an open `<details>` menu should dismiss it.
 * Native details does not close on outside click in WebView2.
 */
export function shouldDismissDetailsMenu(
  menu: { open: boolean; contains(node: Node): boolean },
  target: EventTarget | null,
): boolean {
  if (!menu.open) return false;
  // Duck-type Node so Node test runners (no DOM globals) can still unit-test.
  if (
    !target ||
    typeof (target as { nodeType?: unknown }).nodeType !== "number"
  ) {
    return true;
  }
  return !menu.contains(target as Node);
}
