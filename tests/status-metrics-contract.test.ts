/**
 * WUF-113 contract: status-bar metrics mapper is pure (no pixels / DOM).
 *
 * Seam: status-metrics (desktop/src/status-metrics.ts).
 * Inputs: Buffer length, line count, caret offsets (+ optional window text
 * for line/column). Empty Buffer / no Buffer → placeholders.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  caretLineColumnInWindow,
  formatStatusMetrics,
  mapStatusMetrics,
} from "../desktop/src/status-metrics.ts";

describe("mapStatusMetrics — no Buffer placeholders", () => {
  it("returns zeros and null caret fields when hasBuffer is false", () => {
    assert.deepEqual(
      mapStatusMetrics({
        hasBuffer: false,
        length: 99,
        lineCount: 99,
        caretOffset: 5,
        caretLine: 2,
        caretColumn: 3,
      }),
      {
        length: 0,
        lineCount: 0,
        line: null,
        column: null,
        offset: null,
      },
    );
  });
});

describe("mapStatusMetrics — active Buffer", () => {
  it("passes through length, lineCount, and caret fields", () => {
    assert.deepEqual(
      mapStatusMetrics({
        hasBuffer: true,
        length: 12,
        lineCount: 3,
        caretOffset: 7,
        caretLine: 2,
        caretColumn: 4,
      }),
      {
        length: 12,
        lineCount: 3,
        line: 2,
        column: 4,
        offset: 7,
      },
    );
  });

  it("allows null caret when Buffer exists but caret is unknown", () => {
    assert.deepEqual(
      mapStatusMetrics({
        hasBuffer: true,
        length: 0,
        lineCount: 1,
        caretOffset: null,
        caretLine: null,
        caretColumn: null,
      }),
      {
        length: 0,
        lineCount: 1,
        line: null,
        column: null,
        offset: null,
      },
    );
  });
});

describe("formatStatusMetrics — display labels", () => {
  it("renders numbers and uses — for null caret fields", () => {
    assert.deepEqual(
      formatStatusMetrics({
        length: 0,
        lineCount: 0,
        line: null,
        column: null,
        offset: null,
      }),
      {
        length: "0",
        lineCount: "0",
        line: "—",
        column: "—",
        offset: "—",
      },
    );
    assert.deepEqual(
      formatStatusMetrics({
        length: 10,
        lineCount: 2,
        line: 1,
        column: 5,
        offset: 4,
      }),
      {
        length: "10",
        lineCount: "2",
        line: "1",
        column: "5",
        offset: "4",
      },
    );
  });
});

describe("caretLineColumnInWindow — caret offsets → 1-based 行/列", () => {
  it("maps caret at start of Buffer to line 1 column 1", () => {
    assert.deepEqual(
      caretLineColumnInWindow({
        windowText: "abc\ndef",
        windowLineStart: 0,
        windowStartOffset: 0,
        caretOffset: 0,
      }),
      { line: 1, column: 1 },
    );
  });

  it("counts newlines for line and column within the window", () => {
    // "abc\ndef" — caret after 'e' (offset 5)
    assert.deepEqual(
      caretLineColumnInWindow({
        windowText: "abc\ndef",
        windowLineStart: 0,
        windowStartOffset: 0,
        caretOffset: 5,
      }),
      { line: 2, column: 2 },
    );
  });

  it("adds windowLineStart when the mounted window is mid-Buffer", () => {
    // Window starts at line index 10 (0-based), absolute offset 40.
    // Local caret at 0 → Buffer line 11, column 1.
    assert.deepEqual(
      caretLineColumnInWindow({
        windowText: "hello\nworld",
        windowLineStart: 10,
        windowStartOffset: 40,
        caretOffset: 40,
      }),
      { line: 11, column: 1 },
    );
    assert.deepEqual(
      caretLineColumnInWindow({
        windowText: "hello\nworld",
        windowLineStart: 10,
        windowStartOffset: 40,
        caretOffset: 46, // after "hello\n"
      }),
      { line: 12, column: 1 },
    );
  });

  it("returns null when caret is outside the mounted window", () => {
    assert.equal(
      caretLineColumnInWindow({
        windowText: "ab",
        windowLineStart: 0,
        windowStartOffset: 10,
        caretOffset: 5,
      }),
      null,
    );
    assert.equal(
      caretLineColumnInWindow({
        windowText: "ab",
        windowLineStart: 0,
        windowStartOffset: 10,
        caretOffset: 13,
      }),
      null,
    );
  });
});
