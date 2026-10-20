/**
 * WUF-101 — virtually scrolled editor surface.
 * Visible lines come from line_window; typing uses span edit_active.
 * Never mounts full Buffer text in the DOM.
 */

import {
  caretLocalOffset,
  type CaretWindowContext,
} from "./status-metrics.ts";
import {
  editorContentWidthPx,
  editorSurfaceMinHeightPx,
  editorSurfaceVerticalPaddingPx,
  gutterHorizontalPinTranslateX,
} from "./editor-layout.ts";
import {
  lineGutterLabels,
  mountedLineCountFromText,
  paintLineGutter,
} from "./line-gutter.ts";

export const LINE_HEIGHT_PX = 22;
export const OVERSCAN_LINES = 40;

export type LineWindowResult = {
  text: string;
  startOffset: number;
};

export type VirtualEditorHost = {
  lineWindow(
    id: string,
    lineStart: number,
    lineCount: number,
  ): Promise<LineWindowResult>;
  lineCount(id: string): Promise<number>;
  editRange(
    start: number,
    end: number,
    replacement: string,
  ): Promise<{ revision: number }>;
};

/** Minimal replace that turns `before` into `after` (char offsets). */
export function minimalReplace(
  before: string,
  after: string,
): { start: number; end: number; replacement: string } {
  if (before === after) {
    return { start: 0, end: 0, replacement: "" };
  }
  let start = 0;
  const minLen = Math.min(before.length, after.length);
  while (start < minLen && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before[endBefore - 1] === after[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  return {
    start,
    end: endBefore,
    replacement: after.slice(start, endAfter),
  };
}

export function clampFirstLine(
  firstLine: number,
  lineCount: number,
  visibleLines: number,
): number {
  if (lineCount <= 0) return 0;
  const maxFirst = Math.max(0, lineCount - Math.max(1, visibleLines));
  return Math.max(0, Math.min(firstLine, maxFirst));
}

export class VirtualEditor {
  private bufferId: string | null = null;
  private rev = 0;
  private totalLines = 0;
  private firstLine = 0;
  private windowStartOffset = 0;
  private localText = "";
  private applyingRemote = false;
  private composing = false;
  private syncToken = 0;
  private onWindowSynced: (() => void) | null = null;

  private readonly viewportResizeObserver: ResizeObserver;

  constructor(
    private readonly viewport: HTMLElement,
    private readonly spacer: HTMLElement,
    private readonly windowEl: HTMLElement,
    private readonly textarea: HTMLTextAreaElement,
    private readonly host: VirtualEditorHost,
    private readonly gutterEl: HTMLElement | null = null,
  ) {
    this.viewport.addEventListener("scroll", () => {
      this.pinGutterHorizontally();
      void this.onScroll();
    });
    this.textarea.addEventListener("compositionstart", () => {
      this.composing = true;
    });
    this.textarea.addEventListener("compositionend", () => {
      this.composing = false;
      void this.flushEdit();
    });
    this.textarea.addEventListener("input", () => {
      if (!this.composing) void this.flushEdit();
    });
    this.viewportResizeObserver = new ResizeObserver(() => {
      this.refreshSurfaceHeight();
      this.refreshContentWidth();
    });
    this.viewportResizeObserver.observe(this.viewport);
  }

  get activeBufferId(): string | null {
    return this.bufferId;
  }

  get revision(): number {
    return this.rev;
  }

  get isApplyingRemote(): boolean {
    return this.applyingRemote;
  }

  setEnabled(enabled: boolean) {
    this.textarea.disabled = !enabled;
  }

  focus() {
    this.textarea.focus();
  }

  setSelectionRange(start: number, end: number) {
    this.textarea.setSelectionRange(start, end);
  }

  absSelection(): { start: number; end: number } {
    return {
      start: this.windowStartOffset + this.textarea.selectionStart,
      end: this.windowStartOffset + this.textarea.selectionEnd,
    };
  }

  absSelectionOrUndefined(): { start: number; end: number } | undefined {
    const sel = this.absSelection();
    if (sel.start === sel.end) return undefined;
    return sel;
  }

  /** Total line count last synced from the host (0 when unbound). */
  get lineCountSnapshot(): number {
    return this.totalLines;
  }

  /** Absolute start offset of the currently mounted window text. */
  get mountedWindowStart(): number {
    return this.windowStartOffset;
  }

  /** Text currently mounted in the textarea (may include overscan). */
  get mountedWindowText(): string {
    return this.localText;
  }

  /**
   * Absolute [start, end) of the mounted window — used for Find mark
   * degradation to the real visible/mounted range (not caret ±N).
   */
  mountedAbsRange():
    | { kind: "range"; start: number; end: number }
    | undefined {
    if (!this.bufferId) return undefined;
    return {
      kind: "range",
      start: this.windowStartOffset,
      end: this.windowStartOffset + this.localText.length,
    };
  }

  /** Fired after syncWindow / in-window edit updates the mounted text. */
  setOnWindowSynced(cb: (() => void) | null): void {
    this.onWindowSynced = cb;
  }

  /**
   * Mounted window start (0-based) after the last syncWindow — same value the
   * gutter uses for 1-based labels. Null when no Buffer is bound.
   */
  get windowLineStart0(): number | null {
    if (!this.bufferId) return null;
    return this.firstLine;
  }

  /** 1-based gutter labels for the currently mounted window (empty if unbound). */
  gutterLabelsSnapshot(): string[] {
    if (!this.bufferId) return [];
    return lineGutterLabels(
      this.firstLine,
      mountedLineCountFromText(this.localText),
    );
  }

  /**
   * Caret + mounted window fields for status-metrics (pure mapper inputs).
   * Null when no Buffer is bound. Caret follows selection direction (not always start).
   */
  caretWindowContext(): CaretWindowContext | null {
    if (!this.bufferId) return null;
    const direction = this.textarea.selectionDirection;
    const local = caretLocalOffset({
      selectionStart: this.textarea.selectionStart,
      selectionEnd: this.textarea.selectionEnd,
      selectionDirection:
        direction === "backward" || direction === "forward"
          ? direction
          : "none",
    });
    return {
      windowText: this.localText,
      windowLineStart: this.firstLine,
      windowStartOffset: this.windowStartOffset,
      caretOffset: this.windowStartOffset + local,
    };
  }

  async bind(
    bufferId: string | null,
    revision: number | undefined,
  ): Promise<void> {
    if (!bufferId) {
      this.bufferId = null;
      this.rev = 0;
      this.totalLines = 0;
      this.firstLine = 0;
      this.windowStartOffset = 0;
      this.localText = "";
      this.applyingRemote = true;
      this.textarea.value = "";
      this.spacer.style.height = "0px";
      this.windowEl.style.top = "0px";
      this.applyingRemote = false;
      this.setEnabled(false);
      this.refreshSurfaceHeight();
      this.refreshContentWidth();
      this.refreshGutter();
      return;
    }
    const same =
      this.bufferId === bufferId &&
      revision !== undefined &&
      revision === this.rev;
    this.bufferId = bufferId;
    this.setEnabled(true);
    if (revision !== undefined) this.rev = revision;
    this.totalLines = await this.host.lineCount(bufferId);
    this.updateSpacer();
    if (!same) {
      this.firstLine = clampFirstLine(
        this.firstLine,
        this.totalLines,
        this.visibleLineBudget(),
      );
      this.viewport.scrollTop = this.firstLine * LINE_HEIGHT_PX;
    }
    await this.syncWindow();
  }

  async gotoLine(line1Based: number): Promise<void> {
    if (!this.bufferId) return;
    this.totalLines = await this.host.lineCount(this.bufferId);
    const target = Math.max(0, Math.min(line1Based - 1, this.totalLines - 1));
    this.firstLine = clampFirstLine(
      Math.max(0, target - 2),
      this.totalLines,
      this.visibleLineBudget(),
    );
    this.viewport.scrollTop = this.firstLine * LINE_HEIGHT_PX;
    await this.syncWindow();
    const win = await this.host.lineWindow(this.bufferId, target, 1);
    const localStart = win.startOffset - this.windowStartOffset;
    const lineText = win.text.endsWith("\n")
      ? win.text.slice(0, -1)
      : win.text;
    const localEnd = localStart + lineText.length;
    if (localStart >= 0 && localEnd <= this.textarea.value.length) {
      this.textarea.focus();
      this.textarea.setSelectionRange(localStart, localEnd);
    }
  }

  async revealRange(absStart: number, absEnd: number, hintLine?: number) {
    if (!this.bufferId) return;
    this.totalLines = await this.host.lineCount(this.bufferId);
    let line = hintLine;
    if (line === undefined) {
      // Binary-ish walk via line windows is heavy; approximate from sync after jump.
      line = 0;
      let lo = 0;
      let hi = Math.max(0, this.totalLines - 1);
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const win = await this.host.lineWindow(this.bufferId, mid, 1);
        const end = win.startOffset + win.text.length;
        if (absStart < win.startOffset) hi = mid - 1;
        else if (absStart >= end && mid < this.totalLines - 1) lo = mid + 1;
        else {
          line = mid;
          break;
        }
      }
    }
    this.firstLine = clampFirstLine(
      Math.max(0, line - 2),
      this.totalLines,
      this.visibleLineBudget(),
    );
    this.viewport.scrollTop = this.firstLine * LINE_HEIGHT_PX;
    await this.syncWindow();
    const localStart = absStart - this.windowStartOffset;
    const localEnd = absEnd - this.windowStartOffset;
    if (
      localStart >= 0 &&
      localEnd <= this.textarea.value.length &&
      localEnd >= localStart
    ) {
      this.textarea.focus();
      this.textarea.setSelectionRange(localStart, localEnd);
    }
  }

  private visibleLineBudget(): number {
    const h = this.viewport.clientHeight || 400;
    return Math.max(1, Math.ceil(h / LINE_HEIGHT_PX));
  }

  private updateSpacer() {
    const height = Math.max(this.totalLines, 1) * LINE_HEIGHT_PX;
    this.spacer.style.height = `${height}px`;
  }

  /**
   * Grow the abspos window / textarea / spacer past the viewport when a long
   * unwrapped line is mounted, so the shared viewport can scroll horizontally.
   */
  private refreshContentWidth() {
    // Measure intrinsic line width: temporarily collapse CSS width so
    // scrollWidth reflects the longest mounted line, then size to max(vp, line).
    const prevWidth = this.textarea.style.width;
    this.textarea.style.width = "0px";
    const lineWidth = this.textarea.scrollWidth;
    const widthPx = editorContentWidthPx(
      this.viewport.clientWidth,
      lineWidth,
    );
    const width = `${widthPx}px`;
    this.textarea.style.width = width || prevWidth;
    this.windowEl.style.width = width;
    this.spacer.style.width = width;
    this.pinGutterHorizontally();
  }

  /**
   * WUF-119: keep textarea + gutter hit boxes at least one viewport tall
   * (CSS min-height:100% is fallback only). Also covers disabled / empty bind.
   */
  private refreshSurfaceHeight() {
    const pad = this.surfaceVerticalPaddingPx();
    const mounted = mountedLineCountFromText(this.localText);
    const minPx = editorSurfaceMinHeightPx(
      this.viewport.clientHeight,
      mounted,
      LINE_HEIGHT_PX,
      pad,
    );
    const minHeight = `${minPx}px`;
    this.windowEl.style.minHeight = minHeight;
    this.textarea.style.minHeight = minHeight;
    if (this.gutterEl) {
      this.gutterEl.style.minHeight = minHeight;
    }
  }

  /** Prefer live computed padding; fall back to stylesheet rem rule. */
  private surfaceVerticalPaddingPx(): number {
    if (typeof getComputedStyle === "function") {
      const style = getComputedStyle(this.textarea);
      const top = Number.parseFloat(style.paddingTop) || 0;
      const bottom = Number.parseFloat(style.paddingBottom) || 0;
      if (top + bottom > 0) return top + bottom;
    }
    return editorSurfaceVerticalPaddingPx();
  }

  /** Keep gutter at the viewport left while content scrolls horizontally. */
  private pinGutterHorizontally() {
    if (!this.gutterEl) return;
    const x = gutterHorizontalPinTranslateX(this.viewport.scrollLeft);
    this.gutterEl.style.transform = x === 0 ? "" : `translateX(${x}px)`;
  }

  private async onScroll() {
    if (!this.bufferId || this.applyingRemote) return;
    const next = Math.floor(this.viewport.scrollTop / LINE_HEIGHT_PX);
    const visible = this.visibleLineBudget();
    // Refresh when the viewport drifts outside the overscan cushion.
    if (
      next < this.firstLine + OVERSCAN_LINES / 4 ||
      next + visible > this.firstLine + this.windowLineSpan() - OVERSCAN_LINES / 4
    ) {
      this.firstLine = clampFirstLine(next, this.totalLines, visible);
      await this.syncWindow();
    }
  }

  private windowLineSpan(): number {
    if (!this.localText) return 0;
    // Approximate lines currently mounted (includes trailing empty from split).
    return this.localText.split("\n").length;
  }

  private async syncWindow() {
    if (!this.bufferId) return;
    const token = ++this.syncToken;
    const visible = this.visibleLineBudget();
    const start = Math.max(0, this.firstLine - OVERSCAN_LINES);
    const count = visible + OVERSCAN_LINES * 2;
    const win = await this.host.lineWindow(this.bufferId, start, count);
    if (token !== this.syncToken || this.bufferId === null) return;
    this.firstLine = start;
    this.windowStartOffset = win.startOffset;
    this.localText = win.text;
    this.applyingRemote = true;
    const selStart = this.textarea.selectionStart;
    const selEnd = this.textarea.selectionEnd;
    this.textarea.value = win.text;
    this.windowEl.style.top = `${start * LINE_HEIGHT_PX}px`;
    // Keep caret if it still fits; otherwise leave at 0.
    if (selStart <= win.text.length && selEnd <= win.text.length) {
      this.textarea.setSelectionRange(selStart, selEnd);
    }
    this.applyingRemote = false;
    this.refreshSurfaceHeight();
    this.refreshContentWidth();
    this.refreshGutter();
    this.onWindowSynced?.();
  }

  private refreshGutter() {
    if (!this.gutterEl) return;
    paintLineGutter(this.gutterEl, this.gutterLabelsSnapshot());
    this.pinGutterHorizontally();
  }

  private async flushEdit() {
    if (
      this.applyingRemote ||
      !this.bufferId ||
      this.composing ||
      this.textarea.value === this.localText
    ) {
      return;
    }
    const next = this.textarea.value;
    const diff = minimalReplace(this.localText, next);
    if (diff.start === diff.end && diff.replacement === "") return;
    const absStart = this.windowStartOffset + diff.start;
    const absEnd = this.windowStartOffset + diff.end;
    const caret = this.textarea.selectionStart;
    try {
      const result = await this.host.editRange(
        absStart,
        absEnd,
        diff.replacement,
      );
      this.rev = result.revision;
      this.localText = next;
      this.windowStartOffset = this.windowStartOffset; // unchanged for in-window edits
      // Line count may change when newlines are inserted/removed.
      this.totalLines = await this.host.lineCount(this.bufferId);
      this.updateSpacer();
      // Restore caret after remote apply guard.
      this.applyingRemote = true;
      this.textarea.setSelectionRange(caret, caret);
      this.applyingRemote = false;
      this.refreshSurfaceHeight();
      this.refreshContentWidth();
      this.refreshGutter();
      this.onWindowSynced?.();
    } catch (err) {
      // Re-sync from core on failure.
      await this.syncWindow();
      throw err;
    }
  }
}
