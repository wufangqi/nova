/**
 * WUF-85/99 contract: FindBar UI + RegexDraft fill via IPC thin facade.
 * Seam: IntentIpcHost FindBar methods (find / preview_replace / replace_accept / apply_draft).
 * Writes only through IntentService.accept — RegexDraft never mutates Buffer.
 * Default IPC Buffer snapshots omit full text — verify via slice.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";

async function sliceAll(
  host: IntentIpcHost,
  id: string,
): Promise<string> {
  const len = await host.handle({ method: "buffer_len", params: { id } });
  assert.equal(len.ok, true);
  if (!len.ok) return "";
  const n = len.result.len;
  if (n === 0) return "";
  const sliced = await host.handle({
    method: "slice",
    params: { id, start: 0, end: n },
  });
  assert.equal(sliced.ok, true);
  if (!sliced.ok) return "";
  return sliced.result.text;
}

describe("IPC FindBar find hits", () => {
  it("finds PCRE matches on the active Buffer and returns hit feedback", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "alpha beta alpha gamma" },
    });

    const found = await host.handle({
      method: "find",
      params: { pattern: "alpha" },
    });
    assert.equal(found.ok, true);
    if (!found.ok) return;

    assert.equal(found.result.count, 2);
    assert.equal(found.result.hits.length, 2);
    assert.equal(found.result.hits[0]!.match, "alpha");
    assert.equal(found.result.hits[0]!.start, 0);
    assert.equal(found.result.hits[1]!.start, 11);
    assert.equal(found.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "alpha beta alpha gamma");
  });
});

describe("IPC FindBar replace Accept + UndoGroup", () => {
  it("replace_accept writes via Accept and undoes as one UndoGroup", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const previewed = await host.handle({
      method: "preview_replace",
      params: { pattern: "cat", replacement: "owl" },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.ok, true);
    if (!previewed.result.preview.ok) return;
    assert.equal(previewed.result.preview.patches[0]!.provenance.source, "findbar");
    assert.equal(previewed.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "cat dog cat");

    const replaced = await host.handle({
      method: "replace_accept",
      params: { pattern: "cat", replacement: "owl" },
    });
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.equal(replaced.result.accept.ok, true);
    if (!replaced.result.accept.ok) return;
    assert.equal(replaced.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "owl dog owl");

    const undone = await host.handle({
      method: "undo",
      params: { undoGroupId: replaced.result.accept.undoGroupId },
    });
    assert.equal(undone.ok, true);
    if (!undone.ok) return;
    assert.equal(undone.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "cat dog cat");
  });
});

describe("IPC RegexDraft fills FindBar without Buffer write", () => {
  it("preview_intent regex_draft + apply_draft fills FindBar and leaves Buffer intact", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "a1 b2 a3" },
    });

    const previewed = await host.handle({
      method: "preview_intent",
      params: { utterance: "regex a(\\d)" },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "regex_draft");
    if (previewed.result.preview.kind !== "regex_draft") return;
    assert.equal(previewed.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");

    const applied = await host.handle({
      method: "apply_draft",
      params: { draft: previewed.result.preview.draft },
    });
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    assert.equal(applied.result.draft.pattern, "a(\\d)");
    assert.equal(applied.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");
    assert.equal(applied.result.buffer.revision, previewed.result.buffer.revision);

    const found = await host.handle({
      method: "find",
      params: {},
    });
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.result.count, 2);
    assert.equal(found.result.hits[0]!.match, "a1");
    assert.equal(found.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");
  });
});

describe("IPC explicit replace only Accepts", () => {
  it("RegexDraft fill alone does not Accept; only replace_accept writes", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "red fox red hen" },
    });

    const previewed = await host.handle({
      method: "preview_intent",
      params: { utterance: "regex red" },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "regex_draft");
    if (previewed.result.preview.kind !== "regex_draft") return;

    await host.handle({
      method: "apply_draft",
      params: {
        draft: {
          ...previewed.result.preview.draft,
          replacement: "blue",
        },
      },
    });

    assert.equal(await sliceAll(host, bufferId), "red fox red hen");

    const replaced = await host.handle({
      method: "replace_accept",
      params: {},
    });
    assert.equal(replaced.ok, true);
    if (!replaced.ok) return;
    assert.equal(replaced.result.accept.ok, true);
    assert.equal(replaced.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "blue fox blue hen");
  });
});
