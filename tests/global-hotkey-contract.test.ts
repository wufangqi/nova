/**
 * WUF-83 contract: OS global hotkey port → new untitled Buffer, keep tabs.
 * Seam: global-hotkey port (accelerator + onGlobalHotkeyPressed → EditorShell).
 * Tauri registers the same accelerator on Windows; OS registration / smoke is
 * recorded in IMPLEMENTATION.md — this suite locks the domain + IPC side only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorShell } from "../src/editor-shell.js";
import {
  GLOBAL_HOTKEY_ACCELERATOR,
  HOTKEY_EVOKE_EVENT,
  onGlobalHotkeyPressed,
} from "../src/global-hotkey.js";
import { IntentIpcHost } from "../src/ipc/host.js";

describe("global hotkey port constants", () => {
  it("exports the accelerator and desktop event name the shell mirrors", () => {
    assert.equal(GLOBAL_HOTKEY_ACCELERATOR, "Ctrl+Alt+N");
    assert.equal(HOTKEY_EVOKE_EVENT, "hotkey-evoke");
  });
});

describe("global hotkey evoke port", () => {
  it("creates a new untitled Buffer, focuses it, and keeps prior dirty tabs", () => {
    const shell = new EditorShell();
    const prior = shell.evokeNewUntitled();
    shell.editActive("keep me");

    const priorTab = shell.listTabs().find((t) => t.bufferId === prior.id);
    assert.ok(priorTab);
    assert.equal(priorTab.dirty, true);

    const created = onGlobalHotkeyPressed(shell);

    assert.notEqual(created.id, prior.id);
    assert.equal(created.text, undefined);
    assert.equal(shell.activeBufferId, created.id);
    assert.equal(shell.listTabs().length, 2);
    assert.ok(shell.listTabs().some((t) => t.bufferId === prior.id));
    assert.equal(
      shell.listTabs().find((t) => t.bufferId === prior.id)!.dirty,
      true,
    );

    shell.activateTab(prior.id);
    assert.equal(shell.getActiveBuffer().text, undefined);
    const intent = shell.intentService();
    assert.equal(
      intent.slice(prior.id, 0, intent.len(prior.id)),
      "keep me",
    );
  });
});

describe("IPC evoke path used by the hotkey port", () => {
  it("keeps existing Buffer tabs when evoke runs again", async () => {
    const host = new IntentIpcHost();
    const first = await host.handle({ method: "evoke", params: {} });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "scratch that must survive" },
    });

    const second = await host.handle({ method: "evoke", params: {} });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    assert.equal(second.result.tabs.length, 2);
    assert.equal(
      second.result.buffer.id,
      second.result.tabs.find((t) => t.active)!.bufferId,
    );
    assert.notEqual(second.result.buffer.id, first.result.buffer.id);

    const priorTab = second.result.tabs.find(
      (t) => t.bufferId === first.result.buffer.id,
    );
    assert.ok(priorTab);
    assert.equal(priorTab.dirty, true);

    const switchBack = await host.handle({
      method: "activate_tab",
      params: { id: first.result.buffer.id },
    });
    assert.equal(switchBack.ok, true);
    if (!switchBack.ok) return;
    // Shell snapshots omit full text (WUF-101); verify via slice.
    assert.equal(switchBack.result.buffer.text, undefined);
    const slice = await host.handle({
      method: "slice",
      params: {
        id: switchBack.result.buffer.id,
        start: 0,
        end: "scratch that must survive".length,
      },
    });
    assert.equal(slice.ok, true);
    if (!slice.ok) return;
    assert.equal(slice.result.text, "scratch that must survive");
  });
});
