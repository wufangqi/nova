/**
 * WUF-101 — virtually scrolled editor surface.
 * Visible lines come from line_window; typing uses span edit_active.
 * Never mounts full Buffer text in the DOM.
 */

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

  constructor(
    private readonly viewport: HTMLElement,
    private readonly spacer: HTMLElement,
    private readonly windowEl: HTMLElement,
    private readonly textarea: HTMLTextAreaElement,
    private readonly host: VirtualEditorHost,
  ) {
    this.viewport.addEventListener("scroll", () => {
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
    } catch (err) {
      // Re-sync from core on failure.
      await this.syncWindow();
      throw err;
    }
  }
}
