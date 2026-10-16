/**
 * WUF-108 contract: toolbar + simple File menu + shortcuts share one action table.
 *
 * Seam: shell-chrome (desktop/src/shell-chrome.ts).
 * No real OS menu/dialog pixels; no Encoding/Language menu expansion.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SHELL_DEMO_ACTION,
  SHELL_DEFERRED_MENU_LABELS,
  SHELL_FILE_MENU_ITEMS,
  SHELL_TOOLBAR_FILE_ACTIONS,
  resolveShellShortcut,
  runShellAction,
  type ShellChromeAction,
  type ShellChromeHandlers,
  type ShellFileAction,
} from "../desktop/src/shell-chrome.ts";

function recordingHandlers(): ShellChromeHandlers & {
  calls: ShellChromeAction[];
} {
  const calls: ShellChromeAction[] = [];
  const handlers = {
    calls,
    new: () => {
      calls.push("new");
    },
    open: () => {
      calls.push("open");
    },
    save: () => {
      calls.push("save");
    },
    save_as: () => {
      calls.push("save_as");
    },
    find: () => {
      calls.push("find");
    },
    demo: () => {
      calls.push("demo");
    },
  } satisfies ShellChromeHandlers & { calls: ShellChromeAction[] };
  return handlers;
}

describe("toolbar and File menu expose the same file actions", () => {
  it("File menu lists New / Open / Save / Save As / Find", () => {
    const ids = SHELL_FILE_MENU_ITEMS.map((item) => item.id);
    assert.deepEqual(ids, ["new", "open", "save", "save_as", "find"]);
  });

  it("toolbar file actions match the File menu set (same effect surface)", () => {
    assert.deepEqual(
      [...SHELL_TOOLBAR_FILE_ACTIONS],
      SHELL_FILE_MENU_ITEMS.map((item) => item.id),
    );
  });

  it("toolbar, menu, and shortcut invoke the same handler for each file action", () => {
    const actions: ShellFileAction[] = [
      "new",
      "open",
      "save",
      "save_as",
      "find",
    ];
    for (const action of actions) {
      const handlers = recordingHandlers();
      runShellAction(action, handlers); // toolbar / menu path
      const shortcut = SHELL_FILE_MENU_ITEMS.find((i) => i.id === action)!;
      const resolved = resolveShellShortcut(
        parseAccelerator(shortcut.accelerator),
      );
      assert.equal(resolved, action);
      if (resolved) runShellAction(resolved, handlers); // shortcut path
      assert.deepEqual(handlers.calls, [action, action]);
    }
  });
});

describe("Ctrl+N / O / S / Shift+S / F shortcuts", () => {
  it("maps each accelerator to the matching file action", () => {
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        key: "n",
      }),
      "new",
    );
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        key: "o",
      }),
      "open",
    );
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        key: "s",
      }),
      "save",
    );
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: true,
        key: "S",
      }),
      "save_as",
    );
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        key: "f",
      }),
      "find",
    );
  });

  it("ignores Ctrl+Alt+N so global evoke stays distinct", () => {
    assert.equal(
      resolveShellShortcut({
        ctrlKey: true,
        altKey: true,
        metaKey: false,
        shiftKey: false,
        key: "n",
      }),
      null,
    );
  });
});

describe("Demo stays reachable; no Encoding/Language expansion", () => {
  it("Demo is a chrome action outside the File menu", () => {
    assert.equal(SHELL_DEMO_ACTION, "demo");
    assert.equal(
      SHELL_FILE_MENU_ITEMS.some((item) => item.id === "demo"),
      false,
    );
    const handlers = recordingHandlers();
    runShellAction("demo", handlers);
    assert.deepEqual(handlers.calls, ["demo"]);
  });

  it("File menu does not include Encoding or Language", () => {
    const labels = SHELL_FILE_MENU_ITEMS.map((item) => item.label);
    for (const deferred of SHELL_DEFERRED_MENU_LABELS) {
      assert.equal(
        labels.some((label) => label === deferred || label.startsWith(deferred)),
        false,
        `unexpected deferred menu: ${deferred}`,
      );
    }
  });
});

/** Parse "Ctrl+N" / "Ctrl+Shift+S" into a key event shape for resolveShellShortcut. */
function parseAccelerator(accel: string): {
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  key: string;
} {
  const parts = accel.split("+");
  const key = parts[parts.length - 1]!;
  return {
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    metaKey: parts.includes("Meta"),
    shiftKey: parts.includes("Shift"),
    key,
  };
}
