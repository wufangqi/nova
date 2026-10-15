/**
 * WUF-98 contract: IPC slice / line window / len / rev;
 * default Buffer snapshots omit full text; open→slice→Accept without full snapshot.
 * Seam under test: IntentIpcHost. Tauri remains a thin forwarder (no second Buffer body).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import type { Patch } from "../src/types.js";

const tempRoot = mkdtempSync(join(tmpdir(), "nova-ipc-slice-"));

after(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

function aiPatch(
  bufferId: string,
  baseRevision: number,
  edits: Patch["edits"],
): Patch {
  return {
    bufferId,
    baseRevision,
    edits,
    provenance: { source: "ai", label: "ipc-slice" },
    intentId: "intent-ipc-slice-1",
  };
}

describe("IPC get_buffer omits full text by default", () => {
  it("returns meta + rev without text unless includeText is set", async () => {
    const host = new IntentIpcHost();
    const created = await host.handle({
      method: "create_buffer",
      params: { text: "hello world" },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.result.text, undefined);
    assert.equal(created.result.revision, 0);

    const got = await host.handle({
      method: "get_buffer",
      params: { id: created.result.id },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.result.text, undefined);
    assert.equal(got.result.revision, 0);
    assert.equal(got.result.encoding, "utf-8");

    const full = await host.handle({
      method: "get_buffer",
      params: { id: created.result.id, includeText: true },
    });
    assert.equal(full.ok, true);
    if (!full.ok) return;
    assert.equal(full.result.text, "hello world");
  });
});

describe("IPC slice / line_window / buffer_len / buffer_rev", () => {
  it("exposes core-equivalent windows without pulling full text via get_buffer", async () => {
    const host = new IntentIpcHost();
    const lines = Array.from({ length: 40 }, (_, i) => `line-${i}-payload`);
    const body = `${lines.join("\n")}\n`;
    const created = await host.handle({
      method: "create_buffer",
      params: { text: body },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.result.id;

    const lenRes = await host.handle({
      method: "buffer_len",
      params: { id },
    });
    assert.equal(lenRes.ok, true);
    if (!lenRes.ok) return;
    assert.equal(lenRes.result.len, body.length);

    const revRes = await host.handle({
      method: "buffer_rev",
      params: { id },
    });
    assert.equal(revRes.ok, true);
    if (!revRes.ok) return;
    assert.equal(revRes.result.rev, 0);

    const sliceRes = await host.handle({
      method: "slice",
      params: { id, start: 10, end: 25 },
    });
    assert.equal(sliceRes.ok, true);
    if (!sliceRes.ok) return;
    assert.equal(sliceRes.result.text, body.slice(10, 25));
    assert.ok(sliceRes.result.text.length < body.length);

    const winRes = await host.handle({
      method: "line_window",
      params: { id, lineStart: 5, lineCount: 3 },
    });
    assert.equal(winRes.ok, true);
    if (!winRes.ok) return;
    assert.equal(
      winRes.result.startOffset,
      body.split("\n").slice(0, 5).join("\n").length + 1,
    );
    assert.equal(
      winRes.result.text,
      "line-5-payload\nline-6-payload\nline-7-payload\n",
    );

    const got = await host.handle({
      method: "get_buffer",
      params: { id },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.result.text, undefined);
  });
});

describe("IPC open → slice → Accept without full-text snapshot", () => {
  it("Accepts a Patch using only slice + rev from IPC", async () => {
    const host = new IntentIpcHost();
    const path = join(tempRoot, "open-slice-accept.txt");
    writeFileSync(path, "hello world\n", "utf8");

    const opened = await host.handle({
      method: "open_path",
      params: { path },
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    // Shell open still returns a buffer snapshot; Accept path must not require its text.
    const id = opened.result.buffer.id;

    const revRes = await host.handle({
      method: "buffer_rev",
      params: { id },
    });
    assert.equal(revRes.ok, true);
    if (!revRes.ok) return;

    const before = await host.handle({
      method: "slice",
      params: { id, start: 6, end: 11 },
    });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.result.text, "world");

    const accept = await host.handle({
      method: "accept",
      params: {
        patches: [
          aiPatch(id, revRes.result.rev, [
            {
              start: 6,
              end: 11,
              replacement: "nova",
              before: " ",
              after: "\n",
            },
          ]),
        ],
      },
    });
    assert.equal(accept.ok, true);
    if (!accept.ok) return;
    assert.equal(accept.result.accept.ok, true);
    assert.equal(accept.result.buffers[0]!.text, undefined);
    assert.equal(accept.result.buffers[0]!.revision, 1);

    const after = await host.handle({
      method: "slice",
      params: { id, start: 0, end: 11 },
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.result.text, "hello nova\n");

    const got = await host.handle({
      method: "get_buffer",
      params: { id },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.result.text, undefined);
    assert.equal(got.result.revision, 1);
  });
});
