/**
 * WUF-112 contract: TitleChrome title text + copy Path outcome.
 *
 * Seam: title-chrome (desktop/src/title-chrome.ts).
 * No real OS title-bar pixels; no real clipboard OS UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  copyPathFromTitle,
  formatTitle,
  handleTitleClick,
  onTitleClose,
  onTitleDoubleClick,
  onTitleDragThreshold,
  onTitleMaximize,
  onTitleMinimize,
  syncWindowTitle,
  titleChromeFeedback,
  type TitleChromeState,
} from "../desktop/src/title-chrome.ts";

describe("formatTitle — Nova path / dirty / Untitled rules", () => {
  it("formats a clean Path-bound Buffer as Nova {path}", () => {
    assert.equal(
      formatTitle({ path: String.raw`D:\a.txt`, dirty: false }),
      String.raw`Nova D:\a.txt`,
    );
  });

  it("formats a dirty Path-bound Buffer as Nova *{path}", () => {
    assert.equal(
      formatTitle({ path: String.raw`D:\a.txt`, dirty: true }),
      String.raw`Nova *D:\a.txt`,
    );
  });

  it("formats a clean untitled Buffer as Nova Untitled", () => {
    assert.equal(
      formatTitle({ path: null, dirty: false }),
      "Nova Untitled",
    );
  });

  it("formats a dirty untitled Buffer as Nova *Untitled", () => {
    assert.equal(
      formatTitle({ path: null, dirty: true }),
      "Nova *Untitled",
    );
  });
});

describe("copyPathFromTitle — Path vs no_path", () => {
  it("returns the absolute Path when present (does not write clipboard itself)", () => {
    const state: TitleChromeState = {
      path: String.raw`C:\work\notes.md`,
      dirty: true,
    };
    assert.deepEqual(copyPathFromTitle(state), {
      ok: true,
      copied: String.raw`C:\work\notes.md`,
    });
  });

  it("returns no_path for Untitled and never invents a path string", () => {
    assert.deepEqual(copyPathFromTitle({ path: null, dirty: false }), {
      ok: false,
      reason: "no_path",
    });
  });
});

describe("titleChromeFeedback — brief chip labels", () => {
  it("maps successful copy to 已复制 and no_path to 无路径", () => {
    assert.equal(
      titleChromeFeedback({ ok: true, copied: String.raw`D:\a.txt` }),
      "已复制",
    );
    assert.equal(
      titleChromeFeedback({ ok: false, reason: "no_path" }),
      "无路径",
    );
  });
});

describe("syncWindowTitle — setTitle matches formatTitle", () => {
  it("calls setTitle with the same string formatTitle produces", async () => {
    const calls: string[] = [];
    const state: TitleChromeState = {
      path: String.raw`E:\doc.txt`,
      dirty: true,
    };
    const title = await syncWindowTitle(state, {
      setTitle: (t) => {
        calls.push(t);
      },
    });
    assert.equal(title, formatTitle(state));
    assert.deepEqual(calls, [String.raw`Nova *E:\doc.txt`]);
  });
});

describe("handleTitleClick — clipboard write only when Path exists", () => {
  it("writes Path and returns ok when Path-bound", async () => {
    const clipboard: string[] = [];
    const result = await handleTitleClick(
      { path: String.raw`D:\bound.txt`, dirty: false },
      {
        writeClipboard: (text) => {
          clipboard.push(text);
        },
      },
    );
    assert.deepEqual(result, {
      ok: true,
      copied: String.raw`D:\bound.txt`,
    });
    assert.deepEqual(clipboard, [String.raw`D:\bound.txt`]);
    assert.equal(titleChromeFeedback(result), "已复制");
  });

  it("does not write clipboard for Untitled", async () => {
    const clipboard: string[] = [];
    const result = await handleTitleClick(
      { path: null, dirty: true },
      {
        writeClipboard: (text) => {
          clipboard.push(text);
        },
      },
    );
    assert.deepEqual(result, { ok: false, reason: "no_path" });
    assert.deepEqual(clipboard, []);
    assert.equal(titleChromeFeedback(result), "无路径");
  });
});

function recordingWindowPort(calls: string[]) {
  return {
    startDragging: () => {
      calls.push("drag");
    },
    toggleMaximize: () => {
      calls.push("toggle");
    },
    minimize: () => {
      calls.push("minimize");
    },
    close: () => {
      calls.push("close");
    },
  };
}

describe("title region window gestures (port, no OS pixels)", () => {
  it("double-click toggles maximize via the window port", async () => {
    const calls: string[] = [];
    await onTitleDoubleClick(recordingWindowPort(calls));
    assert.deepEqual(calls, ["toggle"]);
  });

  it("drag threshold starts window move via the window port", async () => {
    const calls: string[] = [];
    await onTitleDragThreshold(recordingWindowPort(calls));
    assert.deepEqual(calls, ["drag"]);
  });

  it("caption buttons map to minimize / maximize / close", async () => {
    const calls: string[] = [];
    const win = recordingWindowPort(calls);
    await onTitleMinimize(win);
    await onTitleMaximize(win);
    await onTitleClose(win);
    assert.deepEqual(calls, ["minimize", "toggle", "close"]);
  });
});
