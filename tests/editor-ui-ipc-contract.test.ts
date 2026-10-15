/**
 * WUF-82 contract: desktop editor UI via IPC thin facade over EditorShell.
 * Seam: IntentIpcHost shell methods (tabs / edit / Path / close prompts).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";

describe("IPC multi-Buffer tabs", () => {
  it("evokes untitled Buffers and switches the active tab", async () => {
    const host = new IntentIpcHost();
    const first = await host.handle({ method: "evoke", params: {} });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.result.tabs.length, 1);
    assert.equal(first.result.tabs[0]!.untitled, true);

    const second = await host.handle({ method: "evoke", params: {} });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.result.tabs.length, 2);
    assert.equal(second.result.buffer.id, second.result.tabs.find((t) => t.active)!.bufferId);

    const switchTo = await host.handle({
      method: "activate_tab",
      params: { id: first.result.buffer.id },
    });
    assert.equal(switchTo.ok, true);
    if (!switchTo.ok) return;
    assert.equal(switchTo.result.buffer.id, first.result.buffer.id);
    assert.equal(
      switchTo.result.tabs.find((t) => t.active)!.bufferId,
      first.result.buffer.id,
    );
  });
});

describe("IPC logical text edit", () => {
  it("edits the active Buffer text through the shell", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const edited = await host.handle({
      method: "edit_active",
      params: { text: "hello nova" },
    });
    assert.equal(edited.ok, true);
    if (!edited.ok) return;
    assert.equal(edited.result.buffer.text, "hello nova");
    assert.equal(edited.result.tabs[0]!.dirty, true);
    assert.match(edited.result.tabs[0]!.title, /\*$/);
  });
});

describe("IPC Path open and save", () => {
  it("opens a Path into a Buffer and saves edits back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf82-"));
    const path = join(dir, "note.txt");
    await writeFile(path, "disk text", "utf8");

    const host = new IntentIpcHost();
    const opened = await host.handle({
      method: "open_path",
      params: { path },
    });
    assert.equal(opened.ok, true);
    if (!opened.ok) return;
    assert.equal(opened.result.buffer.text, "disk text");
    assert.equal(opened.result.tabs[0]!.path, path);
    assert.equal(opened.result.tabs[0]!.dirty, false);

    await host.handle({
      method: "edit_active",
      params: { text: "disk text\nedited" },
    });
    const saved = await host.handle({ method: "save_active", params: {} });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.result.tabs[0]!.dirty, false);
    assert.equal(await readFile(path, "utf8"), "disk text\nedited");
  });

  it("save_active_as binds an untitled Buffer to a Path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf82-"));
    const path = join(dir, "scratch.txt");

    const host = new IntentIpcHost();
    await host.handle({ method: "evoke", params: {} });
    await host.handle({
      method: "edit_active",
      params: { text: "scratch body" },
    });
    const saved = await host.handle({
      method: "save_active_as",
      params: { path },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.result.tabs[0]!.untitled, false);
    assert.equal(saved.result.tabs[0]!.path, path);
    assert.equal(await readFile(path, "utf8"), "scratch body");
  });
});

describe("IPC close prompts", () => {
  it("closes a clean untitled Buffer without asking", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const closed = await host.handle({
      method: "request_close",
      params: { id: evoked.result.buffer.id },
    });
    assert.equal(closed.ok, true);
    if (!closed.ok) return;
    assert.deepEqual(closed.result.close, {
      ok: true,
      closed: true,
      asked: false,
    });
    assert.equal(closed.result.tabs.length, 0);
  });

  it("asks before closing a dirty untitled Buffer, then closes on confirm", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "unsaved" },
    });

    const ask = await host.handle({
      method: "request_close",
      params: { id: evoked.result.buffer.id },
    });
    assert.equal(ask.ok, true);
    if (!ask.ok) return;
    assert.deepEqual(ask.result.close, {
      ok: false,
      reason: "confirm_discard_untitled",
      bufferId: evoked.result.buffer.id,
    });
    assert.equal(ask.result.tabs.length, 1);

    const confirmed = await host.handle({
      method: "confirm_close",
      params: { id: evoked.result.buffer.id },
    });
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.deepEqual(confirmed.result.close, {
      ok: true,
      closed: true,
      asked: true,
    });
    assert.equal(confirmed.result.tabs.length, 0);
  });
});
