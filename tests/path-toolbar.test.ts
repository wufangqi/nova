/**
 * WUF-82 / WUF-104: Path chrome tracks the active Buffer (display-only).
 * Untitled clears the display; Save routing no longer uses typed Path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chooseSaveAction,
  pathInputValueForActive,
} from "../desktop/src/path-toolbar.ts";

describe("Path toolbar sync with active Buffer", () => {
  it("shows the bound Path for a path-bound tab", () => {
    assert.equal(
      pathInputValueForActive({ path: "C:\\notes\\demo.txt", untitled: false }),
      "C:\\notes\\demo.txt",
    );
  });

  it("clears the Path when the active tab is untitled", () => {
    assert.equal(pathInputValueForActive({ path: null, untitled: true }), "");
  });

  it("clears the Path when there is no active tab", () => {
    assert.equal(pathInputValueForActive(undefined), "");
    assert.equal(pathInputValueForActive(null), "");
  });
});

describe("Save routing without typed Path", () => {
  it("untitled needs Save As (PathPicker), never reuses a previous Path", () => {
    const previousPath = "C:\\notes\\bound.txt";
    const untitled = { path: null, untitled: true };

    const synced = pathInputValueForActive(untitled);
    assert.equal(synced, "");
    assert.notEqual(synced, previousPath);

    assert.equal(chooseSaveAction(untitled), "need_save_as");
  });

  it("plain save when path-bound", () => {
    const bound = { path: "C:\\notes\\bound.txt", untitled: false };
    assert.equal(chooseSaveAction(bound), "save");
  });
});
