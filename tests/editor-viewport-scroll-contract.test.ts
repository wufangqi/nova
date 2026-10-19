/**
 * WUF-118 / WUF-119 contract: editor viewport scroll + editable surface fill.
 *
 * Seam: editor-layout (desktop/src/editor-layout.ts) + desktop styles/markup.
 * Merges WUF-118 CSS string locks with WUF-119 geometry probes (no screenshots).
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
  editorSurfaceFillHolds,
  editorSurfaceMinHeightPx,
  editorSurfaceVerticalPaddingPx,
  gutterFillsViewportClientHeight,
  gutterHorizontalPinTranslateX,
  gutterPinnedLeft,
  longLineHorizontallyReachable,
  probeEditorSurfaceFill,
  surfaceFillsViewportClientHeight,
  viewportFillsAllocatedHeight,
} from "../desktop/src/editor-layout.ts";
import { LINE_HEIGHT_PX } from "../desktop/src/virtual-editor.ts";

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

describe("editable surface fill policy (WUF-119)", () => {
  const pad = editorSurfaceVerticalPaddingPx();

  it("min-height is at least the viewport, even with few mounted lines", () => {
    assert.equal(
      editorSurfaceMinHeightPx(480, 3, LINE_HEIGHT_PX, pad),
      480,
    );
    assert.equal(
      editorSurfaceMinHeightPx(480, 0, LINE_HEIGHT_PX, pad),
      480,
    );
  });

  it("min-height grows with mounted lines + vertical padding when taller than viewport", () => {
    const lines = 40;
    const expected = lines * LINE_HEIGHT_PX + pad;
    assert.ok(expected > 400);
    assert.equal(
      editorSurfaceMinHeightPx(400, lines, LINE_HEIGHT_PX, pad),
      expected,
    );
  });

  it("surface and gutter heights cover viewport; mid-lower click hits textarea", () => {
    const viewportClientHeightPx = 500;
    const viewportClientWidthPx = 800;
    const surfaceHeightPx = editorSurfaceMinHeightPx(
      viewportClientHeightPx,
      5,
      LINE_HEIGHT_PX,
      pad,
    );
    const clickInViewport = {
      x: viewportClientWidthPx / 2,
      y: viewportClientHeightPx * 0.75,
    };
    const probe = probeEditorSurfaceFill({
      viewportClientHeightPx,
      viewportClientWidthPx,
      surfaceHeightPx,
      gutterHeightPx: surfaceHeightPx,
      clickInViewport,
    });
    assert.equal(surfaceFillsViewportClientHeight(probe), true);
    assert.equal(gutterFillsViewportClientHeight(probe), true);
    assert.equal(probe.hitTargetIsTextarea, true);
    assert.equal(editorSurfaceFillHolds(probe), true);
  });

  it("short surface fails fill and miss-hits the mid-lower click", () => {
    const probe = probeEditorSurfaceFill({
      viewportClientHeightPx: 500,
      viewportClientWidthPx: 800,
      surfaceHeightPx: 80,
      gutterHeightPx: 80,
      clickInViewport: { x: 400, y: 375 },
    });
    assert.equal(surfaceFillsViewportClientHeight(probe), false);
    assert.equal(gutterFillsViewportClientHeight(probe), false);
    assert.equal(probe.hitTargetIsTextarea, false);
    assert.equal(editorSurfaceFillHolds(probe), false);
  });

  it("fill still holds after a non-zero scrollTop (visible surface ≥ clientHeight)", () => {
    // scrollTop does not shrink the required surface floor — same min-height.
    const viewportClientHeightPx = 420;
    const surfaceHeightPx = editorSurfaceMinHeightPx(
      viewportClientHeightPx,
      12,
      LINE_HEIGHT_PX,
      pad,
    );
    const probe = probeEditorSurfaceFill({
      viewportClientHeightPx,
      viewportClientWidthPx: 720,
      surfaceHeightPx,
      gutterHeightPx: surfaceHeightPx,
      clickInViewport: { x: 360, y: viewportClientHeightPx * 0.8 },
    });
    assert.equal(editorSurfaceFillHolds(probe), true);
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
