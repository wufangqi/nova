/**
 * WUF-71 contract: evoke / multi-Buffer tabs / Path open·save / close prompts.
 * Seam: EditorShell (notepad-like shell over IntentService Buffers). No Tauri required.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EditorShell } from "../src/editor-shell.js";

describe("global hotkey evoke", () => {
  it("creates a new untitled Buffer and keeps existing ones", () => {
    const shell = new EditorShell();
    const first = shell.evokeNewUntitled();
    const second = shell.evokeNewUntitled();

    assert.notEqual(first.id, second.id);
    assert.equal(shell.listTabs().length, 2);
    assert.equal(shell.activeBufferId, second.id);
    assert.ok(shell.listTabs().some((t) => t.bufferId === first.id));
    assert.equal(shell.getTab(first.id).untitled, true);
    assert.equal(shell.getTab(second.id).untitled, true);
  });
});

describe("multi-Buffer tabs", () => {
  it("switches the active Buffer among open tabs", () => {
    const shell = new EditorShell();
    const a = shell.evokeNewUntitled();
    const b = shell.evokeNewUntitled();
    assert.equal(shell.activeBufferId, b.id);

    shell.activateTab(a.id);
    assert.equal(shell.activeBufferId, a.id);
    assert.equal(shell.getActiveBuffer().id, a.id);

    shell.activateTab(b.id);
    assert.equal(shell.activeBufferId, b.id);
  });
});

describe("Path open and save", () => {
  it("opens a Path into a Buffer and saves Buffer text back to Path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf71-"));
    const path = join(dir, "note.txt");
    await writeFile(path, "hello from disk", "utf8");

    const shell = new EditorShell();
    const opened = await shell.openPath(path);
    // Snapshots omit full text; body via slice/len.
    assert.equal(opened.text, undefined);
    assert.equal(shell.getActiveBuffer().text, undefined);
    const intent = shell.intentService();
    assert.equal(
      intent.slice(opened.id, 0, intent.len(opened.id)),
      "hello from disk",
    );
    assert.equal(shell.getTab(opened.id).path, path);
    assert.equal(shell.getTab(opened.id).untitled, false);
    assert.equal(shell.getTab(opened.id).dirty, false);

    shell.editActive("hello from disk\nedited");
    assert.equal(shell.getTab(opened.id).dirty, true);

    await shell.saveActive();
    assert.equal(shell.getTab(opened.id).dirty, false);
    assert.equal(await readFile(path, "utf8"), "hello from disk\nedited");
  });

  it("saveAs binds an untitled Buffer to a Path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf71-"));
    const path = join(dir, "scratch.txt");

    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    shell.editActive("paste me");
    await shell.saveActiveAs(path);

    assert.equal(shell.getTab(buf.id).untitled, false);
    assert.equal(shell.getTab(buf.id).path, path);
    assert.equal(shell.getTab(buf.id).dirty, false);
    assert.equal(await readFile(path, "utf8"), "paste me");
  });
});

describe("close prompts", () => {
  it("closes a clean untitled Buffer without asking", () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    const result = shell.requestClose(buf.id);
    assert.deepEqual(result, { ok: true, closed: true, asked: false });
    assert.equal(shell.listTabs().length, 0);
  });

  it("asks before closing a dirty untitled Buffer, and closes after confirm", () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    shell.editActive("unsaved");

    const ask = shell.requestClose(buf.id);
    assert.deepEqual(ask, {
      ok: false,
      reason: "confirm_discard_untitled",
      bufferId: buf.id,
    });
    assert.equal(shell.listTabs().length, 1);

    const closed = shell.confirmClose(buf.id);
    assert.deepEqual(closed, { ok: true, closed: true, asked: true });
    assert.equal(shell.listTabs().length, 0);
  });
});

describe("evoke → paste → save (manual demo script seam)", () => {
  it("supports the notepad loop without a Workspace noun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf71-"));
    const path = join(dir, "demo.txt");

    const shell = new EditorShell();
    shell.evokeNewUntitled(); // prior scratch stays
    const prior = shell.activeBufferId!;
    shell.evokeNewUntitled(); // hotkey again
    assert.equal(shell.listTabs().length, 2);
    assert.notEqual(shell.activeBufferId, prior);

    shell.editActive("pasted clipboard text");
    await shell.saveActiveAs(path);
    assert.equal(await readFile(path, "utf8"), "pasted clipboard text");
  });
});
