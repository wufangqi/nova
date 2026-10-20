/**
 * WUF-121 — shell layout contract helpers for the Find workbench migration.
 *
 * Asserts the bottom Intent/Actions panels are no longer shell chrome, and
 * the editor grid sits above the status bar only.
 */

import { cssRuleDeclarations } from "./editor-layout.ts";

/** Product rule: shell grid is chrome + editor 1fr + status-bar. */
export const SHELL_WORKBENCH_GRID_ROWS = "auto auto auto 1fr auto" as const;

/**
 * Intent/Actions must sit inside `#find-dialog` (before the status bar),
 * not as permanent shell bottom chrome.
 */
export function assertShellHasNoBottomIntentActionPanels(html: string): void {
  const findIdx = html.search(/id\s*=\s*["']find-dialog["']/i);
  if (findIdx < 0) {
    throw new Error("expected #find-dialog workbench host");
  }
  const statusIdx = html.search(/class\s*=\s*["'][^"']*\bstatus-bar\b/i);
  if (statusIdx < 0) {
    throw new Error("status bar must remain on the shell");
  }
  if (statusIdx <= findIdx) {
    throw new Error("expected #find-dialog before the status bar");
  }

  const intentIdx = html.search(/class\s*=\s*["'][^"']*\bintent-panel\b/i);
  const actionIdx = html.search(/class\s*=\s*["'][^"']*\baction-panel\b/i);
  if (intentIdx < 0) {
    throw new Error("expected .intent-panel inside the Find workbench");
  }
  if (actionIdx < 0) {
    throw new Error("expected .action-panel inside the Find workbench");
  }
  if (intentIdx < findIdx || intentIdx > statusIdx) {
    throw new Error(
      "shell must not host a permanent .intent-panel outside #find-dialog",
    );
  }
  if (actionIdx < findIdx || actionIdx > statusIdx) {
    throw new Error(
      "shell must not host a permanent .action-panel outside #find-dialog",
    );
  }

  // No second shell-level copy after the status bar.
  const intentAfter = html
    .slice(statusIdx)
    .search(/class\s*=\s*["'][^"']*\bintent-panel\b/i);
  const actionAfter = html
    .slice(statusIdx)
    .search(/class\s*=\s*["'][^"']*\baction-panel\b/i);
  if (intentAfter >= 0) {
    throw new Error(".intent-panel must not appear after the status bar");
  }
  if (actionAfter >= 0) {
    throw new Error(".action-panel must not appear after the status bar");
  }
}

/** Stylesheet: `.app` grid converges to chrome + editor + status-bar. */
export function assertShellWorkbenchGridCss(css: string): void {
  const app = cssRuleDeclarations(css, ".app");
  const rows = app["grid-template-rows"];
  if (!rows) {
    throw new Error(".app must declare grid-template-rows");
  }
  const normalized = rows.replace(/\s+/g, " ").trim();
  if (normalized !== SHELL_WORKBENCH_GRID_ROWS) {
    throw new Error(
      `.app grid-template-rows must be "${SHELL_WORKBENCH_GRID_ROWS}", got "${normalized}"`,
    );
  }
  // Bottom-right anchor removed — geometry uses left/top.
  const findDialog = cssRuleDeclarations(css, ".find-dialog");
  if (findDialog["right"] != null || findDialog["bottom"] != null) {
    throw new Error(
      ".find-dialog must not use right/bottom anchoring after workbench migration",
    );
  }
  if (findDialog["position"] !== "absolute") {
    throw new Error(".find-dialog must remain position: absolute");
  }
}
