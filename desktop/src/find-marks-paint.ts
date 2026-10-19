/**
 * WUF-120 — plan / paint Find hit highlights over the VirtualEditor window.
 *
 * Pure planning is the testable seam (no OS pixels). The desktop layer applies
 * the planned rects as absolutely positioned backgrounds under the textarea.
 */

import { LINE_HEIGHT_PX } from "./virtual-editor.ts";

export type AbsRange = { start: number; end: number };

/** One highlight strip (a hit may span multiple lines → multiple rects). */
export type FindMarkRect = {
  /** Absolute Buffer offsets covered by this strip. */
  absStart: number;
  absEnd: number;
  /** Local offsets within the mounted window text. */
  localStart: number;
  localEnd: number;
  lineIndex: number;
  colStart: number;
  colEnd: number;
  topPx: number;
  heightPx: number;
  /** CSS left — uses rem + ch to match monospace editor padding. */
  leftCss: string;
  widthCss: string;
};

/** Matches `.editor` padding in styles.css (0.85rem top, 3.4rem left). */
export const FIND_MARK_PADDING_TOP_REM = 0.85;
export const FIND_MARK_PADDING_LEFT_REM = 3.4;

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineIndexAt(lineStarts: number[], local: number): number {
  let line = 0;
  for (let i = 0; i < lineStarts.length; i++) {
    if (lineStarts[i]! <= local) line = i;
    else break;
  }
  return line;
}

/**
 * Clip absolute hits to the mounted window and emit layout rects for painting.
 * Empty when no overlap — callers still clear the layer.
 */
export function planFindMarkRects(
  hits: AbsRange[],
  window: { start: number; text: string },
  opts: { lineHeightPx?: number } = {},
): FindMarkRect[] {
  const lineHeight = opts.lineHeightPx ?? LINE_HEIGHT_PX;
  const windowStart = window.start;
  const text = window.text;
  const windowEnd = windowStart + text.length;
  const lineStarts = lineStartsOf(text);
  const rects: FindMarkRect[] = [];

  for (const hit of hits) {
    const absStart = Math.max(hit.start, windowStart);
    const absEnd = Math.min(hit.end, windowEnd);
    if (absEnd <= absStart) continue;

    let local = absStart - windowStart;
    const localEnd = absEnd - windowStart;

    while (local < localEnd) {
      const lineIndex = lineIndexAt(lineStarts, local);
      const lineStart = lineStarts[lineIndex]!;
      const nextLineStart = lineStarts[lineIndex + 1] ?? text.length;
      const lineHasNl =
        nextLineStart > lineStart && text[nextLineStart - 1] === "\n";
      const lineContentEnd = lineHasNl ? nextLineStart - 1 : nextLineStart;
      const segEnd = Math.min(localEnd, lineContentEnd);
      const colStart = local - lineStart;
      const colEnd = segEnd - lineStart;

      if (colEnd > colStart) {
        rects.push({
          absStart: windowStart + local,
          absEnd: windowStart + segEnd,
          localStart: local,
          localEnd: segEnd,
          lineIndex,
          colStart,
          colEnd,
          topPx: FIND_MARK_PADDING_TOP_REM * 16 + lineIndex * lineHeight,
          heightPx: lineHeight,
          leftCss: `calc(${FIND_MARK_PADDING_LEFT_REM}rem + ${colStart}ch)`,
          widthCss: `${colEnd - colStart}ch`,
        });
      }

      if (segEnd >= localEnd) break;
      // Continue after the newline onto the next line.
      local = nextLineStart;
    }
  }

  return rects;
}

/** Apply planned rects into a layer element (clears previous children). */
export function paintFindMarkLayer(
  layer: HTMLElement,
  rects: FindMarkRect[],
): void {
  layer.replaceChildren();
  for (const r of rects) {
    const span = layer.ownerDocument.createElement("span");
    span.className = "find-mark-rect";
    span.dataset.absStart = String(r.absStart);
    span.dataset.absEnd = String(r.absEnd);
    span.style.top = `${r.topPx}px`;
    span.style.left = r.leftCss;
    span.style.width = r.widthCss;
    span.style.height = `${r.heightPx}px`;
    layer.appendChild(span);
  }
}

export function clearFindMarkLayer(layer: HTMLElement): void {
  layer.replaceChildren();
}
