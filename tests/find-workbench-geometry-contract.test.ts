/**
 * WUF-121 contract: Find workbench geometry (center / clamp / drag).
 *
 * Seam: find-workbench-geometry (desktop/src/find-workbench-geometry.ts).
 * No DOM / screenshots / install-level persistence keys.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_VISIBLE_TITLE_BAR_PX,
  applyDrag,
  centerWorkbench,
  clampWorkbench,
} from "../desktop/src/find-workbench-geometry.ts";

describe("centerWorkbench", () => {
  it("centers a dialog inside a larger client", () => {
    const pos = centerWorkbench(
      { widthPx: 1000, heightPx: 800 },
      { widthPx: 400, heightPx: 300 },
    );
    assert.deepEqual(pos, { leftPx: 300, topPx: 250 });
  });

  it("does not go negative when the dialog is larger than the client", () => {
    const pos = centerWorkbench(
      { widthPx: 200, heightPx: 100 },
      { widthPx: 400, heightPx: 300 },
    );
    assert.equal(pos.leftPx, 0);
    assert.equal(pos.topPx, 0);
  });
});

describe("clampWorkbench keeps title bar reachable", () => {
  const client = { widthPx: 800, heightPx: 600 };
  const size = { widthPx: 400, heightPx: 280 };

  it("leaves an already-valid position unchanged", () => {
    const pos = { leftPx: 100, topPx: 80 };
    assert.deepEqual(clampWorkbench(pos, size, client), pos);
  });

  it("clamps far-left so a title-bar strip stays in the client", () => {
    const clamped = clampWorkbench(
      { leftPx: -10_000, topPx: 50 },
      size,
      client,
    );
    // Right edge of the visible strip: left + size >= minVisible
    assert.ok(
      clamped.leftPx + size.widthPx >= MIN_VISIBLE_TITLE_BAR_PX,
      `expected visible strip, got left=${clamped.leftPx}`,
    );
    assert.ok(clamped.leftPx < 0, "may sit partially off the left edge");
  });

  it("clamps far-right so a title-bar strip stays in the client", () => {
    const clamped = clampWorkbench(
      { leftPx: 10_000, topPx: 50 },
      size,
      client,
    );
    assert.ok(
      clamped.leftPx <= client.widthPx - MIN_VISIBLE_TITLE_BAR_PX,
      `expected left ≤ ${client.widthPx - MIN_VISIBLE_TITLE_BAR_PX}, got ${clamped.leftPx}`,
    );
  });

  it("clamps far-down so the title bar strip stays reachable", () => {
    const clamped = clampWorkbench(
      { leftPx: 100, topPx: 10_000 },
      size,
      client,
    );
    assert.ok(
      clamped.topPx <= client.heightPx - MIN_VISIBLE_TITLE_BAR_PX,
      `expected top ≤ ${client.heightPx - MIN_VISIBLE_TITLE_BAR_PX}, got ${clamped.topPx}`,
    );
  });
});

describe("applyDrag", () => {
  it("adds pointer delta to the origin", () => {
    assert.deepEqual(
      applyDrag({ leftPx: 40, topPx: 60 }, { dx: 15, dy: -10 }),
      { leftPx: 55, topPx: 50 },
    );
  });
});
