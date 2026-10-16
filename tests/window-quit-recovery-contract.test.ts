/**
 * WUF-109 contract: window quit → RecoveryBuffer persist without ClosePrompter storm;
 * noticeable status when unsaved tabs are preserved; Tauri PathPicker is the desktop seam.
 * Seam: window-quit orchestration + IntentIpcHost recovery methods (injected store).
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createScriptedClosePrompter } from "../desktop/src/close-prompter.ts";
import {
  quitPreserveStatusMessage,
  runWindowQuitRecovery,
} from "../desktop/src/window-quit.ts";
import { IntentIpcHost } from "../src/ipc/host.js";
import {
  createFileRecoveryStore,
  createMemoryRecoveryStore,
} from "../src/recovery-store.js";
import { bufferBody } from "./helpers/buffer-text.js";

describe("quit preserve status is noticeable when dirty tabs are kept", () => {
  it("returns a short status string only when preservedCount > 0", () => {
    assert.equal(quitPreserveStatusMessage(0), null);
    assert.equal(quitPreserveStatusMessage(1), "已保留未保存标签");
    assert.equal(quitPreserveStatusMessage(3), "已保留未保存标签");
  });
});

describe("window quit never storms ClosePrompter", () => {
  it("persists many dirty tabs without calling confirmDirty", async () => {
    const store = createMemoryRecoveryStore();
    const host = new IntentIpcHost({ recoveryStore: store });

    for (let i = 0; i < 4; i += 1) {
      const evoke = await host.handle({ method: "evoke", params: {} });
      assert.equal(evoke.ok, true);
      const edit = await host.handle({
        method: "edit_active",
        params: { text: `dirty-${i}` },
      });
      assert.equal(edit.ok, true);
    }

    const prompter = createScriptedClosePrompter({ choices: [] });
    const outcome = await runWindowQuitRecovery({
      persistDirty: async () => {
        const res = await host.handle({
          method: "recovery_persist_quit",
          params: {},
        });
        assert.equal(res.ok, true);
        if (!res.ok) throw new Error(res.error);
        return res.result.preservedCount;
      },
      // If quit wrongly asked per-tab, the empty scripted prompter would throw.
      confirmDirty: (tab) => prompter.confirmDirty(tab),
    });

    assert.equal(outcome.preservedCount, 4);
    assert.equal(outcome.statusMessage, "已保留未保存标签");
    assert.equal(prompter.confirmDirtyCalls, 0);
    assert.equal(await store.loadAll().then((r) => r.length), 4);
  });
});

describe("IPC recovery_persist_quit / recovery_restore_launch", () => {
  it("round-trips dirty Buffers across a fake relaunch without draft-box UI", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf109-"));
    const store = createFileRecoveryStore(dir);

    const session1 = new IntentIpcHost({ recoveryStore: store });
    const evoke = await session1.handle({ method: "evoke", params: {} });
    assert.equal(evoke.ok, true);
    await session1.handle({
      method: "edit_active",
      params: { text: "keep across quit" },
    });

    const pathDir = await mkdtemp(join(tmpdir(), "nova-wuf109-path-"));
    const boundPath = join(pathDir, "notes.txt");
    await writeFile(boundPath, "disk", "utf8");
    const opened = await session1.handle({
      method: "open_path",
      params: { path: boundPath },
    });
    assert.equal(opened.ok, true);
    await session1.handle({
      method: "edit_active",
      params: { text: "disk\nedits" },
    });

    const quit = await session1.handle({
      method: "recovery_persist_quit",
      params: {},
    });
    assert.equal(quit.ok, true);
    if (!quit.ok) return;
    assert.equal(quit.result.preservedCount, 2);

    const session2 = new IntentIpcHost({ recoveryStore: store });
    const restored = await session2.handle({
      method: "recovery_restore_launch",
      params: {},
    });
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.equal(restored.result.restoredCount, 2);
    assert.equal(restored.result.tabs.length, 2);
    assert.ok(restored.result.tabs.every((t) => t.dirty));

    const untitled = restored.result.tabs.find((t) => t.untitled);
    const bound = restored.result.tabs.find((t) => t.path === boundPath);
    assert.ok(untitled);
    assert.ok(bound);
    assert.equal(bufferBody(session2.service, untitled!.bufferId), "keep across quit");
    assert.equal(bufferBody(session2.service, bound!.bufferId), "disk\nedits");
  });

  it("recovery_drop removes one Buffer so later restore skips it", async () => {
    const store = createMemoryRecoveryStore();
    const host = new IntentIpcHost({ recoveryStore: store });
    await host.handle({ method: "evoke", params: {} });
    await host.handle({ method: "edit_active", params: { text: "a" } });
    const second = await host.handle({ method: "evoke", params: {} });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    await host.handle({ method: "edit_active", params: { text: "b" } });
    await host.handle({ method: "recovery_persist_quit", params: {} });

    const drop = await host.handle({
      method: "recovery_drop",
      params: { id: second.result.buffer.id },
    });
    assert.equal(drop.ok, true);

    const host2 = new IntentIpcHost({ recoveryStore: store });
    const restored = await host2.handle({
      method: "recovery_restore_launch",
      params: {},
    });
    assert.equal(restored.ok, true);
    if (!restored.ok) return;
    assert.equal(restored.result.restoredCount, 1);
    assert.equal(
      bufferBody(host2.service, restored.result.tabs[0]!.bufferId),
      "a",
    );
  });
});

describe("desktop PathPicker seam is Tauri native dialogs", () => {
  it("tauri-path-picker wires @tauri-apps/plugin-dialog open/save", async () => {
    const src = await readFile(
      new URL("../desktop/src/tauri-path-picker.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /@tauri-apps\/plugin-dialog/);
    assert.match(src, /\bopen\b/);
    assert.match(src, /\bsave\b/);
    assert.match(src, /createTauriPathPicker/);
  });
});
