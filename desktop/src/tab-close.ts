/**
 * Per-tab close orchestration over an injectable ClosePrompter.
 * Clean → close immediately. Dirty → save / discard / cancel.
 * Save uses the caller's save port (existing Save / Save As); cancel leaves the tab.
 */
import type { ClosePrompter } from "./close-prompter.ts";

export type TabCloseInfo = {
  title: string;
  hasPath: boolean;
  dirty: boolean;
};

/** Thin port the desktop shell implements over Tauri / IPC / EditorShell. */
export type TabClosePort = {
  getTab(bufferId: string): Promise<TabCloseInfo | undefined>;
  /** Close a known-clean tab (no prompt). */
  closeClean(bufferId: string): Promise<void>;
  /** Discard a dirty tab without saving. */
  discard(bufferId: string): Promise<void>;
  /**
   * Persist then allow close. `cancelled` means Save/Save As was aborted —
   * the tab must stay open and dirty.
   */
  save(bufferId: string): Promise<"saved" | "cancelled">;
};

export type TabCloseOutcome =
  | { kind: "closed"; via: "clean" | "save" | "discard" }
  | { kind: "cancelled" }
  | { kind: "missing" };

export async function closeTabWithPrompter(
  prompter: ClosePrompter,
  port: TabClosePort,
  bufferId: string,
): Promise<TabCloseOutcome> {
  const tab = await port.getTab(bufferId);
  if (!tab) return { kind: "missing" };

  if (!tab.dirty) {
    await port.closeClean(bufferId);
    return { kind: "closed", via: "clean" };
  }

  const choice = await prompter.confirmDirty({
    title: tab.title,
    hasPath: tab.hasPath,
  });

  if (choice === "cancel") {
    return { kind: "cancelled" };
  }

  if (choice === "discard") {
    await port.discard(bufferId);
    return { kind: "closed", via: "discard" };
  }

  // save
  const saved = await port.save(bufferId);
  if (saved === "cancelled") {
    return { kind: "cancelled" };
  }
  // After a successful save the tab is clean — close without a second prompt.
  await port.closeClean(bufferId);
  return { kind: "closed", via: "save" };
}
