/**
 * WUF-109 — window quit orchestration over RecoveryBuffer.
 * Quit must persist dirty tabs without calling ClosePrompter (no three-button storm).
 */
import type { ClosePrompterTab } from "./close-prompter.ts";

export const QUIT_PRESERVE_STATUS = "已保留未保存标签";

/** Brief status-bar note when quit keeps unsaved tabs for next launch. */
export function quitPreserveStatusMessage(
  preservedCount: number,
): string | null {
  return preservedCount > 0 ? QUIT_PRESERVE_STATUS : null;
}

export type WindowQuitRecoveryOutcome = {
  preservedCount: number;
  statusMessage: string | null;
};

/**
 * Persist dirty Buffers on window close. The optional confirmDirty port is only
 * accepted so contracts can prove it is never invoked (tab close remains the
 * only three-way prompt surface).
 */
export async function runWindowQuitRecovery(ports: {
  persistDirty: () => Promise<number>;
  confirmDirty?: (tab: ClosePrompterTab) => Promise<unknown>;
}): Promise<WindowQuitRecoveryOutcome> {
  void ports.confirmDirty; // intentionally unused — quit must not storm prompts
  const preservedCount = await ports.persistDirty();
  return {
    preservedCount,
    statusMessage: quitPreserveStatusMessage(preservedCount),
  };
}
