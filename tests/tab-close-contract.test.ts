/**
 * WUF-105 contract: per-tab close ×, dirty marker, three-way ClosePrompter.
 * Seam: tab-close + ClosePrompter (scripted). No real GUI dialogs.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  closeTabWithPrompter,
  type TabClosePort,
} from "../desktop/src/tab-close.ts";
import {
  createScriptedClosePrompter,
  type CloseChoice,
} from "../desktop/src/close-prompter.ts";
import {
  saveAsWithPicker,
  saveWithPicker,
  type FileOpsPort,
} from "../desktop/src/file-ops.ts";
import { createScriptedPathPicker } from "../desktop/src/path-picker.ts";
import { EditorShell } from "../src/editor-shell.js";

function portFromShell(
  shell: EditorShell,
  save: (bufferId: string) => Promise<"saved" | "cancelled">,
): TabClosePort {
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
    save,
  };
}

function fileOpsFromShell(shell: EditorShell): FileOpsPort {
  return {
    async getActiveTab() {
      const id = shell.activeBufferId;
      if (!id) return undefined;
      const tab = shell.getTab(id);
      return { path: tab.path, untitled: tab.untitled };
    },
    async openPath(path) {
      await shell.openPath(path);
    },
    async saveActive() {
      await shell.saveActive();
    },
    async saveActiveAs(path) {
      await shell.saveActiveAs(path);
    },
  };
}

describe("tab chrome: close control + dirty marker", () => {
  it("exposes dirty on the tab and marks the title with *", () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    assert.equal(shell.getTab(buf.id).dirty, false);
    assert.equal(shell.getTab(buf.id).title, "Untitled");

    shell.editActive("unsaved");
    const tab = shell.getTab(buf.id);
    assert.equal(tab.dirty, true);
    assert.ok(tab.title.endsWith("*"), `expected dirty marker in title, got ${tab.title}`);
  });

  it("closes a clean tab without prompting", async () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    const prompter = createScriptedClosePrompter({ choices: [] });
    const outcome = await closeTabWithPrompter(
      prompter,
      portFromShell(shell, async () => "saved"),
      buf.id,
    );
    assert.deepEqual(outcome, { kind: "closed", via: "clean" });
    assert.equal(prompter.confirmDirtyCalls, 0);
    assert.equal(shell.listTabs().length, 0);
  });
});

describe("dirty close: three-way ClosePrompter", () => {
  it("distinguishes save / discard / cancel via injectable ClosePrompter", async () => {
    const choices: CloseChoice[] = ["save", "discard", "cancel"];
    const prompter = createScriptedClosePrompter({ choices });

    for (const expected of ["save", "discard", "cancel"] as const) {
      const shell = new EditorShell();
      const buf = shell.evokeNewUntitled();
      shell.editActive(`choice:${expected}`);
      const saveCalls: string[] = [];
      const outcome = await closeTabWithPrompter(
        prompter,
        portFromShell(shell, async (id) => {
          saveCalls.push(id);
          // Simulate Save As success for the "save" branch.
          await shell.saveActiveAs(
            join(await mkdtemp(join(tmpdir(), "nova-wuf105-")), "t.txt"),
          );
          return "saved";
        }),
        buf.id,
      );
      assert.equal(prompter.lastTab?.title, "Untitled");
      assert.equal(prompter.lastTab?.hasPath, false);
      if (expected === "cancel") {
        assert.deepEqual(outcome, { kind: "cancelled" });
        assert.equal(shell.listTabs().length, 1);
        assert.equal(saveCalls.length, 0);
      } else if (expected === "discard") {
        assert.deepEqual(outcome, { kind: "closed", via: "discard" });
        assert.equal(shell.listTabs().length, 0);
        assert.equal(saveCalls.length, 0);
      } else {
        assert.deepEqual(outcome, { kind: "closed", via: "save" });
        assert.equal(shell.listTabs().length, 0);
        assert.equal(saveCalls.length, 1);
      }
    }
    assert.equal(prompter.confirmDirtyCalls, 3);
  });

  it("discard removes the tab and drops its content from the shell", async () => {
    const shell = new EditorShell();
    const keep = shell.evokeNewUntitled();
    shell.editActive("keep me");
    const doomed = shell.evokeNewUntitled();
    shell.editActive("throw away");

    const prompter = createScriptedClosePrompter({ choices: ["discard"] });
    const outcome = await closeTabWithPrompter(
      prompter,
      portFromShell(shell, async () => "saved"),
      doomed.id,
    );
    assert.deepEqual(outcome, { kind: "closed", via: "discard" });
    assert.equal(shell.listTabs().length, 1);
    assert.equal(shell.listTabs()[0]!.bufferId, keep.id);
    assert.throws(() => shell.getTab(doomed.id));
    // Remaining Buffer content is intact.
    const intent = shell.intentService();
    assert.equal(
      intent.slice(keep.id, 0, intent.len(keep.id)),
      "keep me",
    );
  });

  it("cancel leaves the dirty tab open with content intact", async () => {
    const shell = new EditorShell();
    const buf = shell.evokeNewUntitled();
    shell.editActive("still here");

    const prompter = createScriptedClosePrompter({ choices: ["cancel"] });
    const outcome = await closeTabWithPrompter(
      prompter,
      portFromShell(shell, async () => "saved"),
      buf.id,
    );
    assert.deepEqual(outcome, { kind: "cancelled" });
    assert.equal(shell.listTabs().length, 1);
    assert.equal(shell.getTab(buf.id).dirty, true);
    const intent = shell.intentService();
    assert.equal(
      intent.slice(buf.id, 0, intent.len(buf.id)),
      "still here",
    );
  });

  it("save on Path-bound dirty tab writes then closes; cancel Save As keeps open", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf105-"));
    const path = join(dir, "bound.txt");
    await writeFile(path, "disk", "utf8");

    const shell = new EditorShell();
    const opened = await shell.openPath(path);
    shell.editActive("disk\nedited");

    const pickerOk = createScriptedPathPicker({ saveAsResults: [] });
    const fileOps = fileOpsFromShell(shell);
    const prompter = createScriptedClosePrompter({ choices: ["save"] });
    const outcome = await closeTabWithPrompter(
      prompter,
      portFromShell(shell, async (id) => {
        shell.activateTab(id);
        const result = await saveWithPicker(pickerOk, fileOps);
        return result.kind === "cancelled" ? "cancelled" : "saved";
      }),
      opened.id,
    );
    assert.deepEqual(outcome, { kind: "closed", via: "save" });
    assert.equal(shell.listTabs().length, 0);

    // Untitled dirty + save + cancelled Save As → stay open.
    const untitled = shell.evokeNewUntitled();
    shell.editActive("draft");
    const cancelPicker = createScriptedPathPicker({ saveAsResults: [null] });
    const cancelPrompter = createScriptedClosePrompter({ choices: ["save"] });
    const cancelled = await closeTabWithPrompter(
      cancelPrompter,
      portFromShell(shell, async (id) => {
        shell.activateTab(id);
        const result = await saveAsWithPicker(cancelPicker, fileOps);
        return result.kind === "cancelled" ? "cancelled" : "saved";
      }),
      untitled.id,
    );
    assert.deepEqual(cancelled, { kind: "cancelled" });
    assert.equal(shell.listTabs().length, 1);
    assert.equal(shell.getTab(untitled.id).dirty, true);
  });
});
