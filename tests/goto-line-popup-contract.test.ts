/**
 * WUF-114 contract: Ctrl+G mini goto-line popup → VirtualEditor.gotoLine.
 *
 * Seam: `GotoLinePopup` (desktop/src/goto-line-popup.ts) with injectable
 * GotoLinePort + GotoLinePopupSurface (no real window pixels).
 *
 * Acceptance:
 * - Popup submit with a valid 1-based line calls port.gotoLine
 * - Invalid input does not call gotoLine
 * - Dismiss (Esc path) closes without jumping
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GotoLinePopup,
  parseGotoLineInput,
  type GotoLinePopupSurface,
} from "../desktop/src/goto-line-popup.ts";

type SurfaceLog = {
  presents: number;
  dismisses: number;
  focusCalls: number;
};

function recordingSurface(): GotoLinePopupSurface & { log: SurfaceLog } {
  const log: SurfaceLog = { presents: 0, dismisses: 0, focusCalls: 0 };
  return {
    log,
    present() {
      log.presents += 1;
    },
    dismiss() {
      log.dismisses += 1;
    },
    focusInput() {
      log.focusCalls += 1;
    },
  };
}

describe("parseGotoLineInput", () => {
  it("accepts positive 1-based integers", () => {
    assert.equal(parseGotoLineInput("1"), 1);
    assert.equal(parseGotoLineInput(" 42 "), 42);
  });

  it("rejects empty, zero, negative, and non-numeric", () => {
    assert.equal(parseGotoLineInput(""), null);
    assert.equal(parseGotoLineInput("0"), null);
    assert.equal(parseGotoLineInput("-3"), null);
    assert.equal(parseGotoLineInput("abc"), null);
  });
});

describe("Goto-line popup → gotoLine", () => {
  it("open presents and focuses without calling gotoLine", () => {
    const calls: number[] = [];
    const surface = recordingSurface();
    const popup = new GotoLinePopup(
      {
        gotoLine(line) {
          calls.push(line);
        },
      },
      surface,
    );

    assert.equal(popup.isOpen(), false);
    popup.openPopup();
    assert.equal(popup.isOpen(), true);
    assert.equal(surface.log.presents, 1);
    assert.equal(surface.log.focusCalls, 1);
    assert.deepEqual(calls, []);
  });

  it("submit with valid line calls gotoLine then dismisses", async () => {
    const calls: number[] = [];
    const surface = recordingSurface();
    const popup = new GotoLinePopup(
      {
        async gotoLine(line) {
          calls.push(line);
        },
      },
      surface,
    );

    popup.openPopup();
    const result = await popup.submit("7");
    assert.deepEqual(result, { ok: true, line: 7 });
    assert.deepEqual(calls, [7]);
    assert.equal(popup.isOpen(), false);
    assert.equal(surface.log.dismisses, 1);
  });

  it("invalid input does not call gotoLine and stays open", async () => {
    const calls: number[] = [];
    const surface = recordingSurface();
    const popup = new GotoLinePopup(
      {
        gotoLine(line) {
          calls.push(line);
        },
      },
      surface,
    );

    popup.openPopup();
    const result = await popup.submit("nope");
    assert.deepEqual(result, { ok: false, reason: "invalid" });
    assert.deepEqual(calls, []);
    assert.equal(popup.isOpen(), true);
    assert.equal(surface.log.dismisses, 0);
  });

  it("dismiss closes without jumping", () => {
    const calls: number[] = [];
    const surface = recordingSurface();
    const popup = new GotoLinePopup(
      {
        gotoLine(line) {
          calls.push(line);
        },
      },
      surface,
    );

    popup.openPopup();
    popup.closePopup();
    assert.equal(popup.isOpen(), false);
    assert.equal(surface.log.dismisses, 1);
    assert.deepEqual(calls, []);
  });
});
