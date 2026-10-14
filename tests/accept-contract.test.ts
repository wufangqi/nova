/**
 * WUF-70 contract: Buffer + Accept / UndoGroup / dual-track Provenance.
 * Seam under test: IntentService (Accept write path). No UI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentService } from "../src/intent-service.js";
import type { Patch } from "../src/types.js";

function aiPatch(
  bufferId: string,
  baseRevision: number,
  edits: Patch["edits"],
  intentId = "intent-1",
): Patch {
  return {
    bufferId,
    baseRevision,
    edits,
    provenance: { source: "ai", label: "model-stub" },
    intentId,
  };
}

describe("Buffer substrate", () => {
  it("creates an in-memory Buffer with logical text and a revision", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("hello");
    assert.equal(buf.text, "hello");
    assert.equal(typeof buf.id, "string");
    assert.equal(buf.revision, 0);
  });

  it("edits Buffer text and bumps revision", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("hello");
    const next = svc.editBuffer(buf.id, "hello world");
    assert.equal(next.text, "hello world");
    assert.equal(next.revision, 1);
    assert.equal(svc.getBuffer(buf.id).text, "hello world");
  });
});

describe("Accept writes via IntentService", () => {
  it("applies a hand-crafted Patch batch to the Buffer", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("hello world");
    const result = svc.accept([
      aiPatch(buf.id, buf.revision, [
        { start: 6, end: 11, replacement: "nova", before: " ", after: "" },
      ]),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(svc.getBuffer(buf.id).text, "hello nova");
    assert.ok(svc.getBuffer(buf.id).revision > buf.revision);
  });
});

describe("UndoGroup", () => {
  it("one Accept is one UndoGroup; one undo restores pre-Accept text", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("aaa bbb ccc");
    const result = svc.accept([
      aiPatch(buf.id, buf.revision, [
        { start: 0, end: 3, replacement: "XXX", before: "", after: " " },
        { start: 8, end: 11, replacement: "ZZZ", before: " ", after: "" },
      ]),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(svc.getBuffer(buf.id).text, "XXX bbb ZZZ");

    svc.undo(result.undoGroupId);
    assert.equal(svc.getBuffer(buf.id).text, "aaa bbb ccc");
  });
});

describe("relocate failure voids the batch", () => {
  it("leaves Buffer unchanged when any edit cannot relocate after drift", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("alpha beta gamma");
    // Human types while a preview is outstanding → revision drifts.
    svc.editBuffer(buf.id, "ALPHA beta gamma");

    const result = svc.accept([
      aiPatch(buf.id, 0, [
        // Anchored to original "beta"; after human edit the surrounding
        // context no longer matches a safe relocate for this fixture.
        {
          start: 6,
          end: 10,
          replacement: "BETA",
          before: "alpha ",
          after: " gamma",
        },
      ]),
    ]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "reloc_failed");
    assert.equal(svc.getBuffer(buf.id).text, "ALPHA beta gamma");
  });

  it("does not partially apply a multi-edit batch on relocate failure", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("one two three");
    svc.editBuffer(buf.id, "ONE two three");

    const result = svc.accept([
      aiPatch(buf.id, 0, [
        {
          start: 0,
          end: 3,
          replacement: "uno",
          before: "",
          after: " ",
        },
        {
          start: 8,
          end: 13,
          replacement: "tres",
          before: "two ",
          after: "",
        },
      ]),
    ]);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "reloc_failed");
    assert.equal(svc.getBuffer(buf.id).text, "ONE two three");
  });
});

describe("dual-track Provenance", () => {
  it("records human commit on the main track and original AI on the audit side-car", () => {
    const svc = new IntentService();
    const buf = svc.createBuffer("plain text");
    const result = svc.accept([
      aiPatch(buf.id, buf.revision, [
        { start: 0, end: 5, replacement: "Plain", before: "", after: " " },
      ]),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const main = svc.getMainHistory(buf.id);
    assert.ok(main.length >= 1);
    const last = main[main.length - 1]!;
    assert.equal(last.committedBy, "user");
    assert.equal(last.undoGroupId, result.undoGroupId);

    const audit = svc.getProvenanceAudit(buf.id);
    assert.ok(audit.length >= 1);
    const entry = audit[audit.length - 1]!;
    assert.equal(entry.undoGroupId, result.undoGroupId);
    assert.equal(entry.originalProvenance.source, "ai");
    assert.equal(entry.intentId, "intent-1");
    assert.equal(entry.committedBy, "user");
  });
});
