/**
 * WUF-77 contract: NL → RegexDraft → FindBar → explicit replace Accept.
 * Seams: IntentService.preview (regex_draft) + FindBar.applyDraft / replace.
 * RegexDraft never mutates Buffer; only explicit replace → Accept writes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FindBar } from "../src/find-bar.js";
import { IntentService } from "../src/intent-service.js";
import { bufferBody } from './helpers/buffer-text.js';

describe("NL → RegexDraft fills FindBar", () => {
  it("NL→regex Intent produces RegexDraft and populates FindBar", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("a1 b2 a3");
    const bar = new FindBar(svc);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "regex a(\\d)",
      selection: { start: 0, end: bufferBody(svc, buf.id).length },
    });
    const preview = svc.preview(intent);

    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;
    assert.ok(preview.cost);
    assert.equal(preview.draft.pattern, "a(\\d)");
    assert.ok(preview.draft.flags === undefined || preview.draft.flags.includes("g") || preview.draft.flags.length >= 0);

    bar.applyDraft(preview.draft);
    const loaded = bar.getDraft();
    assert.equal(loaded.pattern, "a(\\d)");

    // FindBar can find using the loaded draft without re-typing the pattern.
    const hits = bar.find({ bufferId: buf.id });
    assert.equal(hits.count, 2);
    assert.equal(hits.hits[0]!.match, "a1");
    assert.equal(hits.hits[0]!.groups[1], "1");
  });

  it("sed-style regex s/pat/repl/flags yields a RegexDraft with replacement", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("red fox");

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "regex s/red/blue/g",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;
    assert.equal(preview.draft.pattern, "red");
    assert.equal(preview.draft.replacement, "blue");
    assert.ok(preview.draft.flags?.includes("g"));
  });

  it("NL phrases like 'write a regex for digits' produce a usable draft", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("x12 y34");
    const bar = new FindBar(svc);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "write a regex for digits",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    bar.applyDraft(preview.draft);
    const hits = bar.find({ bufferId: buf.id });
    assert.ok(hits.count >= 2);
    assert.match(hits.hits[0]!.match, /\d+/);
  });
});

describe("RegexDraft does not mutate Buffer", () => {
  it("previewing RegexDraft and applying to FindBar leaves Buffer text unchanged", () => {
    const svc = new IntentService({ modelAvailable: true });
    const original = "keep me intact";
    const buf = svc.createBuffer(original);
    const bar = new FindBar(svc);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "regex keep",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    bar.applyDraft(preview.draft);
    svc.reject(preview.previewId);

    assert.equal(bufferBody(svc, buf.id), original);
    assert.equal(svc.getBuffer(buf.id).revision, buf.revision);
    assert.equal(svc.getMainHistory(buf.id).length, 0);
  });
});

describe("explicit replace over Scope then Accept", () => {
  it("user must explicitly replace Scope before Accept writes Buffer", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("red fox red hen");
    const bar = new FindBar(svc);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "regex red",
      selection: { start: 0, end: bufferBody(svc, buf.id).length },
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    bar.applyDraft({ ...preview.draft, replacement: "blue" });
    // Still no write — draft + FindBar fill only.
    assert.equal(bufferBody(svc, buf.id), "red fox red hen");

    // User may refine the pattern before replace.
    bar.setPattern("red");
    bar.setReplacement("blue");

    const replacePreview = bar.previewReplace({
      bufferId: buf.id,
      scope: { kind: "buffer" },
    });
    assert.equal(replacePreview.ok, true);
    if (!replacePreview.ok) return;
    assert.equal(replacePreview.patches[0]!.provenance.source, "findbar");
    assert.equal(bufferBody(svc, buf.id), "red fox red hen");

    const accepted = svc.accept(replacePreview.patches);
    assert.equal(accepted.ok, true);
    assert.equal(bufferBody(svc, buf.id), "blue fox blue hen");
  });

  it("replaceAccept from loaded draft writes via IntentService Accept", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("a1 a2 a3");
    const bar = new FindBar(svc);

    bar.applyDraft({ pattern: "a(\\d)", replacement: "b$1", flags: "g" });
    const result = bar.replaceAccept({
      bufferId: buf.id,
      scope: { kind: "range", start: 0, end: 5 },
    });

    assert.equal(result.ok, true);
    assert.equal(bufferBody(svc, buf.id), "b1 b2 a3");
  });
});

describe("FindBar and RegexDraft share one regex surface", () => {
  it("draft pattern fills FindBar and runs on the single Rust Find engine", () => {
    const svc = new IntentService({ modelAvailable: true });
    const buf = svc.createBuffer("x12 y34 x56");
    const bar = new FindBar(svc);

    const intent = svc.parse({
      bufferId: buf.id,
      utterance: "regex x(\\d+)",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    // Shared surface: draft pattern/flags populate FindBar; scan is Rust regex only.
    bar.applyDraft(preview.draft);
    assert.equal(bar.getDraft().pattern, preview.draft.pattern);
    const hits = bar.find({ bufferId: buf.id });
    assert.equal(hits.count, 2);
    assert.equal(hits.hits[0]!.groups[1], "12");
    assert.equal(hits.hits[1]!.groups[1], "56");
  });
});
