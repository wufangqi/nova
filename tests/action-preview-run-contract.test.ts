/**
 * WUF-91 contract: Action preview_run on Selection → Patch → Accept/reject.
 * Seam: ActionService.previewRun + IntentService.accept / reject only.
 * Never Outbound / model; PCRE surface shared with FindBar.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  ActionService,
  MemoryActionStore,
} from "../src/action-service.js";
import { IntentService } from "../src/intent-service.js";
import type { RegexDraft, SavedAction } from "../src/types.js";
import { bufferBody } from './helpers/buffer-text.js';

function seedAction(
  store: MemoryActionStore,
  draft: RegexDraft,
  displayName = "seeded-action",
): SavedAction {
  const action: SavedAction = {
    id: randomUUID(),
    displayName,
    draft: {
      pattern: draft.pattern,
      replacement: draft.replacement,
      flags: draft.flags,
    },
    createdAt: new Date().toISOString(),
  };
  store.saveAll([action]);
  return action;
}

describe("preview_run on non-empty Selection → Patch (no Outbound)", () => {
  it("produces Patch preview scoped to Selection without Outbound or Buffer write", () => {
    const intent = new IntentService({
      modelAvailable: true,
      cloudEnabled: true,
    });
    const store = new MemoryActionStore();
    const saved = seedAction(
      store,
      { pattern: "red", replacement: "blue", flags: "g" },
      "paint red→blue",
    );
    const actions = new ActionService(intent, store);
    const buf = intent.createBuffer("red fox red hen");

    // Selection covers only the first "red fox " — second "red" stays out.
    const run = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: 8 },
    });

    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.patches.length, 1);
    assert.equal(run.patches[0]!.edits.length, 1);
    assert.equal(run.patches[0]!.edits[0]!.replacement, "blue");
    assert.equal(run.cost.hasOutbound, false);
    assert.equal(run.outbound, undefined);
    // Buffer unchanged until Accept.
    assert.equal(bufferBody(intent, buf.id), "red fox red hen");

    // Deterministic — must not call Intent parse/preview (no model).
    intent.parse = () => {
      throw new Error("preview_run must not call parse");
    };
    intent.preview = () => {
      throw new Error("preview_run must not call preview");
    };
    const again = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: 8 },
    });
    assert.equal(again.ok, true);
  });
});

describe("empty Selection fails clearly", () => {
  it("refuses empty Selection and does not silently act on whole Buffer", () => {
    const intent = new IntentService({ modelAvailable: true });
    const store = new MemoryActionStore();
    const saved = seedAction(store, {
      pattern: "red",
      replacement: "blue",
      flags: "g",
    });
    const actions = new ActionService(intent, store);
    const buf = intent.createBuffer("red fox red hen");

    const run = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 4, end: 4 },
    });

    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.reason, "empty_selection");
    assert.match(run.guidance, /selection|选区|空/i);
    assert.equal(bufferBody(intent, buf.id), "red fox red hen");
    assert.equal(intent.getMainHistory(buf.id).length, 0);
  });
});

describe("zero matches and find-only (no replacement)", () => {
  it("zero matches fail without an Acceptable Patch path", () => {
    const intent = new IntentService({ modelAvailable: true });
    const store = new MemoryActionStore();
    const saved = seedAction(store, {
      pattern: "zzz",
      replacement: "y",
      flags: "g",
    });
    const actions = new ActionService(intent, store);
    const buf = intent.createBuffer("alpha beta");

    const run = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: bufferBody(intent, buf.id).length },
    });

    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.reason, "zero_matches");
    assert.match(run.guidance, /match|匹配|zero|零/i);
  });

  it("Action without replacement refuses text Accept (find-only)", () => {
    const intent = new IntentService({ modelAvailable: true });
    const store = new MemoryActionStore();
    // Find-only: pattern present, replacement omitted.
    const saved = seedAction(store, { pattern: "alpha", flags: "g" });
    const actions = new ActionService(intent, store);
    const buf = intent.createBuffer("alpha beta alpha");

    const run = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: bufferBody(intent, buf.id).length },
    });

    assert.equal(run.ok, false);
    if (run.ok) return;
    assert.equal(run.reason, "no_replacement");
    assert.equal(bufferBody(intent, buf.id), "alpha beta alpha");
  });
});

describe("Accept / reject via existing write seam", () => {
  it("Accept writes as one UndoGroup with Provenance source=action; reject leaves Buffer alone", () => {
    const intent = new IntentService({ modelAvailable: true });
    const store = new MemoryActionStore();
    const saved = seedAction(
      store,
      { pattern: "cat", replacement: "owl", flags: "g" },
      "cats→owls",
    );
    const actions = new ActionService(intent, store);
    const buf = intent.createBuffer("cat dog cat");

    const run = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: bufferBody(intent, buf.id).length },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.patches[0]!.provenance.source, "action");
    assert.match(run.patches[0]!.provenance.label ?? "", /cats→owls|action/i);

    const accepted = intent.accept(run.patches);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(bufferBody(intent, buf.id), "owl dog owl");

    const audit = intent.getProvenanceAudit(buf.id);
    assert.ok(audit.length >= 1);
    assert.equal(audit[0]!.originalProvenance.source, "action");
    assert.equal(intent.getMainHistory(buf.id)[0]!.committedBy, "user");

    intent.undo(accepted.undoGroupId);
    assert.equal(bufferBody(intent, buf.id), "cat dog cat");

    // Reject path: preview again, reject by previewId — no write.
    const again = actions.previewRun({
      actionId: saved.id,
      bufferId: buf.id,
      selection: { start: 0, end: bufferBody(intent, buf.id).length },
    });
    assert.equal(again.ok, true);
    if (!again.ok) return;
    intent.reject(again.previewId);
    assert.equal(bufferBody(intent, buf.id), "cat dog cat");
    assert.equal(intent.getOutstandingPreview(again.previewId), undefined);
  });
});
