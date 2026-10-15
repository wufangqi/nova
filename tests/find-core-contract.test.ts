/**
 * WUF-100 contract: Find runs in Rust buffer-core (`regex`), cancellable;
 * cancel ≠ zero matches; hits carry offsets + line; replace still Accept.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createBuffer,
  findCancel,
  findPoll,
  findStart,
} from "../src/buffer-core.js";
import { FindBar } from "../src/find-bar.js";
import { IntentService } from "../src/intent-service.js";

function pollUntilTerminal(jobId: string, maxIters = 10_000) {
  for (let i = 0; i < maxIters; i++) {
    const p = findPoll(jobId);
    if (p.status !== "running") return p;
  }
  throw new Error(`find job ${jobId} still running after ${maxIters} polls`);
}

describe("buffer-core Find (Rust regex)", () => {
  it("returns ordered hits with char offsets and 0-based line", () => {
    const id = createBuffer("alpha\nbeta alpha\ngamma");
    const jobId = findStart(id, { pattern: "alpha" });
    const progress = pollUntilTerminal(jobId);

    assert.equal(progress.status, "done");
    assert.equal(progress.count, 2);
    assert.equal(progress.hits.length, 2);
    assert.equal(progress.hits[0]!.start, 0);
    assert.equal(progress.hits[0]!.end, 5);
    assert.equal(progress.hits[0]!.matchText, "alpha");
    assert.equal(progress.hits[0]!.line, 0);
    assert.equal(progress.hits[0]!.column, 0);
    assert.equal(progress.hits[1]!.start, 11);
    assert.equal(progress.hits[1]!.line, 1);
    assert.equal(progress.hits[1]!.column, 5);
  });

  it("distinguishes cancelled from zero matches", () => {
    // Poll-driven jobs: cancel before first poll → cancelled (not done/0).
    const id = createBuffer("alpha beta gamma");
    const jobId = findStart(id, { pattern: "alpha" });
    findCancel(jobId);
    const progress = findPoll(jobId);
    assert.equal(progress.status, "cancelled");

    const emptyId = createBuffer("nope nope");
    const emptyJob = findStart(emptyId, { pattern: "needle" });
    const emptyProgress = pollUntilTerminal(emptyJob);
    assert.equal(emptyProgress.status, "done");
    assert.equal(emptyProgress.count, 0);
    assert.equal(emptyProgress.hits.length, 0);
  });

  it("rejects lookaround as unsupported (PCRE debt; single Rust engine)", () => {
    const id = createBuffer("x12 y34");
    const jobId = findStart(id, { pattern: "x(\\d+)(?=\\s|$)" });
    const progress = pollUntilTerminal(jobId);
    assert.equal(progress.status, "error");
    assert.ok(progress.error && progress.error.length > 0);
  });
});

describe("FindBar → core Find; replace still Accept", () => {
  it("FindBar.find uses core hits (offsets + line) without JS RegExp scan", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("one\ntwo one");
    const bar = new FindBar(intent);

    const result = bar.find({ bufferId: buf.id, pattern: "one" });
    assert.equal(result.count, 2);
    assert.equal(result.hits[0]!.line, 0);
    assert.equal(result.hits[1]!.line, 1);
    assert.equal(result.hits[1]!.start, 8);
  });

  it("replace preview → Accept seam unchanged (UndoGroup)", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("cat dog cat");
    const bar = new FindBar(intent);

    const preview = bar.previewReplace({
      bufferId: buf.id,
      pattern: "cat",
      replacement: "owl",
    });
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.equal(intent.getBuffer(buf.id).text, "cat dog cat");

    const accepted = intent.accept(preview.patches);
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(intent.getBuffer(buf.id).text, "owl dog owl");

    intent.undo(accepted.undoGroupId);
    assert.equal(intent.getBuffer(buf.id).text, "cat dog cat");
  });

  it("capture-group replace still goes through Accept", () => {
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
    assert.equal(intent.getBuffer(buf.id).text, "b1 b2 a3");
  });
});
