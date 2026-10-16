/**
 * WUF-114 — Ctrl+G mini goto-line popup.
 *
 * Jump always goes through the injected gotoLine port (VirtualEditor.gotoLine
 * on desktop). Surface is injectable so CI never needs real window pixels.
 */

export type GotoLinePort = {
  gotoLine(line1Based: number): Promise<void> | void;
};

/**
 * Present/dismiss/focus hooks for the shell. Tests inject a recorder;
 * the desktop wires these to the mini popup DOM (not a native dialog).
 */
export type GotoLinePopupSurface = {
  present(): void;
  dismiss(): void;
  focusInput(): void;
};

export type GotoLineSubmitResult =
  | { ok: true; line: number }
  | { ok: false; reason: "invalid" };

/** Parse a 1-based line number from popup input; null if not usable. */
export function parseGotoLineInput(raw: string): number | null {
  const line = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(line) || line < 1) return null;
  return line;
}

/**
 * Controllable mini goto-line popup. Enter submits → port.gotoLine;
 * Esc / dismiss closes without jumping.
 */
export class GotoLinePopup {
  private open = false;

  constructor(
    private readonly port: GotoLinePort,
    private readonly surface: GotoLinePopupSurface,
  ) {}

  isOpen(): boolean {
    return this.open;
  }

  openPopup(): void {
    this.open = true;
    this.surface.present();
    this.surface.focusInput();
  }

  closePopup(): void {
    if (!this.open) return;
    this.open = false;
    this.surface.dismiss();
  }

  async submit(raw: string): Promise<GotoLineSubmitResult> {
    const line = parseGotoLineInput(raw);
    if (line === null) {
      return { ok: false, reason: "invalid" };
    }
    await this.port.gotoLine(line);
    this.closePopup();
    return { ok: true, line };
  }
}
