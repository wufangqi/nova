/**
 * WUF-111 contract: editor content uses the full viewport width (no half-column).
 *
 * Seam: editor-layout (desktop/src/editor-layout.ts) + desktop styles/markup.
 * Asserts the CSS width chain and soft-wrap policy without pixel skin screenshots.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SOFT_WRAP_ENABLED,
  EDITOR_TEXTAREA_WRAP_ATTR,
  EDITOR_WHITE_SPACE,
  assertEditorTextareaWrapAttr,
  assertEditorViewportWidthCss,
  editorContentBoxWidthPx,
  isCollapsedHalfWidthColumn,
  longUnwrappedLineUsesRightHalf,
} from "../desktop/src/editor-layout.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("editor viewport width policy", () => {
  it("keeps soft wrap off after half-width root-cause analysis", () => {
    assert.equal(EDITOR_SOFT_WRAP_ENABLED, false);
    assert.equal(EDITOR_TEXTAREA_WRAP_ATTR, "off");
    assert.equal(EDITOR_WHITE_SPACE, "pre");
  });

  it("content box fills the viewport (no half-column geometry)", () => {
    assert.equal(editorContentBoxWidthPx(1200), 1200);
    assert.equal(editorContentBoxWidthPx(800), 800);
    assert.equal(
      isCollapsedHalfWidthColumn({
        viewportWidthPx: 1200,
        contentBoxWidthPx: 200,
      }),
      true,
    );
    assert.equal(
      isCollapsedHalfWidthColumn({
        viewportWidthPx: 1200,
        contentBoxWidthPx: 1200,
      }),
      false,
    );
  });

  it("wide viewport + long unwrapped line reaches the right half", () => {
    assert.equal(
      longUnwrappedLineUsesRightHalf({
        viewportWidthPx: 1200,
        contentBoxWidthPx: editorContentBoxWidthPx(1200),
        longLineScrollWidthPx: 1800,
      }),
      true,
    );
    // Collapsed abspos window (~intrinsic cols) fails the contract.
    assert.equal(
      longUnwrappedLineUsesRightHalf({
        viewportWidthPx: 1200,
        contentBoxWidthPx: 200,
        longLineScrollWidthPx: 1800,
      }),
      false,
    );
  });
});

describe("desktop stylesheet + markup lock the width chain", () => {
  it("styles.css stretches viewport → window → editor to 100% with pre", async () => {
    const css = await readFile(join(root, "desktop/src/styles.css"), "utf8");
    assert.doesNotThrow(() => assertEditorViewportWidthCss(css));
  });

  it("index.html pins wrap=off on the editor textarea", async () => {
    const html = await readFile(join(root, "desktop/index.html"), "utf8");
    assert.doesNotThrow(() => assertEditorTextareaWrapAttr(html));
  });
});
