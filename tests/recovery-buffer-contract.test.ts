/**
 * WUF-106 contract: RecoveryBuffer quit persist + launch restore.
 * Seam: RecoveryStore (temp dir = fake relaunch) + recovery orchestration.
 * No user-facing draft box; no real GUI.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  closeTabWithRecovery,
  noteBufferSaved,
  persistDirtyOnQuit,
  restoreOnLaunch,
} from "../desktop/src/recovery.ts";
import {
  createFileRecoveryStore,
  createMemoryRecoveryStore,
  type RecoveryStore,
} from "../desktop/src/recovery-store.ts";
import {
  createScriptedClosePrompter,
} from "../desktop/src/close-prompter.ts";
import type { TabClosePort } from "../desktop/src/tab-close.ts";
import { EditorShell } from "../src/editor-shell.js";

function portFromShell(shell: EditorShell): TabClosePort {
  return {
    async getTab(bufferId) {
      try {
        const tab = shell.getTab(bufferId);
        return {
          title: tab.title.replace(/\*$/, ""),
          hasPath: tab.path != null,
          dirty: tab.dirty,
        };
      } catch {
        return undefined;
      }
    },
    async closeClean(bufferId) {
      const result = shell.requestClose(bufferId);
      assert.equal(result.ok, true);
    },
    async discard(bufferId) {
      shell.confirmClose(bufferId);
    },
    async save() {
      return "saved";
    },
  };
}

function textOf(shell: EditorShell, bufferId: string): string {
  const intent = shell.intentService();
  const n = intent.len(bufferId);
  return n === 0 ? "" : intent.slice(bufferId, 0, n);
}

describe("RecoveryStore is injectable (no draft-box product surface)", () => {
  it("exposes saveAll / loadAll / drop without any draft-box UI API", async () => {
    const store: RecoveryStore = createMemoryRecoveryStore();
    await store.saveAll([
      { bufferId: "a", text: "hello", path: null },
    ]);
    const loaded = await store.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]!.text, "hello");
    await store.drop("a");
    assert.equal((await store.loadAll()).length, 0);
    // Contract surface is the store seam only — no browse/list-drafts product API.
    assert.equal(
      "listDrafts" in store || "openDraftBox" in store,
      false,
    );
  });
});

describe("dirty → quit → relaunch restores editable tabs", () => {
  it("persists dirty Buffers to a temp RecoveryStore and restores them on a new shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf106-"));
    const store = createFileRecoveryStore(dir);

    const session1 = new EditorShell();
    const untitled = session1.evokeNewUntitled();
    session1.editActive("unsaved draft");
    const pathDir = await mkdtemp(join(tmpdir(), "nova-wuf106-path-"));
    const boundPath = join(pathDir, "notes.txt");
    await writeFile(boundPath, "on disk", "utf8");
    const bound = await session1.openPath(boundPath);
    session1.editActive("on disk\nplus edits");

    const savedCount = await persistDirtyOnQuit(session1, store);
    assert.equal(savedCount, 2);

    // Fake relaunch: brand-new shell + same store directory.
    const session2 = new EditorShell();
    assert.equal(session2.listTabs().length, 0);
    const restored = await restoreOnLaunch(session2, store);
    assert.equal(restored.length, 2);
    assert.equal(session2.listTabs().length, 2);

    const tabs = session2.listTabs();
    const untitledTab = tabs.find((t) => t.untitled);
    const pathTab = tabs.find((t) => t.path === boundPath);
    assert.ok(untitledTab, "untitled recovered tab");
    assert.ok(pathTab, "Path-bound recovered tab");
    assert.equal(untitledTab!.dirty, true);
    assert.equal(pathTab!.dirty, true);
    assert.equal(textOf(session2, untitledTab!.bufferId), "unsaved draft");
    assert.equal(textOf(session2, pathTab!.bufferId), "on disk\nplus edits");

    // Recovered tabs remain editable.
    session2.activateTab(untitledTab!.bufferId);
    session2.editActive("unsaved draft continued");
    assert.equal(
      textOf(session2, untitledTab!.bufferId),
      "unsaved draft continued",
    );

    // Original session ids need not survive; content + Path binding do.
    assert.notEqual(untitledTab!.bufferId, untitled.id);
    assert.notEqual(pathTab!.bufferId, bound.id);
  });
});

describe("Path-bound dirty restore: Save writes back to Path", () => {
  it("Save after restore overwrites the original Path with recovered edits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf106-"));
    const store = createFileRecoveryStore(dir);
    const pathDir = await mkdtemp(join(tmpdir(), "nova-wuf106-path-"));
    const boundPath = join(pathDir, "bound.txt");
    await writeFile(boundPath, "original", "utf8");

    const session1 = new EditorShell();
    await session1.openPath(boundPath);
    session1.editActive("recovered body");
    await persistDirtyOnQuit(session1, store);

    const session2 = new EditorShell();
    await restoreOnLaunch(session2, store);
    const tab = session2.listTabs()[0]!;
    assert.equal(tab.path, boundPath);
    assert.equal(tab.dirty, true);

    session2.activateTab(tab.bufferId);
    await session2.saveActive();
    assert.equal(session2.getTab(tab.bufferId).dirty, false);
    assert.equal(await readFile(boundPath, "utf8"), "recovered body");
  });
});

describe("tab Don’t save drops recovery for that Buffer", () => {
  it("discard close removes the Buffer from the store so relaunch skips it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf106-"));
    const store = createFileRecoveryStore(dir);

    const session1 = new EditorShell();
    const keep = session1.evokeNewUntitled();
    session1.editActive("keep me");
    const doomed = session1.evokeNewUntitled();
    session1.editActive("throw away");
    await persistDirtyOnQuit(session1, store);

    const session2 = new EditorShell();
    await restoreOnLaunch(session2, store);
    assert.equal(session2.listTabs().length, 2);

    const doomedTab = session2
      .listTabs()
      .find((t) => textOf(session2, t.bufferId) === "throw away");
    const keepTab = session2
      .listTabs()
      .find((t) => textOf(session2, t.bufferId) === "keep me");
    assert.ok(doomedTab);
    assert.ok(keepTab);

    const prompter = createScriptedClosePrompter({ choices: ["discard"] });
    const outcome = await closeTabWithRecovery(
      prompter,
      portFromShell(session2),
      store,
      doomedTab!.bufferId,
    );
    assert.deepEqual(outcome, { kind: "closed", via: "discard" });
    assert.equal(session2.listTabs().length, 1);

    // Quit again with remaining dirty tab, then relaunch — doomed is gone.
    await persistDirtyOnQuit(session2, store);
    const session3 = new EditorShell();
    await restoreOnLaunch(session3, store);
    assert.equal(session3.listTabs().length, 1);
    assert.equal(textOf(session3, session3.listTabs()[0]!.bufferId), "keep me");
    assert.ok(!session3.listTabs().some((t) => textOf(session3, t.bufferId) === "throw away"));

    // Original keep id from session1 is irrelevant after restore.
    void keep;
    void doomed;
  });
});

describe("active Save clears recovery need", () => {
  it("after Save the Buffer is clean and quit does not re-persist it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf106-"));
    const store = createFileRecoveryStore(dir);
    const pathDir = await mkdtemp(join(tmpdir(), "nova-wuf106-path-"));
    const boundPath = join(pathDir, "clean.txt");
    await writeFile(boundPath, "base", "utf8");

    const shell = new EditorShell();
    await shell.openPath(boundPath);
    shell.editActive("base\nedited");
    await persistDirtyOnQuit(shell, store);
    assert.equal((await store.loadAll()).length, 1);

    // Simulate save clearing recovery (same session or after restore).
    await shell.saveActive();
    await noteBufferSaved(store, shell.activeBufferId!);
    assert.equal((await store.loadAll()).length, 0);

    const count = await persistDirtyOnQuit(shell, store);
    assert.equal(count, 0);
    assert.equal((await store.loadAll()).length, 0);
  });
});
