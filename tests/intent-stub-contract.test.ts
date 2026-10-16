/**
 * WUF-74 contract: IntentService stub — parse → preview → Accept/reject.
 * Seam: IntentService only. Deterministic stub (no real model).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FindBar } from "../src/find-bar.js";
import { IntentService } from "../src/intent-service.js";
import { bufferBody } from './helpers/buffer-text.js';

describe("parse / preview / accept / reject (deterministic stub)", () => {
  it("end-to-end: utterance → Patch preview → Accept writes Buffer", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("hello world");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      selection: { start: 0, end: 5 },
    });
    assert.equal(intent.utterance, "uppercase");
    assert.equal(intent.scope.kind, "selection");

    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    assert.ok(preview.cost);
    assert.ok(preview.patches.length >= 1);

    const before = bufferBody(svc, buf.id);
    const result = svc.accept(preview.patches);
    assert.equal(result.ok, true);
    assert.equal(bufferBody(svc, buf.id), "HELLO world");
    assert.notEqual(bufferBody(svc, buf.id), before);

    if (result.ok) {
      const audit = svc.getProvenanceAudit(buf.id);
      assert.ok(audit.some((e) => e.originalProvenance.source === "ai"));
      svc.undo(result.undoGroupId);
      assert.equal(bufferBody(svc, buf.id), "hello world");
    }
  });

  it("reject discards preview and leaves Buffer unchanged", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("keep me");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;

    svc.reject(preview.previewId);
    assert.equal(bufferBody(svc, buf.id), "keep me");
    assert.equal(svc.getBuffer(buf.id).revision, buf.revision);
  });
});

describe("preview Cost", () => {
  it("every successful preview includes Cost", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("abc");
    const intent = svc.parse({ bufferId: buf.id, utterance: "uppercase" });
    const preview = svc.preview(intent);
    assert.notEqual(preview.kind, "error");
    if (preview.kind === "error") return;
    assert.equal(typeof preview.cost.latencyMsEstimate, "number");
    assert.equal(typeof preview.cost.tokensEstimate, "number");
    assert.equal(typeof preview.cost.hasOutbound, "boolean");
  });
});

describe("Scope resolution", () => {
  it("defaults to visible window/sample (not whole Buffer) and exposes Scope to the user", () => {
    const sampleChars = 8;
    const svc = new IntentService({
      modelAvailable: true,
      visibleSampleChars: sampleChars,
    });
    // Large Buffer: default Scope must sample, not swallow the whole file.
    const buf = svc.createBuffer("abcdefghijklmnopqrstuvwxyz");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
    });

    assert.equal(intent.scope.kind, "visible");
    if (intent.scope.kind !== "visible") return;
    assert.equal(intent.scope.start, 0);
    assert.equal(intent.scope.end, sampleChars);
    assert.equal(intent.scope.sampled, true);
    // Scope must be visible to the caller (label + bounds).
    assert.ok(intent.scopeLabel.length > 0);
    assert.match(intent.scopeLabel, /visible|sample/i);

    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    const result = svc.accept(preview.patches);
    assert.equal(result.ok, true);
    // Only the sampled window is uppercased; rest of Buffer unchanged.
    assert.equal(bufferBody(svc, buf.id), "ABCDEFGHijklmnopqrstuvwxyz");
  });

  it("uses Selection when provided", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("one two three");
    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      selection: { start: 4, end: 7 },
      visibleWindow: { start: 0, end: 13 },
    });
    assert.equal(intent.scope.kind, "selection");
    if (intent.scope.kind !== "selection") return;
    assert.equal(intent.scope.start, 4);
    assert.equal(intent.scope.end, 7);
    assert.match(intent.scopeLabel, /selection/i);

    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    assert.equal(svc.accept(preview.patches).ok, true);
    assert.equal(bufferBody(svc, buf.id), "one TWO three");
  });

  it("uses provided visible window when no Selection", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("abcdefghij");
    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      visibleWindow: { start: 2, end: 5 },
    });
    assert.equal(intent.scope.kind, "visible");
    if (intent.scope.kind !== "visible") return;
    assert.equal(intent.scope.start, 2);
    assert.equal(intent.scope.end, 5);
    assert.equal(intent.scope.sampled, false);

    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    assert.equal(svc.accept(preview.patches).ok, true);
    assert.equal(bufferBody(svc, buf.id), "abCDEfghij");
  });
});

describe("no local model (ADR-0003)", () => {
  it("AI preview fails with guidance while Buffer and FindBar still work", () => {
    const svc = new IntentService({ modelAvailable: false });
    const buf = svc.createBuffer("alpha beta alpha");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "error");
    if (preview.kind !== "error") return;
    assert.equal(preview.reason, "model_unavailable");
    assert.ok(preview.guidance.length > 0);
    assert.match(preview.guidance, /model|install|local/i);

    // Editor path still works.
    const edited = svc.editBuffer(buf.id, "alpha beta alpha!");
    assert.equal(bufferBody(svc, edited.id), "alpha beta alpha!");

    // FindBar (non-AI) still works.
    const bar = new FindBar(svc);
    const hits = bar.find({ bufferId: buf.id, pattern: "alpha" });
    assert.equal(hits.count, 2);
  });
});

describe("Outbound noticeability", () => {
  it("surfaces Outbound chunks when preview would leave the machine", () => {
    const svc = new IntentService({
      modelAvailable: true,
      cloudEnabled: true,
    });
    const buf = svc.createBuffer("secret payload");
    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      selection: { start: 0, end: 14 },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;

    assert.equal(preview.cost.hasOutbound, true);
    assert.ok(preview.outbound);
    assert.ok(preview.outbound!.length >= 1);
    const chunk = preview.outbound![0]!;
    assert.equal(chunk.text, "secret payload");
    assert.equal(chunk.destination, "cloud");
    assert.ok(chunk.task.length > 0);
  });
});
