/**
 * WUF-76 contract: Explanation — read-only preview + anchor jump/invalidation.
 * Seam: IntentService only (preview + resolveExplanationAnchor).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentService } from "../src/intent-service.js";

describe("Explanation preview (not Patch)", () => {
  it("Intent preview returns Explanation rather than Patch", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("alpha\nERROR: boom\nomega");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "explain this",
      selection: { start: 0, end: buf.text.length },
    });
    const preview = svc.preview(intent);

    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;
    assert.ok(preview.cost);
    assert.ok(preview.explanation.summary.length > 0);
    assert.ok(preview.explanation.anchors.length >= 1);
    const a = preview.explanation.anchors[0]!;
    assert.ok(a.id.length > 0);
    assert.ok(a.end >= a.start);
    assert.ok(a.excerpt.length > 0);
    assert.equal(typeof a.baseRevision, "number");
  });
});

describe("Explanation does not mutate Buffer", () => {
  it("previewing and rejecting an Explanation leaves Buffer text unchanged", () => {
    const svc = new IntentService({ modelAvailable: true });
    const original = "keep me intact";
    const buf = svc.createBuffer(original);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "explain the text",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;

    assert.equal(svc.getBuffer(buf.id).text, original);
    assert.equal(svc.getBuffer(buf.id).revision, buf.revision);

    svc.reject(preview.previewId);
    assert.equal(svc.getBuffer(buf.id).text, original);
    assert.equal(svc.getBuffer(buf.id).revision, buf.revision);
    assert.equal(svc.getMainHistory(buf.id).length, 0);
  });
});

describe("valid anchors jump", () => {
  it("resolveExplanationAnchor returns jump target while Buffer is unchanged", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("prefix ERROR: boom suffix");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "explain",
      selection: { start: 0, end: buf.text.length },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;

    const anchor = preview.explanation.anchors.find((a) =>
      a.excerpt.includes("ERROR"),
    );
    assert.ok(anchor, "expected an ERROR anchor");

    const jump = svc.resolveExplanationAnchor(buf.id, anchor!);
    assert.equal(jump.ok, true);
    if (!jump.ok) return;
    assert.equal(jump.status, "valid");
    assert.equal(
      svc.getBuffer(buf.id).text.slice(jump.start, jump.end),
      anchor!.excerpt,
    );
  });
});

describe("stale anchors are invalid and distinguishable", () => {
  it("marks anchors invalid after unsafe edit; no wrong jump", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("line1\nERROR: boom\nline3");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "explain problems",
      selection: { start: 0, end: buf.text.length },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;

    const anchor = preview.explanation.anchors.find((a) =>
      a.excerpt.includes("ERROR"),
    );
    assert.ok(anchor);

    // Destroy the anchored span so relocate cannot safely find a unique match.
    svc.editBuffer(buf.id, "totally different content");

    const jump = svc.resolveExplanationAnchor(buf.id, anchor!);
    assert.equal(jump.ok, false);
    if (jump.ok) return;
    assert.equal(jump.status, "invalid");
    assert.ok(
      jump.reason === "reloc_failed" || jump.reason === "stale",
      `expected reloc_failed|stale, got ${jump.reason}`,
    );
    // Caller-visible: invalid status is distinguishable from a valid jump.
    assert.notEqual(jump.status, "valid");
  });

  it("relocates when excerpt still uniquely exists after a prefix insert", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("ERROR: boom");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "explain",
      selection: { start: 0, end: buf.text.length },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;

    const anchor = preview.explanation.anchors[0]!;
    assert.equal(anchor.excerpt, "ERROR: boom");

    svc.editBuffer(buf.id, ">>> ERROR: boom");

    const jump = svc.resolveExplanationAnchor(buf.id, anchor);
    assert.equal(jump.ok, true);
    if (!jump.ok) return;
    assert.equal(jump.status, "valid");
    assert.equal(jump.start, 4);
    assert.equal(jump.end, 4 + "ERROR: boom".length);
  });
});
