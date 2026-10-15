/**
 * WUF-84/99 contract: Intent bar → preview → Patch diff / Cost / Outbound → Accept|reject|Undo.
 * Seam: IntentIpcHost Intent methods (thin facade over IntentService).
 * Default IPC Buffer snapshots omit full text — verify via slice.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import { formatPatchDiff } from "../src/ipc/patch-diff.js";

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

describe("IPC Intent preview", () => {
  it("parses an utterance on the active Buffer and returns a Patch preview", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    await host.handle({
      method: "edit_active",
      params: { text: "hello world" },
    });

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 5 },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;

    assert.equal(previewed.result.preview.kind, "patches");
    if (previewed.result.preview.kind !== "patches") return;
    assert.ok(previewed.result.preview.patches.length >= 1);
    assert.equal(previewed.result.intent.utterance, "uppercase");
    assert.equal(previewed.result.buffer.text, undefined);
    assert.equal(
      await sliceAll(host, previewed.result.buffer.id),
      "hello world",
    );
  });
});

describe("IPC Patch diff and Cost", () => {
  it("exposes Cost on preview and formats Patch edits as a readable diff", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    await host.handle({
      method: "edit_active",
      params: { text: "hello world" },
    });

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 5 },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "patches");
    if (previewed.result.preview.kind !== "patches") return;

    const { cost, patches } = previewed.result.preview;
    assert.equal(typeof cost.latencyMsEstimate, "number");
    assert.equal(typeof cost.tokensEstimate, "number");
    assert.equal(typeof cost.hasOutbound, "boolean");

    const body = await sliceAll(host, previewed.result.buffer.id);
    const diff = formatPatchDiff(body, patches);
    assert.match(diff, /^-hello/m);
    assert.match(diff, /^\+HELLO/m);
  });
});

describe("IPC Outbound noticeability", () => {
  it("surfaces Outbound when cloud path is enabled", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    await host.handle({
      method: "edit_active",
      params: { text: "secret payload" },
    });

    const toggled = await host.handle({
      method: "set_cloud_enabled",
      params: { enabled: true },
    });
    assert.equal(toggled.ok, true);
    if (!toggled.ok) return;
    assert.equal(toggled.result.cloudEnabled, true);

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 14 },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "patches");
    if (previewed.result.preview.kind !== "patches") return;

    assert.equal(previewed.result.preview.cost.hasOutbound, true);
    assert.ok(previewed.result.preview.outbound);
    assert.ok(previewed.result.preview.outbound!.length >= 1);
    assert.equal(previewed.result.preview.outbound![0]!.destination, "cloud");
    assert.equal(previewed.result.preview.outbound![0]!.text, "secret payload");
  });
});

describe("IPC Accept / reject / UndoGroup", () => {
  it("Accepts a preview batch and undoes via UndoGroup; reject leaves Buffer alone", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "hello world" },
    });

    const rejectedPreview = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 5 },
      },
    });
    assert.equal(rejectedPreview.ok, true);
    if (!rejectedPreview.ok) return;
    assert.equal(rejectedPreview.result.preview.kind, "patches");
    if (rejectedPreview.result.preview.kind !== "patches") return;

    const rejected = await host.handle({
      method: "reject_preview",
      params: { previewId: rejectedPreview.result.preview.previewId },
    });
    assert.equal(rejected.ok, true);

    assert.equal(await sliceAll(host, bufferId), "hello world");

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 5 },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "patches");
    if (previewed.result.preview.kind !== "patches") return;

    const accepted = await host.handle({
      method: "accept",
      params: { patches: previewed.result.preview.patches },
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.result.accept.ok, true);
    if (!accepted.result.accept.ok) return;
    assert.equal(accepted.result.buffers[0]!.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "HELLO world");

    const undone = await host.handle({
      method: "undo",
      params: { undoGroupId: accepted.result.accept.undoGroupId },
    });
    assert.equal(undone.ok, true);
    if (!undone.ok) return;
    assert.equal(undone.result.buffer.text, undefined);
    assert.equal(await sliceAll(host, bufferId), "hello world");
  });
});
