/**
 * WUF-116 contract: line gutter labels sync to VirtualEditor window start.
 *
 * Seam: line-gutter (desktop/src/line-gutter.ts) — pure label mapper + CSS
 * display-only policy. No screenshots; assert 1-based labels vs window start.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  GUTTER_CLICK_SELECTS_LINE,
  LINE_GUTTER_CSS,
  lineGutterLabels,
  mountedLineCountFromText,
  renderLineGutterMarkup,
} from "../desktop/src/line-gutter.ts";
import { cssRuleDeclarations } from "../desktop/src/editor-layout.ts";

const here = dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(
  join(here, "../desktop/src/styles.css"),
  "utf8",
);
const indexHtml = readFileSync(join(here, "../desktop/index.html"), "utf8");

describe("lineGutterLabels — 1-based vs window start", () => {
  it("returns empty when nothing is mounted", () => {
    assert.deepEqual(lineGutterLabels(0, 0), []);
    assert.deepEqual(lineGutterLabels(40, 0), []);
  });

  it("labels start at windowLineStart0 + 1", () => {
    assert.deepEqual(lineGutterLabels(0, 3), ["1", "2", "3"]);
    assert.deepEqual(lineGutterLabels(40, 4), ["41", "42", "43", "44"]);
  });

  it("clamps a negative window start to 0 for display", () => {
    assert.deepEqual(lineGutterLabels(-2, 2), ["1", "2"]);
  });
});

describe("mountedLineCountFromText — window row count", () => {
  it("counts split lines the same way as the virtual window span", () => {
    assert.equal(mountedLineCountFromText(""), 0);
    assert.equal(mountedLineCountFromText("a"), 1);
    assert.equal(mountedLineCountFromText("a\nb\nc"), 3);
    assert.equal(mountedLineCountFromText("a\nb\n"), 3);
  });
});

describe("renderLineGutterMarkup — contract-readable rows", () => {
  it("emits data-line attributes matching labels (no selection handlers)", () => {
    const html = renderLineGutterMarkup(["41", "42"]);
    assert.match(html, /data-line="41"/);
    assert.match(html, /data-line="42"/);
    assert.doesNotMatch(html, /onclick|onmousedown|select/i);
  });
});

describe("gutter display-only policy", () => {
  it("does not select a line on gutter click this Stage", () => {
    assert.equal(GUTTER_CLICK_SELECTS_LINE, false);
  });

  it("styles .line-gutter as pointer-events: none (no click-to-select)", () => {
    const decl = cssRuleDeclarations(stylesCss, LINE_GUTTER_CSS.selector);
    assert.equal(decl["pointer-events"], LINE_GUTTER_CSS.pointerEvents);
    assert.equal(decl["user-select"], LINE_GUTTER_CSS.userSelect);
  });

  it("mounts a permanent #line-gutter in the editor window markup", () => {
    assert.match(
      indexHtml,
      /id\s*=\s*["']line-gutter["'][^>]*class\s*=\s*["'][^"']*\bline-gutter\b/,
    );
  });
});

describe("labels track a scrolled / jumped window start", () => {
  it("rebuilds from the same inputs VirtualEditor exposes after sync", () => {
    // After syncWindow, firstLine is the mounted 0-based start (incl. overscan).
    const windowLineStart0 = 80;
    const windowText = "x\n".repeat(5).slice(0, -1); // 5 lines, no trailing NL
    const count = mountedLineCountFromText(windowText);
    assert.deepEqual(lineGutterLabels(windowLineStart0, count), [
      "81",
      "82",
      "83",
      "84",
      "85",
    ]);
  });
});
