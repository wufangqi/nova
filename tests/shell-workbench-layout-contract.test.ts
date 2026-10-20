/**
 * WUF-121 contract: shell has no permanent Intent/Actions bottom bars;
 * Find workbench hosts them; editor grid abuts the status bar.
 *
 * Seam: shell-workbench-layout + desktop index.html / styles.css.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertShellHasNoBottomIntentActionPanels,
  assertShellWorkbenchGridCss,
} from "../desktop/src/shell-workbench-layout.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("shell workbench layout — no bottom Intent/Actions bars", () => {
  it("index.html keeps Intent/Actions inside #find-dialog only", async () => {
    const html = await readFile(join(root, "desktop/index.html"), "utf8");
    assert.doesNotThrow(() => assertShellHasNoBottomIntentActionPanels(html));
  });

  it("styles.css uses chrome + editor 1fr + status-bar grid; find uses left/top", async () => {
    const css = await readFile(join(root, "desktop/src/styles.css"), "utf8");
    assert.doesNotThrow(() => assertShellWorkbenchGridCss(css));
  });
});
