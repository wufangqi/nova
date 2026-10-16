/**
 * WUF-104 contract: injectable PathPicker drives Open / Save / Save As.
 * Seam: file-ops + PathPicker (scripted). Cancel never touches the Buffer port.
 * No real OS dialog pixels.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  openWithPicker,
  saveAsWithPicker,
  saveWithPicker,
  type FileOpsPort,
  type FileOpsTab,
} from "../desktop/src/file-ops.ts";
import { createScriptedPathPicker } from "../desktop/src/path-picker.ts";
import {
  chooseSaveAction,
  pathInputValueForActive,
} from "../desktop/src/path-toolbar.ts";
import { EditorShell } from "../src/editor-shell.js";

function portFromShell(shell: EditorShell): FileOpsPort & {
  openPathCalls: string[];
  saveActiveCalls: number;
  saveActiveAsCalls: string[];
} {
  const openPathCalls: string[] = [];
  const saveActiveAsCalls: string[] = [];
  let saveActiveCalls = 0;
  return {
    openPathCalls,
    get saveActiveCalls() {
      return saveActiveCalls;
    },
    saveActiveAsCalls,
    async getActiveTab(): Promise<FileOpsTab | undefined> {
      const tabs = shell.listTabs();
      const active = tabs.find((t) => t.bufferId === shell.activeBufferId);
      if (!active) return undefined;
      return { path: active.path, untitled: active.untitled };
    },
    async openPath(path: string) {
      openPathCalls.push(path);
      await shell.openPath(path);
    },
    async saveActive() {
      saveActiveCalls += 1;
      await shell.saveActive();
    },
    async saveActiveAs(path: string) {
      saveActiveAsCalls.push(path);
      await shell.saveActiveAs(path);
    },
  };
}

describe("Path display is read-only chrome (no typed Path)", () => {
  it("shows bound Path and clears for untitled", () => {
    assert.equal(
      pathInputValueForActive({ path: "C:\\notes\\demo.txt", untitled: false }),
      "C:\\notes\\demo.txt",
    );
    assert.equal(pathInputValueForActive({ path: null, untitled: true }), "");
  });

  it("untitled Save routes to Save As; Path-bound Save writes back", () => {
    assert.equal(
      chooseSaveAction({ path: null, untitled: true }),
      "need_save_as",
    );
    assert.equal(
      chooseSaveAction({ path: "C:\\notes\\bound.txt", untitled: false }),
      "save",
    );
  });
});

describe("Open via PathPicker", () => {
  it("opens the picked Path into a Buffer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf104-"));
    const path = join(dir, "note.txt");
    await writeFile(path, "from picker", "utf8");

    const shell = new EditorShell();
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ openResults: [path] });

    const outcome = await openWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "opened", path });
    assert.equal(picker.openCalls, 1);
    assert.deepEqual(port.openPathCalls, [path]);
    assert.equal(shell.getTab(shell.activeBufferId!).path, path);
  });

  it("cancel Open leaves Buffers unchanged", async () => {
    const shell = new EditorShell();
    const before = shell.evokeNewUntitled();
    shell.editActive("keep me");
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ openResults: [null] });

    const outcome = await openWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.deepEqual(port.openPathCalls, []);
    assert.equal(shell.listTabs().length, 1);
    assert.equal(shell.activeBufferId, before.id);
    assert.equal(shell.getTab(before.id).dirty, true);
  });
});

describe("Save / Save As via PathPicker", () => {
  it("Path-bound Save writes back without opening Save As", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf104-"));
    const path = join(dir, "bound.txt");
    await writeFile(path, "original", "utf8");

    const shell = new EditorShell();
    await shell.openPath(path);
    shell.editActive("edited");
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ saveAsResults: [] });

    const outcome = await saveWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "saved", path });
    assert.equal(picker.saveAsCalls, 0);
    assert.equal(port.saveActiveCalls, 1);
    assert.deepEqual(port.saveActiveAsCalls, []);
    assert.equal(await readFile(path, "utf8"), "edited");
    assert.equal(shell.getTab(shell.activeBufferId!).dirty, false);
  });

  it("untitled Save enters Save As and binds the picked Path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf104-"));
    const path = join(dir, "first-save.txt");

    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    shell.editActive("scratch");
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ saveAsResults: [path] });

    const outcome = await saveWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "saved_as", path });
    assert.equal(picker.saveAsCalls, 1);
    assert.equal(port.saveActiveCalls, 0);
    assert.deepEqual(port.saveActiveAsCalls, [path]);
    assert.equal(shell.getTab(buf.id).path, path);
    assert.equal(shell.getTab(buf.id).untitled, false);
    assert.equal(await readFile(path, "utf8"), "scratch");
  });

  it("explicit Save As picks a Path and updates binding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf104-"));
    const original = join(dir, "a.txt");
    const renamed = join(dir, "b.txt");
    await writeFile(original, "body", "utf8");

    const shell = new EditorShell();
    await shell.openPath(original);
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ saveAsResults: [renamed] });

    const outcome = await saveAsWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "saved_as", path: renamed });
    assert.equal(picker.lastSaveAsDefault, original);
    assert.equal(shell.getTab(shell.activeBufferId!).path, renamed);
    assert.equal(await readFile(renamed, "utf8"), "body");
  });

  it("cancel Save As leaves Buffer dirty and unbound (untitled)", async () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    shell.editActive("unsaved");
    const port = portFromShell(shell);
    const picker = createScriptedPathPicker({ saveAsResults: [null] });

    const outcome = await saveWithPicker(picker, port);
    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.deepEqual(port.saveActiveAsCalls, []);
    assert.equal(port.saveActiveCalls, 0);
    assert.equal(shell.getTab(buf.id).untitled, true);
    assert.equal(shell.getTab(buf.id).path, null);
    assert.equal(shell.getTab(buf.id).dirty, true);
  });
});
