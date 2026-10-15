/**
 * WUF-82 regression: Path toolbar must track the active Buffer.
 * Untitled tabs clear #path-input so Save cannot reuse another tab's Path.
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

describe("Save must not reuse previous tab Path on untitled", () => {
  it("after switch to untitled, synced Path forces need_path (not stale save-as)", () => {
    const previousPath = "C:\\notes\\bound.txt";
    const untitled = { path: null, untitled: true };

    // Toolbar must not keep the previous tab's Path after activate.
    const synced = pathInputValueForActive(untitled);
    assert.equal(synced, "");
    assert.notEqual(synced, previousPath);

    assert.equal(chooseSaveAction(untitled, synced), "need_path");
  });

  it("save-as only when the user entered an explicit Path on untitled", () => {
    const untitled = { path: null, untitled: true };
    assert.deepEqual(chooseSaveAction(untitled, "C:\\notes\\new.txt"), {
      saveAs: "C:\\notes\\new.txt",
    });
  });

  it("plain save when path-bound and input matches binding", () => {
    const bound = { path: "C:\\notes\\bound.txt", untitled: false };
    assert.equal(
      chooseSaveAction(bound, pathInputValueForActive(bound)),
      "save",
    );
  });
});
