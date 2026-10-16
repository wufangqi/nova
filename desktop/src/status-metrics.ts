/**
 * WUF-113 — status-bar metrics mapper (pure; no DOM / pixels).
 *
 * Left side of the status bar stays transient messages; right side shows
 * 长度 / 行数 / 行 / 列 / 位置 from Buffer + caret. EOL/Encoding deferred.
 */

/** Normalized metrics for the right-hand status segments. */
export type StatusMetrics = {
  length: number;
  lineCount: number;
  /** 1-based caret line; null → placeholder */
  line: number | null;
  /** 1-based caret column; null → placeholder */
  column: number | null;
  /** Absolute caret offset; null → placeholder */
  offset: number | null;
};

/** Raw inputs gathered from Buffer IPC + VirtualEditor caret window. */
export type StatusMetricsSource = {
  hasBuffer: boolean;
  length: number;
  lineCount: number;
  caretOffset: number | null;
  caretLine: number | null;
  caretColumn: number | null;
};

/** Labels rendered into the fixed right-hand metrics strip. */
export type StatusMetricsLabels = {
  length: string;
  lineCount: string;
  line: string;
  column: string;
  offset: string;
};

const PLACEHOLDER = "—";

/**
 * Map Buffer + caret inputs into StatusMetrics.
 * No Buffer → zeros and null caret fields (UI shows 0 / —).
 */
export function mapStatusMetrics(source: StatusMetricsSource): StatusMetrics {
  if (!source.hasBuffer) {
    return {
      length: 0,
      lineCount: 0,
      line: null,
      column: null,
      offset: null,
    };
  }
  return {
    length: source.length,
    lineCount: source.lineCount,
    line: source.caretLine,
    column: source.caretColumn,
    offset: source.caretOffset,
  };
}

/** Format metrics for display; null caret fields become "—". */
export function formatStatusMetrics(metrics: StatusMetrics): StatusMetricsLabels {
  return {
    length: String(metrics.length),
    lineCount: String(metrics.lineCount),
    line: metrics.line === null ? PLACEHOLDER : String(metrics.line),
    column: metrics.column === null ? PLACEHOLDER : String(metrics.column),
    offset: metrics.offset === null ? PLACEHOLDER : String(metrics.offset),
  };
}

/** Mounted window + absolute caret — shared by VirtualEditor and line/col mapper. */
export type CaretWindowContext = {
  windowText: string;
  /** 0-based first Buffer line index covered by windowText */
  windowLineStart: number;
  /** Absolute offset of windowText[0] in the Buffer */
  windowStartOffset: number;
  caretOffset: number;
};

/**
 * Local caret offset inside a textarea selection.
 * Collapsed → either side. Non-collapsed → end when forward/none, start when backward.
 * (HTML: forward selection keeps caret at selectionEnd; Find jumps use forward.)
 */
export function caretLocalOffset(sel: {
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
}): number {
  if (sel.selectionStart === sel.selectionEnd) return sel.selectionStart;
  if (sel.selectionDirection === "backward") return sel.selectionStart;
  return sel.selectionEnd;
}

/**
 * Derive 1-based line/column from a mounted line window + absolute caret.
 * Returns null when the caret lies outside the window.
 */
export function caretLineColumnInWindow(
  input: CaretWindowContext,
): { line: number; column: number } | null {
  const local = input.caretOffset - input.windowStartOffset;
  if (local < 0 || local > input.windowText.length) return null;
  const before = input.windowText.slice(0, local);
  const newlines = before.split("\n").length - 1;
  const line = input.windowLineStart + newlines + 1;
  const lastNl = before.lastIndexOf("\n");
  const column = lastNl === -1 ? local + 1 : local - lastNl;
  return { line, column };
}
