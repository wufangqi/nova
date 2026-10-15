/**
 * WUF-101 contract: span edit + line count + windowed sync without full-text snapshots.
 * Seam under test: IntentIpcHost (edit_active span / buffer_line_count / line_window).
 * Desktop virtual scroll consumes these; proposal writes still Accept-only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import { minimalReplace } from "../desktop/src/virtual-editor.ts";

describe("minimalReplace (virtual editor)", () => {
  it("computes a minimal span for in-window typing", () => {
    assert.deepEqual(minimalReplace("hello world", "hello nova"), {
      start: 6,
      end: 11,
      replacement: "nova",
    });
    assert.deepEqual(minimalReplace("abc", "abc"), {
      start: 0,
      end: 0,
      replacement: "",
    });
  });
});

describe("IPC buffer_line_count", () => {
  it("reports ropey line count without requiring full-text snapshot", async () => {
    const host = new IntentIpcHost();
    const body = "a\nb\nc\n";
    const created = await host.handle({
      method: "create_buffer",
      params: { text: body },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const lines = await host.handle({
      method: "buffer_line_count",
      params: { id: created.result.id },
    });
    assert.equal(lines.ok, true);
    if (!lines.ok) return;
    // Trailing newline → empty final line in ropey.
    assert.equal(lines.result.lineCount, 4);
    assert.equal(created.result.text, undefined);
  });
});

describe("IPC edit_active span replace", () => {
  it("replaces a range without shipping full text back", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const id = evoked.result.buffer.id;

    await host.handle({
      method: "edit_active",
      params: { text: "hello world\nsecond line\n" },
    });

    const spanned = await host.handle({
      method: "edit_active",
      params: { start: 6, end: 11, replacement: "nova" },
    });
    assert.equal(spanned.ok, true);
    if (!spanned.ok) return;
    assert.equal(spanned.result.buffer.text, undefined);
    assert.equal(spanned.result.buffer.id, id);
    assert.ok(spanned.result.buffer.revision >= 1);
    assert.equal(spanned.result.tabs[0]!.dirty, true);

    const slice = await host.handle({
      method: "slice",
      params: { id, start: 0, end: 20 },
    });
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.equal(slice.result.text, "hello nova\nsecond li");

    const win = await host.handle({
      method: "line_window",
      params: { id, lineStart: 0, lineCount: 2 },
    });
    assert.equal(win.ok, true);
    if (!win.ok) return;
    assert.equal(win.result.text, "hello nova\nsecond line\n");
    assert.equal(win.result.startOffset, 0);
  });

  it("keeps neighboring windows intact after a middle-line span edit", async () => {
    const host = new IntentIpcHost();
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i}`);
    const body = `${lines.join("\n")}\n`;
    const created = await host.handle({
      method: "create_buffer",
      params: { text: body },
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const id = created.result.id;

    // Activate via shell so edit_active has an active Buffer.
    const host2 = new IntentIpcHost();
    const opened = await host2.handle({ method: "evoke", params: {} });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    await host2.handle({
      method: "edit_active",
      params: { text: body },
    });
    const activeId = opened.result.buffer.id;

    // Offset of line-10: sum of "line-N\n" for N=0..9
    let offset = 0;
    for (let i = 0; i < 10; i++) offset += `line-${i}\n`.length;
    const end = offset + "line-10".length;

    const edited = await host2.handle({
      method: "edit_active",
      params: { start: offset, end, replacement: "LINE-TEN" },
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.result.buffer.text, undefined);

    const mid = await host2.handle({
      method: "line_window",
      params: { id: activeId, lineStart: 10, lineCount: 1 },
    });
    assert.equal(mid.ok, true);
    if (!mid.ok) return;
    assert.equal(mid.result.text, "LINE-TEN\n");

    const before = await host2.handle({
      method: "line_window",
      params: { id: activeId, lineStart: 9, lineCount: 1 },
    });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.result.text, "line-9\n");

    const after = await host2.handle({
      method: "line_window",
      params: { id: activeId, lineStart: 11, lineCount: 1 },
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.result.text, "line-11\n");

    // Unused create_buffer id must not be required for the shell path.
    void id;
  });
});

describe("IPC Find hit reveal recipe (no full text)", () => {
  it("maps a Find hit to a line_window that contains the match", async () => {
    const host = new IntentIpcHost();
    await host.handle({ method: "evoke", params: {} });
    await host.handle({
      method: "edit_active",
      params: {
        text: "alpha\nbeta needle gamma\ndelta\n",
      },
    });
    const state = await host.handle({ method: "get_shell_state", params: {} });
    assert.equal(state.ok, true);
    if (!state.ok || !state.result.buffer) return;
    const id = state.result.buffer.id;
    assert.equal(state.result.buffer.text, undefined);

    const found = await host.handle({
      method: "find",
      params: { pattern: "needle" },
    });
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.result.count, 1);
    const hit = found.result.hits[0]!;
    assert.equal(hit.line, 1);
    assert.equal(typeof hit.start, "number");
    assert.equal(typeof hit.end, "number");

    const win = await host.handle({
      method: "line_window",
      params: { id, lineStart: hit.line, lineCount: 1 },
    });
    assert.equal(win.ok, true);
    if (!win.ok) return;
    assert.match(win.result.text, /needle/);
    assert.ok(hit.start >= win.result.startOffset);
    assert.ok(hit.end <= win.result.startOffset + win.result.text.length);
  });
});
