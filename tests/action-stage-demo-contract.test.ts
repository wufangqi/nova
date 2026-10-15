/**
 * WUF-94 Stage exit Demo contract.
 * Seam: runActionStageDemo over EditorShell + IntentService + ActionService
 * (temp FileActionStore = restart equivalent). Retention metrics are NOT
 * asserted — observational only, not a merge gate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runActionStageDemo } from "../src/action-stage-demo.js";

describe("Action Stage exit Demo (hotkey → save → reload → run → Accept)", () => {
  it("reproduces evoke untitled → RegexDraft Intent → save → store reload → Selection preview_run → Accept", () => {
    const result = runActionStageDemo({
      pasteText: "red fox red hen",
      utterance: "regex s/red/blue/g",
      runText: "red fox red hen",
      selection: { start: 0, end: 8 },
    });

    assert.equal(result.ok, true, result.ok ? undefined : result.reason);
    assert.deepEqual(result.steps, [
      "hotkey_evoke",
      "paste",
      "intent_regex_draft",
      "save_action",
      "store_reload",
      "selection_preview_run",
      "accept",
    ]);
    assert.equal(result.textBeforeRun, "red fox red hen");
    // Selection covers only "red fox " — first red → blue; second red stays.
    assert.equal(result.textAfterAccept, "blue fox red hen");
    assert.ok(result.actionId);
    assert.equal(result.displayName, "regex s/red/blue/g");
    assert.equal(result.outboundPresent, false);
    assert.ok(result.undoGroupId);
    assert.equal(result.provenanceSource, "action");
    assert.equal(result.retentionMetricRequired, false);
    assert.equal(result.usedRecipeNoun, false);
  });

  it("survives FileActionStore reload as restart-equivalent (same Action id)", () => {
    const result = runActionStageDemo({
      pasteText: "cat dog cat",
      utterance: "regex s/cat/owl/g",
      runText: "cat dog cat",
      selection: { start: 0, end: 11 },
    });

    assert.equal(result.ok, true, result.ok ? undefined : result.reason);
    assert.ok(result.steps.includes("store_reload"));
    assert.equal(result.listedAfterReload, 1);
    assert.equal(result.actionIdAfterReload, result.actionId);
    assert.equal(result.textAfterAccept, "owl dog owl");
  });
});

describe("Stage exit does not gate on retention metrics", () => {
  it("Demo success never requires a retention / reuse-rate metric", () => {
    const result = runActionStageDemo();
    assert.equal(result.ok, true, result.ok ? undefined : result.reason);
    assert.equal(result.retentionMetricRequired, false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result, "retentionRate"),
      false,
    );
  });
});
