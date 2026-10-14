/**
 * WUF-72 contract: FindBar PCRE find + replace-over-Scope → Accept.
 * Seam: FindBar produces hits / Patches; writes only via IntentService.accept.
 * No chat / Intent parse-preview required.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FindBar } from "../src/find-bar.js";
import { IntentService } from "../src/intent-service.js";

describe("FindBar PCRE find (hit feedback)", () => {
  it("returns ordered hits with count for a PCRE pattern", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("alpha beta alpha gamma");
    const bar = new FindBar(intent);

    const result = bar.find({
      bufferId: buf.id,
      pattern: "alpha",
    });

    assert.equal(result.count, 2);
    assert.equal(result.hits.length, 2);
    assert.deepEqual(result.hits[0], {
      start: 0,
      end: 5,
      match: "alpha",
      groups: {},
    });
    assert.deepEqual(result.hits[1], {
      start: 11,
      end: 16,
      match: "alpha",
      groups: {},
    });
  });

  it("supports PCRE features JS shares (lookahead / groups) with hit feedback", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("x12 y34 x56");
    const bar = new FindBar(intent);

    const result = bar.find({
      bufferId: buf.id,
      pattern: "x(\\d+)(?=\\s|$)",
    });

    assert.equal(result.count, 2);
    assert.equal(result.hits[0]!.match, "x12");
    assert.equal(result.hits[0]!.groups[1], "12");
    assert.equal(result.hits[1]!.match, "x56");
  });

  it("limits find to Scope range (not whole Buffer)", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("one two one two one");
    const bar = new FindBar(intent);

    const result = bar.find({
      bufferId: buf.id,
      pattern: "one",
      scope: { kind: "range", start: 4, end: 15 },
    });

    assert.equal(result.count, 1);
    assert.equal(result.hits[0]!.start, 8);
    assert.equal(result.hits[0]!.match, "one");
  });
});

describe("replace over Scope → Patch → Accept", () => {
  it("replace produces Patch and Accept writes via IntentService (no Intent)", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("red fox red hen");
    const bar = new FindBar(intent);

    const preview = bar.previewReplace({
      bufferId: buf.id,
      pattern: "red",
      replacement: "blue",
    });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(preview.patches.length, 1);
    assert.equal(preview.patches[0]!.provenance.source, "findbar");
    // Buffer unchanged until Accept.
    assert.equal(intent.getBuffer(buf.id).text, "red fox red hen");

    const accepted = intent.accept(preview.patches);
    assert.equal(accepted.ok, true);
    assert.equal(intent.getBuffer(buf.id).text, "blue fox blue hen");
  });

  it("replaceAccept is a single call that Accepts FindBar Patches", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("a1 a2 a3");
    const bar = new FindBar(intent);

    const result = bar.replaceAccept({
      bufferId: buf.id,
      pattern: "a(\\d)",
      replacement: "b$1",
      scope: { kind: "range", start: 0, end: 5 },
    });

    assert.equal(result.ok, true);
    // Only "a1 a2" is in Scope; trailing " a3" untouched.
    assert.equal(intent.getBuffer(buf.id).text, "b1 b2 a3");
  });
});

describe("UndoGroup after FindBar Accept", () => {
  it("one Accept undoes the whole replace batch", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("cat dog cat");
    const bar = new FindBar(intent);

    const result = bar.replaceAccept({
      bufferId: buf.id,
      pattern: "cat",
      replacement: "owl",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(intent.getBuffer(buf.id).text, "owl dog owl");

    intent.undo(result.undoGroupId);
    assert.equal(intent.getBuffer(buf.id).text, "cat dog cat");
  });
});

describe("FindBar works without chat / Intent", () => {
  it("find and replace never call parse/preview (deterministic surface only)", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("hello world");
    const bar = new FindBar(intent);

    const hits = bar.find({ bufferId: buf.id, pattern: "world" });
    assert.equal(hits.count, 1);

    const result = bar.replaceAccept({
      bufferId: buf.id,
      pattern: "world",
      replacement: "nova",
    });
    assert.equal(result.ok, true);
    assert.equal(intent.getBuffer(buf.id).text, "hello nova");

    // IntentService has no parse/preview yet — FindBar must not require them.
    assert.equal(
      typeof (intent as { parse?: unknown }).parse,
      "undefined",
    );
  });
});
