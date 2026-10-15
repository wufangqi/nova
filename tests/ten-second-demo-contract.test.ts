/**
 * WUF-79 contract: ten-second Demo loop + Windows capability floors.
 * Seam: TenSecondDemo / WindowsGates over EditorShell + IntentService.
 * No Workspace / Project / Recipe / plugin nouns.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EditorShell } from "../src/editor-shell.js";
import { FindBar } from "../src/find-bar.js";
import { IntentService } from "../src/intent-service.js";
import { LocalModelGateway } from "../src/model-gateway.js";
import { runTenSecondDemo } from "../src/ten-second-demo.js";
import {
  LARGE_FILE_CHARS,
  runWindowsGates,
} from "../src/windows-gates.js";

describe("ten-second Demo script (NL → Patch → Accept)", () => {
  it("reproduces hotkey → new Buffer → paste → Intent → preview → Accept", () => {
    const result = runTenSecondDemo({
      pasteText: "hello demo",
      utterance: "make it uppercase",
      selection: { start: 0, end: 5 },
    });

    assert.equal(result.ok, true);
    assert.ok(result.steps.includes("hotkey_evoke"));
    assert.ok(result.steps.includes("paste"));
    assert.ok(result.steps.includes("parse"));
    assert.ok(result.steps.includes("preview"));
    assert.ok(result.steps.includes("accept"));
    assert.equal(result.textBefore, "hello demo");
    assert.equal(result.textAfter, "HELLO demo");
    assert.ok(result.undoGroupId);
    assert.ok(result.elapsedMs >= 0);
    // Prior scratch Buffer stays — no Workspace/Project tab model.
    assert.equal(result.tabCount, 2);
    assert.equal(result.usedWorkspaceNoun, false);
  });

  it("completes offline AI path with preinstalled LocalModelGateway (no network)", () => {
    const gateway = new LocalModelGateway();
    assert.equal(gateway.offline, true);

    const result = runTenSecondDemo({
      pasteText: "offline ai",
      utterance: "uppercase",
      selection: { start: 0, end: 7 },
      modelGateway: gateway,
      cloudEnabled: false,
    });

    assert.equal(result.ok, true);
    assert.equal(result.textAfter, "OFFLINE ai");
    assert.equal(result.outboundPresent, false);
    assert.equal(result.modelPath, "local_preinstalled");
  });
});

describe("offline editor ≠ offline AI (ADR-0003)", () => {
  it("keeps Buffer / FindBar usable with no local model; AI fails with guidance", () => {
    const svc = new IntentService({ modelAvailable: false });
    const shell = new EditorShell(svc);
    shell.handleHotkeyEvoke();
    shell.editActive("edit without model");
    assert.equal(shell.getActiveBuffer().text, "edit without model");

    const find = new FindBar(svc);
    const hits = find.find({
      bufferId: shell.activeBufferId!,
      pattern: "without",
      scope: { kind: "buffer" },
    });
    assert.ok(hits.hits.length >= 1);

    const intent = svc.parse({
      bufferId: shell.activeBufferId!,
      utterance: "uppercase",
    });
    const preview = svc.preview(intent);
    assert.equal(preview.kind, "error");
    if (preview.kind !== "error") return;
    assert.equal(preview.reason, "model_unavailable");
    assert.match(preview.guidance, /install|model/i);
  });

  it("documents that default installer need not ship a large model", () => {
    // Product contract: full offline AI is proven on model-prepped Demo/eval
    // machines (LocalModelGateway), not by bundling a huge model in the
    // default installer. Absence of a ship-model flag is intentional.
    const result = runTenSecondDemo({
      pasteText: "prep",
      utterance: "uppercase",
      selection: { start: 0, end: 4 },
    });
    assert.equal(result.ok, true);
    assert.equal(result.requiresBundledInstallerModel, false);
  });
});

describe("Windows capability floors (cold start / hotkey / large file / 100MB)", () => {
  it("runs cold-start, hotkey-evoke, large-file, and 100MB gates within floors", async () => {
    const report = await runWindowsGates();
    assert.equal(report.ok, true);
    const names = report.gates.map((g) => g.name);
    assert.deepEqual(names, [
      "cold_start",
      "hotkey_evoke",
      "large_file",
      "open_100mb_editable",
      "typing_100mb",
      "scroll_100mb",
      "native_addon_load",
    ]);
    for (const g of report.gates) {
      assert.equal(g.ok, true, `${g.name}: ${g.detail}`);
      assert.ok(g.elapsedMs >= 0);
    }
    const large = report.gates.find((g) => g.name === "large_file")!;
    assert.match(large.detail, new RegExp(String(LARGE_FILE_CHARS)));
    // Large Buffer Intent Scope stays sampled — never whole-file model context.
    assert.match(large.detail, /sampled|sample/i);
    const typing = report.gates.find((g) => g.name === "typing_100mb")!;
    const scroll = report.gates.find((g) => g.name === "scroll_100mb")!;
    assert.ok(typing.elapsedMs >= 0);
    assert.ok(scroll.elapsedMs >= 0);
    // Budgets must be concrete (non-vacuous) — enforced by gate constants + fail path.
    assert.match(typing.detail, /≤/);
    assert.match(scroll.detail, /≤/);
  });
});

describe("no Workspace / Project / Recipe in Demo path", () => {
  it("Demo and gates expose only Buffer tabs — no workspace nouns", async () => {
    const result = runTenSecondDemo({
      pasteText: "x",
      utterance: "uppercase",
      selection: { start: 0, end: 1 },
    });
    assert.equal(result.usedWorkspaceNoun, false);
    assert.equal(result.usedProjectNoun, false);
    assert.equal(result.usedRecipeNoun, false);

    const report = await runWindowsGates();
    assert.equal(report.usedWorkspaceNoun, false);
    assert.equal(report.usedProjectNoun, false);
  });
});
