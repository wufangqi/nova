/**
 * WUF-87 contract: visual ten-second Demo over the desktop IPC seam.
 * Seam: runVisualTenSecondDemo → IntentIpcHost (same path the Tauri UI drives).
 * No Workspace / Project; bundled installer model is not a hard gate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";
import { runVisualTenSecondDemo } from "../src/visual-ten-second-demo.js";

describe("visual ten-second Demo (IPC: hotkey → paste → Intent → diff → Accept)", () => {
  it("reproduces the desktop path through IntentIpcHost", async () => {
    const result = await runVisualTenSecondDemo({
      pasteText: "hello demo",
      utterance: "make it uppercase",
      selection: { start: 0, end: 5 },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.steps, [
      "hotkey_evoke",
      "paste",
      "preview",
      "diff",
      "accept",
    ]);
    assert.equal(result.textBefore, "hello demo");
    assert.equal(result.textAfter, "HELLO demo");
    assert.match(result.diffText, /^-hello/m);
    assert.match(result.diffText, /^\+HELLO/m);
    assert.ok(result.undoGroupId);
    assert.equal(result.tabCount, 2);
    assert.equal(result.usedWorkspaceNoun, false);
    assert.equal(result.usedProjectNoun, false);
    assert.equal(result.requiresBundledInstallerModel, false);
  });

  it("keeps the editor path usable when the model is unavailable", async () => {
    const host = new IntentIpcHost({ modelAvailable: false });
    const result = await runVisualTenSecondDemo({
      host,
      pasteText: "still editable",
      utterance: "uppercase",
      selection: { start: 0, end: 5 },
      modelAvailable: false,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.steps.includes("hotkey_evoke"));
    assert.ok(result.steps.includes("paste"));
    assert.ok(result.steps.includes("preview"));
    assert.match(result.reason, /model_unavailable|install|model/i);
    // Buffer remains editable after AI failure — editor is not gated on a model.
    assert.equal(result.textAfterPaste, "still editable");
    assert.equal(result.tabCount, 2);
    assert.equal(result.requiresBundledInstallerModel, false);
  });
});

describe("no Workspace / Project on visual Demo path", () => {
  it("exposes only Buffer tabs", async () => {
    const result = await runVisualTenSecondDemo({
      pasteText: "x",
      utterance: "uppercase",
      selection: { start: 0, end: 1 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.usedWorkspaceNoun, false);
    assert.equal(result.usedProjectNoun, false);
    assert.equal(result.usedRecipeNoun, false);
  });
});
