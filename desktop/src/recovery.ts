/**
 * RecoveryBuffer orchestration: quit persist, launch restore, discard/save drops.
 * No per-tab prompt storm on quit; no draft-box product surface.
 */
import type { EditorShell } from "../../src/editor-shell.js";
import type { ClosePrompter } from "./close-prompter.ts";
import type { RecoverableBuffer, RecoveryStore } from "./recovery-store.ts";
import {
  closeTabWithPrompter,
  type TabCloseOutcome,
  type TabClosePort,
} from "./tab-close.ts";

/** Collect currently dirty tabs as RecoverableBuffers (slice, never draft-box UI). */
export function collectDirtyBuffers(shell: EditorShell): RecoverableBuffer[] {
  const intent = shell.intentService();
  const out: RecoverableBuffer[] = [];
  for (const tab of shell.listTabs()) {
    if (!tab.dirty) continue;
    const n = intent.len(tab.bufferId);
    const text = n === 0 ? "" : intent.slice(tab.bufferId, 0, n);
    out.push({
      bufferId: tab.bufferId,
      text,
      path: tab.path,
    });
  }
  return out;
}

/**
 * Quit (or equivalent) hook: silently snapshot all dirty Buffers into the store.
 * Returns how many were persisted.
 */
export async function persistDirtyOnQuit(
  shell: EditorShell,
  store: RecoveryStore,
): Promise<number> {
  const dirty = collectDirtyBuffers(shell);
  await store.saveAll(dirty);
  return dirty.length;
}

/**
 * Launch hook: restore RecoveryBuffers as editable tabs.
 * Re-keys the store to the new live buffer ids so later drop/save align.
 */
export async function restoreOnLaunch(
  shell: EditorShell,
  store: RecoveryStore,
): Promise<RecoverableBuffer[]> {
  const entries = await store.loadAll();
  const restored: RecoverableBuffer[] = [];
  for (const entry of entries) {
    const buf = shell.restoreRecovered(entry.text, entry.path);
    restored.push({
      bufferId: buf.id,
      text: entry.text,
      path: entry.path,
    });
  }
  await store.saveAll(restored);
  return restored;
}

/** After a successful Save / Save As the Buffer no longer needs recovery. */
export async function noteBufferSaved(
  store: RecoveryStore,
  bufferId: string,
): Promise<void> {
  await store.drop(bufferId);
}

/**
 * Tab close with recovery semantics: Don’t save (and successful save-then-close)
 * drops that Buffer from the recovery layer.
 */
export async function closeTabWithRecovery(
  prompter: ClosePrompter,
  port: TabClosePort,
  store: RecoveryStore,
  bufferId: string,
): Promise<TabCloseOutcome> {
  const outcome = await closeTabWithPrompter(prompter, port, bufferId);
  if (
    outcome.kind === "closed" &&
    (outcome.via === "discard" || outcome.via === "save")
  ) {
    await store.drop(bufferId);
  }
  return outcome;
}
