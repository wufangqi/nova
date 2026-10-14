/**
 * WUF-84 contract: Intent bar → preview → Patch diff / Cost / Outbound → Accept|reject|Undo.
 * Seam: IntentIpcHost Intent methods (thin facade over IntentService).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import { formatPatchDiff } from "../src/ipc/patch-diff.js";

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
    assert.equal(previewed.result.buffer.text, "hello world");
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

    const diff = formatPatchDiff(previewed.result.buffer.text, patches);
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

    const afterReject = await host.handle({
      method: "get_buffer",
      params: { id: evoked.result.buffer.id },
    });
    assert.equal(afterReject.ok, true);
    if (!afterReject.ok) return;
    assert.equal(afterReject.result.text, "hello world");

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
    assert.equal(accepted.result.buffers[0]!.text, "HELLO world");

    const undone = await host.handle({
      method: "undo",
      params: { undoGroupId: accepted.result.accept.undoGroupId },
    });
    assert.equal(undone.ok, true);
    if (!undone.ok) return;
    assert.equal(undone.result.buffer.text, "hello world");
  });
});
