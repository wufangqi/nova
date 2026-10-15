/**
 * WUF-97 contract: Buffer core applyAccept / undo.
 * Seam: native core owns text + revision + UndoGroup; JS only holds ids/windows.
 */
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  applyAccept,
  createBuffer,
  dropBuffer,
  rev,
  setText,
  slice,
  undo,
} from "../src/buffer-core.js";

const ids: string[] = [];

function track(id: string): string {
  ids.push(id);
  return id;
}

after(() => {
  for (const id of ids) {
    try {
      dropBuffer(id);
    } catch {
      /* already dropped */
    }
  }
});

describe("Buffer core — applyAccept", () => {
  it("applies a Patch batch and returns revision from the core", () => {
    const id = track(createBuffer("hello world"));
    assert.equal(rev(id), 0);

    const result = applyAccept(id, [
      {
        baseRevision: 0,
        edits: [
          {
            start: 6,
            end: 11,
            replacement: "nova",
            before: " ",
            after: "",
          },
        ],
      },
    ]);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(typeof result.undoGroupId, "string");
    assert.ok(result.undoGroupId!.length > 0);
    assert.equal(result.rev, 1);
    assert.equal(rev(id), 1);
    assert.equal(slice(id, 0, 10), "hello nova");
  });

  it("voids the whole batch on relocate failure", () => {
    const id = track(createBuffer("alpha beta gamma"));
    setText(id, "ALPHA beta gamma");
    assert.equal(rev(id), 1);

    const result = applyAccept(id, [
      {
        baseRevision: 0,
        edits: [
          {
            start: 6,
            end: 10,
            replacement: "BETA",
            before: "alpha ",
            after: " gamma",
          },
        ],
      },
    ]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "reloc_failed");
    assert.equal(rev(id), 1);
    assert.equal(slice(id, 0, 16), "ALPHA beta gamma");
  });
});

describe("Buffer core — undo", () => {
  it("restores pre-Accept text and revision", () => {
    const id = track(createBuffer("aaa bbb ccc"));
    const accepted = applyAccept(id, [
      {
        baseRevision: 0,
        edits: [
          { start: 0, end: 3, replacement: "XXX", before: "", after: " " },
          { start: 8, end: 11, replacement: "ZZZ", before: " ", after: "" },
        ],
      },
    ]);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(slice(id, 0, 11), "XXX bbb ZZZ");

    const undone = undo(id, accepted.undoGroupId!);
    assert.equal(undone.ok, true);
    assert.equal(rev(id), 0);
    assert.equal(slice(id, 0, 11), "aaa bbb ccc");
  });
});
