/**
 * WUF-112 — TitleChrome: custom title text, click-to-copy Path, setTitle sync.
 *
 * Presentation of Path binding only — not a new domain noun.
 * Contracts stay headless: no real OS title-bar pixels / clipboard UI.
 */

export type TitleChromeState = {
  /** Absolute Path, or null when Untitled. */
  path: string | null;
  dirty: boolean;
};

/** "Nova D:\\a.txt" | "Nova *D:\\a.txt" | "Nova Untitled" | "Nova *Untitled" */
export function formatTitle(state: TitleChromeState): string {
  const body = state.path ?? "Untitled";
  return state.dirty ? `Nova *${body}` : `Nova ${body}`;
}

export type CopyPathResult =
  | { ok: true; copied: string }
  | { ok: false; reason: "no_path" };

/**
 * Decide whether a title click may copy Path.
 * Does not touch the clipboard — callers write only when `ok`.
 */
export function copyPathFromTitle(state: TitleChromeState): CopyPathResult {
  if (!state.path) {
    return { ok: false, reason: "no_path" };
  }
  return { ok: true, copied: state.path };
}

/** Brief chip after a title click. */
export function titleChromeFeedback(result: CopyPathResult): string {
  return result.ok ? "已复制" : "无路径";
}

export type TitleChromeSetTitleHost = {
  setTitle(title: string): void | Promise<void>;
};

export type TitleChromeClipboardHost = {
  writeClipboard(text: string): void | Promise<void>;
};

export type TitleChromeWindowPort = {
  startDragging(): void | Promise<void>;
  toggleMaximize(): void | Promise<void>;
  minimize(): void | Promise<void>;
  /** Soft close — should emit close-requested (Recovery path), not force-destroy. */
  close(): void | Promise<void>;
};

/** Keep OS/taskbar title in lockstep with the in-app title string. */
export async function syncWindowTitle(
  state: TitleChromeState,
  host: TitleChromeSetTitleHost,
): Promise<string> {
  const title = formatTitle(state);
  await host.setTitle(title);
  return title;
}

/**
 * Click handler: copy Path when present; Untitled → no_path and no clipboard write.
 */
export async function handleTitleClick(
  state: TitleChromeState,
  host: TitleChromeClipboardHost,
): Promise<CopyPathResult> {
  const result = copyPathFromTitle(state);
  if (result.ok) {
    await host.writeClipboard(result.copied);
  }
  return result;
}

/** Double-click title region → maximize / restore (Windows-first). */
export async function onTitleDoubleClick(
  win: TitleChromeWindowPort,
): Promise<void> {
  await win.toggleMaximize();
}

/** Pointer moved past drag threshold → move the undecorated window. */
export async function onTitleDragThreshold(
  win: TitleChromeWindowPort,
): Promise<void> {
  await win.startDragging();
}

/** Caption-button: minimize (undecorated window must provide its own). */
export async function onTitleMinimize(
  win: TitleChromeWindowPort,
): Promise<void> {
  await win.minimize();
}

/** Caption-button: maximize / restore. */
export async function onTitleMaximize(
  win: TitleChromeWindowPort,
): Promise<void> {
  await win.toggleMaximize();
}

/** Caption-button: close via soft close (RecoveryBuffer quit path). */
export async function onTitleClose(win: TitleChromeWindowPort): Promise<void> {
  await win.close();
}

/** Pixels of movement before a press becomes a window drag (not a click). */
export const TITLE_DRAG_THRESHOLD_PX = 4;

/**
 * Build TitleChromeState from an active tab snapshot.
 * Untitled / missing path → path null.
 */
export function titleChromeStateFromTab(
  tab:
    | { path: string | null; untitled?: boolean; dirty: boolean }
    | null
    | undefined,
): TitleChromeState {
  if (!tab) {
    return { path: null, dirty: false };
  }
  const path =
    tab.untitled || !tab.path || tab.path.length === 0 ? null : tab.path;
  return { path, dirty: tab.dirty };
}
