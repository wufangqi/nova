/**
 * WUF-83 contract: OS global hotkey port → new untitled Buffer, keep tabs.
 * Seam: global-hotkey port (accelerator + onGlobalHotkeyPressed → EditorShell).
 * Tauri registers the same accelerator; this suite locks the domain side.
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

describe("global hotkey accelerator", () => {
  it("exports a Windows-registerable Ctrl+Alt accelerator", () => {
    assert.equal(GLOBAL_HOTKEY_ACCELERATOR, "Ctrl+Alt+N");
    assert.match(GLOBAL_HOTKEY_ACCELERATOR, /^Ctrl\+Alt\+[A-Z]$/);
  });

  it("names the desktop event the shell UI listens for", () => {
    assert.equal(HOTKEY_EVOKE_EVENT, "hotkey-evoke");
  });
});

describe("global hotkey evoke port", () => {
  it("creates a new untitled Buffer, focuses it, and keeps prior tabs", () => {
    const shell = new EditorShell();
    const prior = shell.evokeNewUntitled();
    shell.editActive("keep me");

    const created = onGlobalHotkeyPressed(shell);

    assert.notEqual(created.id, prior.id);
    assert.equal(created.text, "");
    assert.equal(shell.activeBufferId, created.id);
    assert.equal(shell.listTabs().length, 2);
    assert.ok(shell.listTabs().some((t) => t.bufferId === prior.id));

    shell.activateTab(prior.id);
    assert.equal(shell.getActiveBuffer().text, "keep me");
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

    const switchBack = await host.handle({
      method: "activate_tab",
      params: { id: first.result.buffer.id },
    });
    assert.equal(switchBack.ok, true);
    if (!switchBack.ok) return;
    assert.equal(switchBack.result.buffer.text, "scratch that must survive");
  });
});
