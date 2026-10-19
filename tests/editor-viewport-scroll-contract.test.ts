/**
 * WUF-118 contract: editor viewport full-height fill + dual-axis scroll + gutter pin.
 *
 * Seam: editor-layout (desktop/src/editor-layout.ts) + desktop styles/markup.
 * Asserts layout probes and CSS tokens without pixel skin screenshots.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EDITOR_SCROLL_SCOPE,
  EDITOR_SOFT_WRAP_ENABLED,
  EDITOR_VIEWPORT_MIN_HEIGHT,
  assertEditorTextareaWrapAttr,
  assertEditorViewportScrollCss,
  editorContentWidthPx,
  gutterHorizontalPinTranslateX,
  gutterPinnedLeft,
  longLineHorizontallyReachable,
  viewportFillsAllocatedHeight,
} from "../desktop/src/editor-layout.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("editor viewport scroll policy", () => {
  it("keeps soft wrap off and documents fixed-chrome scroll scope", () => {
    assert.equal(EDITOR_SOFT_WRAP_ENABLED, false);
    assert.equal(EDITOR_SCROLL_SCOPE.chromeFixed, true);
    assert.equal(EDITOR_SCROLL_SCOPE.viewportOverflow, "auto");
    assert.equal(EDITOR_VIEWPORT_MIN_HEIGHT, "16rem");
  });

  it("viewport client height fills the allocated middle 1fr band", () => {
    assert.equal(
      viewportFillsAllocatedHeight({
        allocatedHeightPx: 480,
        viewportClientHeightPx: 480,
      }),
      true,
    );
    assert.equal(
      viewportFillsAllocatedHeight({
        allocatedHeightPx: 480,
        viewportClientHeightPx: 220,
      }),
      false,
    );
  });

  it("long unwrapped line is horizontally reachable on the same viewport", () => {
    assert.equal(
      longLineHorizontallyReachable({
        viewportClientWidthPx: 800,
        longLineScrollWidthPx: 2400,
        viewportScrollWidthPx: 2400,
      }),
      true,
    );
    assert.equal(
      longLineHorizontallyReachable({
        viewportClientWidthPx: 800,
        longLineScrollWidthPx: 600,
        viewportScrollWidthPx: 800,
      }),
      false,
    );
  });

  it("content width never shrinks below the viewport and grows for long lines", () => {
    assert.equal(editorContentWidthPx(800, 600), 800);
    assert.equal(editorContentWidthPx(800, 2400), 2400);
  });

  it("gutter pin translateX tracks scrollLeft; offset stays ~0 in viewport coords", () => {
    assert.equal(gutterHorizontalPinTranslateX(120), 120);
    assert.equal(gutterHorizontalPinTranslateX(0), 0);
    assert.equal(
      gutterPinnedLeft({ gutterOffsetLeftPx: 0 }),
      true,
    );
    assert.equal(
      gutterPinnedLeft({ gutterOffsetLeftPx: 40 }),
      false,
    );
  });
});

describe("desktop stylesheet + markup lock the scroll layout chain", () => {
  it("styles.css fills height, dual-axis overflow, and gutter pin base", async () => {
    const css = await readFile(join(root, "desktop/src/styles.css"), "utf8");
    assert.doesNotThrow(() => assertEditorViewportScrollCss(css));
  });

  it("index.html pins wrap=off on the editor textarea", async () => {
    const html = await readFile(join(root, "desktop/index.html"), "utf8");
    assert.doesNotThrow(() => assertEditorTextareaWrapAttr(html));
  });
});
