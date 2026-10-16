/**
 * WUF-81 contract: Tauri IPC facade thinly wraps IntentService.
 * Seam under test: IntentIpcHost (create_buffer / get_buffer / accept).
 * No alternate write path — Accept goes through IntentService.accept only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import type { Patch } from "../src/types.js";
import { bufferBody } from './helpers/buffer-text.js';

function aiPatch(
  bufferId: string,
  baseRevision: number,
  edits: Patch["edits"],
): Patch {
  return {
    bufferId,
    baseRevision,
    edits,
    provenance: { source: "ai", label: "ipc-handcraft" },
    intentId: "intent-ipc-1",
  };
}

describe("IPC create_buffer", () => {
  it("creates a Buffer snapshot via IntentService", async () => {
    const host = new IntentIpcHost();
    const res = await host.handle({
      method: "create_buffer",
      params: { text: "hello" },
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    // Default IPC snapshot omits full text (WUF-98).
    assert.equal(res.result.text, undefined);
    assert.equal(res.result.revision, 0);
    assert.equal(typeof res.result.id, "string");

    const slice = await host.handle({
      method: "slice",
      params: { id: res.result.id, start: 0, end: 5 },
    });
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.equal(slice.result.text, "hello");
  });
});

describe("IPC accept hand-crafted Patch", () => {
  it("Accepts through IntentService; verify text via slice not full snapshot", async () => {
    const host = new IntentIpcHost();
    const created = await host.handle({
      method: "create_buffer",
      params: { text: "hello world" },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const accept = await host.handle({
      method: "accept",
      params: {
        patches: [
          aiPatch(created.result.id, created.result.revision, [
            {
              start: 6,
              end: 11,
              replacement: "nova",
              before: " ",
              after: "",
            },
          ]),
        ],
      },
    });
    assert.equal(accept.ok, true);
    if (!accept.ok) return;
    assert.equal(accept.result.accept.ok, true);
    assert.equal(accept.result.buffers[0]!.text, undefined);

    const got = await host.handle({
      method: "get_buffer",
      params: { id: created.result.id },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.result.text, undefined);

    const slice = await host.handle({
      method: "slice",
      params: { id: created.result.id, start: 0, end: 10 },
    });
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.equal(slice.result.text, "hello nova");
  });

  it("does not open a write path outside IntentService.accept", async () => {
    const host = new IntentIpcHost();
    const created = await host.handle({
      method: "create_buffer",
      params: { text: "alpha beta" },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    // Drift revision so relocate fails — same contract as IntentService.
    host.service.editBuffer(created.result.id, "ALPHA beta");

    const accept = await host.handle({
      method: "accept",
      params: {
        patches: [
          aiPatch(created.result.id, 0, [
            {
              start: 6,
              end: 10,
              replacement: "BETA",
              before: "alpha ",
              after: "",
            },
          ]),
        ],
      },
    });
    assert.equal(accept.ok, true);
    if (!accept.ok) return;
    assert.equal(accept.result.accept.ok, false);
    if (accept.result.accept.ok) return;
    assert.equal(accept.result.accept.reason, "reloc_failed");
    assert.equal(bufferBody(host.service, created.result.id), "ALPHA beta");
  });
});
