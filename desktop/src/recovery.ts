/**
 * Tab-close RecoveryBuffer drop wiring (browser-safe; no node:fs).
 * Quit persist / launch restore live in nova `src/recovery` + IPC host.
 */
import type { ClosePrompter } from "./close-prompter.ts";
import {
  closeTabWithPrompter,
  type TabCloseOutcome,
  type TabClosePort,
} from "./tab-close.ts";

/** Minimal drop seam — desktop IPC or injectable store. */
export type RecoveryDropPort = {
  drop(bufferId: string): Promise<void>;
};

/**
 * Tab close with recovery semantics: Don’t save (and successful save-then-close)
 * drops that Buffer from the recovery layer.
 */
export async function closeTabWithRecovery(
  prompter: ClosePrompter,
  port: TabClosePort,
  store: RecoveryDropPort,
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
