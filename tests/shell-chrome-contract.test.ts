/**
 * WUF-115 contract: menu-first shell — File + Help menus, shortcuts, Ctrl+W.
 *
 * Seam: shell-chrome (desktop/src/shell-chrome.ts).
 * No toolbar action table. No real OS menu/dialog pixels; no Encoding/Language.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { APP_PRODUCT_NAME, APP_VERSION } from "../desktop/src/app-meta.ts";
import {
  SHELL_CLOSE_ACCELERATOR,
  SHELL_DEFERRED_MENU_LABELS,
  SHELL_FILE_MENU_ITEMS,
  SHELL_HELP_MENU_ITEMS,
  aboutInfoFromConfig,
  resolveShellShortcut,
  runShellAction,
  shouldDismissDetailsMenu,
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
    intent: () => {
      calls.push("intent");
    },
    demo: () => {
      calls.push("demo");
    },
    about: () => {
      calls.push("about");
    },
    close: () => {
      calls.push("close");
    },
  } satisfies ShellChromeHandlers & { calls: ShellChromeAction[] };
  return handlers;
}

describe("File menu + shortcuts (no toolbar table)", () => {
  it("File menu lists New / Open / Save / Save As / Find / Intent", () => {
    const ids = SHELL_FILE_MENU_ITEMS.map((item) => item.id);
    assert.deepEqual(ids, [
      "new",
      "open",
      "save",
      "save_as",
      "find",
      "intent",
    ]);
  });

  it("File menu does not include Close", () => {
    assert.equal(
      SHELL_FILE_MENU_ITEMS.some(
        (item) => item.id === ("close" as string) || item.label === "Close",
      ),
      false,
    );
  });

  it("menu and shortcut invoke the same handler for each shortcut file action", () => {
    const actions: ShellFileAction[] = [
      "new",
      "open",
      "save",
      "save_as",
      "find",
    ];
    for (const action of actions) {
      const handlers = recordingHandlers();
      runShellAction(action, handlers); // menu path
      const shortcut = SHELL_FILE_MENU_ITEMS.find((i) => i.id === action)!;
      assert.ok(shortcut.accelerator, `expected accelerator for ${action}`);
      const resolved = resolveShellShortcut(
        parseAccelerator(shortcut.accelerator!),
      );
      assert.equal(resolved, action);
      if (resolved) runShellAction(resolved, handlers); // shortcut path
      assert.deepEqual(handlers.calls, [action, action]);
    }
  });

  it("Intent… is menu-only and opens via the shared handler table", () => {
    const handlers = recordingHandlers();
    const item = SHELL_FILE_MENU_ITEMS.find((i) => i.id === "intent")!;
    assert.equal(item.label, "Intent…");
    assert.equal(item.accelerator, undefined);
    runShellAction("intent", handlers);
    assert.deepEqual(handlers.calls, ["intent"]);
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

describe("Ctrl+W shares the tab-close action path", () => {
  it("maps Ctrl+W to close (same action tab × handlers run)", () => {
    assert.equal(SHELL_CLOSE_ACCELERATOR, "Ctrl+W");
    const resolved = resolveShellShortcut(parseAccelerator(SHELL_CLOSE_ACCELERATOR));
    assert.equal(resolved, "close");
  });

  it("runShellAction(close) hits the shared close handler", () => {
    const handlers = recordingHandlers();
    runShellAction("close", handlers);
    assert.deepEqual(handlers.calls, ["close"]);
  });
});

describe("Help menu: Demo… and About", () => {
  it("Help lists Demo… and About; Demo is not on File", () => {
    assert.deepEqual(
      SHELL_HELP_MENU_ITEMS.map((item) => item.id),
      ["demo", "about"],
    );
    assert.equal(
      SHELL_FILE_MENU_ITEMS.some((item) => item.id === "demo"),
      false,
    );
  });

  it("Help Demo and About dispatch through the shared handler table", () => {
    const handlers = recordingHandlers();
    runShellAction("demo", handlers);
    runShellAction("about", handlers);
    assert.deepEqual(handlers.calls, ["demo", "about"]);
  });

  it("About info takes name and version from app config", () => {
    const info = aboutInfoFromConfig({
      productName: APP_PRODUCT_NAME,
      version: APP_VERSION,
    });
    assert.equal(info.name, APP_PRODUCT_NAME);
    assert.equal(info.version, APP_VERSION);
    assert.ok(info.blurb.length > 0);
  });
});

describe("menus dismiss on outside pointer", () => {
  it("does not dismiss when closed or when target is inside the menu", () => {
    const inside = { nodeType: 1 } as unknown as Node;
    const menu = {
      open: false,
      contains: (n: Node) => n === inside,
    };
    assert.equal(shouldDismissDetailsMenu(menu, inside), false);
    menu.open = true;
    assert.equal(shouldDismissDetailsMenu(menu, inside), false);
  });

  it("dismisses when open and the target is outside (or missing)", () => {
    const inside = { nodeType: 1 } as unknown as Node;
    const outside = { nodeType: 1 } as unknown as Node;
    const menu = {
      open: true,
      contains: (n: Node) => n === inside,
    };
    assert.equal(shouldDismissDetailsMenu(menu, outside), true);
    assert.equal(shouldDismissDetailsMenu(menu, null), true);
  });
});

describe("no Encoding/Language expansion", () => {
  it("File and Help menus do not include Encoding or Language", () => {
    const labels = [
      ...SHELL_FILE_MENU_ITEMS.map((item) => item.label),
      ...SHELL_HELP_MENU_ITEMS.map((item) => item.label),
    ];
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
