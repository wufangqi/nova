/**
 * WUF-116 — permanent 1-based line gutter synced to VirtualEditor window.
 *
 * Labels are pure from (windowLineStart0, mountedLineCount). Click-to-select
 * is deferred; CSS keeps the gutter display-only (`pointer-events: none`).
 */

/** This Stage: gutter clicks must not select a Buffer line. */
export const GUTTER_CLICK_SELECTS_LINE = false as const;

/** CSS tokens asserted by the line-gutter contract (no screenshots). */
export const LINE_GUTTER_CSS = {
  selector: ".line-gutter",
  pointerEvents: "none",
  userSelect: "none",
} as const;

/**
 * 1-based gutter labels for a mounted virtual window.
 * `windowLineStart0` is the same 0-based start VirtualEditor uses after sync.
 */
export function lineGutterLabels(
  windowLineStart0: number,
  mountedLineCount: number,
): string[] {
  if (mountedLineCount <= 0) return [];
  const start = Math.max(0, windowLineStart0);
  return Array.from({ length: mountedLineCount }, (_, i) =>
    String(start + i + 1),
  );
}

/**
 * Mounted row count from window text — same split as
 * `VirtualEditor.windowLineSpan` (includes a trailing empty row from `\n`).
 */
export function mountedLineCountFromText(windowText: string): number {
  if (!windowText) return 0;
  return windowText.split("\n").length;
}

/**
 * Markup for gutter rows with `data-line` for contract assertions.
 * No event handlers — display only.
 */
export function renderLineGutterMarkup(labels: readonly string[]): string {
  return labels
    .map(
      (label) =>
        `<div class="line-gutter-row" data-line="${escapeAttr(label)}">${escapeText(label)}</div>`,
    )
    .join("");
}

/** Apply labels into a live gutter element (desktop shell). */
export function paintLineGutter(
  gutterEl: HTMLElement,
  labels: readonly string[],
): void {
  gutterEl.innerHTML = renderLineGutterMarkup(labels);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
