/**
 * WUF-75 contract: real/local model transform — NL → Patch via IntentService.
 * Seam: IntentService only. Local model gateway is offline (no network).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentService } from "../src/intent-service.js";
import { LocalModelGateway } from "../src/model-gateway.js";
import type { ModelGateway, ModelTransformRequest } from "../src/model-gateway.js";
import { bufferBody } from './helpers/buffer-text.js';

describe("transform Intent via local model → Patch preview", () => {
  it("returns Patch preview from a local model for a transform utterance", () => {
    const svc = new IntentService({
      modelAvailable: true,
      modelGateway: new LocalModelGateway(),
    });
    const buf = svc.createBuffer("hello world");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase the selection",
      selection: { start: 0, end: 5 },
    });
    const preview = svc.preview(intent);

    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    assert.ok(preview.cost);
    assert.ok(preview.patches.length >= 1);
    assert.equal(preview.patches[0]!.provenance.source, "ai");
    assert.match(preview.patches[0]!.provenance.label ?? "", /local|model/i);
  });
});

describe("same IntentService Accept/reject", () => {
  it("Accept writes Buffer; reject leaves Buffer unchanged", () => {
    const svc = new IntentService({
      modelAvailable: true,
      modelGateway: new LocalModelGateway(),
    });
    const buf = svc.createBuffer("hello world");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "make it uppercase",
      selection: { start: 0, end: 5 },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;

    const accepted = svc.accept(preview.patches);
    assert.equal(accepted.ok, true);
    assert.equal(bufferBody(svc, buf.id), "HELLO world");

    if (accepted.ok) {
      svc.undo(accepted.undoGroupId);
      assert.equal(bufferBody(svc, buf.id), "hello world");
    }

    const intent2 = svc.parse({
      bufferId: buf.id,
      utterance: "make it uppercase",
      selection: { start: 0, end: 5 },
    });
    const preview2 = svc.preview(intent2);
    assert.equal(preview2.kind, "patches");
    if (preview2.kind !== "patches") return;
    svc.reject(preview2.previewId);
    assert.equal(bufferBody(svc, buf.id), "hello world");
    assert.equal(svc.getBuffer(buf.id).revision, buf.revision);
  });
});

describe("deterministic validator", () => {
  it("rejects invalid model output: no Acceptable Patch; manual edit still works", () => {
    const badGateway: ModelGateway = {
      id: "bad-fixture",
      offline: true,
      transform(_req: ModelTransformRequest) {
        return { raw: "not-a-valid-patch-payload" };
      },
    };
    const svc = new IntentService({
      modelAvailable: true,
      modelGateway: badGateway,
    });
    const buf = svc.createBuffer("keep editing me");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      selection: { start: 0, end: 4 },
    });
    const preview = svc.preview(intent);

    assert.equal(preview.kind, "error");
    if (preview.kind !== "error") return;
    assert.equal(preview.reason, "validation_failed");
    assert.ok(preview.guidance.length > 0);
    assert.match(preview.guidance, /manual|edit|re-?run|手/i);
    assert.equal(preview.manualEditOk, true);

    // No Acceptable Patch was produced — caller cannot Accept this preview.
    // Manual edit exit: Buffer editing still works.
    const edited = svc.editBuffer(buf.id, "I edited this myself");
    assert.equal(bufferBody(svc, edited.id), "I edited this myself");
  });

  it("rejects out-of-scope edits from the model", () => {
    const sneaky: ModelGateway = {
      id: "sneaky",
      offline: true,
      transform(req) {
        // Claims to edit beyond Scope end.
        return {
          raw: JSON.stringify({
            edits: [
              {
                start: req.scope.start,
                end: req.scope.end + 10,
                replacement: "X",
              },
            ],
          }),
        };
      },
    };
    const svc = new IntentService({
      modelAvailable: true,
      modelGateway: sneaky,
    });
    const buf = svc.createBuffer("abcdefghij");
    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "transform",
      selection: { start: 2, end: 5 },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "error");
    if (preview.kind !== "error") return;
    assert.equal(preview.reason, "validation_failed");
    assert.equal(preview.manualEditOk, true);
    assert.equal(bufferBody(svc, buf.id), "abcdefghij");
  });
});

describe("offline local model (eval machine)", () => {
  it("completes NL → Patch → Accept with no network", () => {
    const gateway = new LocalModelGateway();
    assert.equal(gateway.offline, true);

    const svc = new IntentService({
      modelAvailable: true,
      modelGateway: gateway,
      cloudEnabled: false,
    });
    const buf = svc.createBuffer("demo text");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "uppercase",
      selection: { start: 0, end: 4 },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;
    assert.equal(preview.cost.hasOutbound, false);
    assert.equal(preview.outbound, undefined);

    const result = svc.accept(preview.patches);
    assert.equal(result.ok, true);
    assert.equal(bufferBody(svc, buf.id), "DEMO text");
  });
});
