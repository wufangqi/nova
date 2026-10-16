/**
 * M3 Action Stage exit Demo (WUF-94).
 * hotkey → untitled Buffer → Intent RegexDraft → save Action →
 * store reload (restart equivalent) → Selection preview_run → Accept.
 * Uses a temp FileActionStore — no real user profile directory.
 * Retention / reuse-rate metrics are never a completion condition.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionService, FileActionStore } from "./action-service.js";
import { EditorShell } from "./editor-shell.js";
import { IntentService } from "./intent-service.js";
import type { ActionId, Selection, UndoGroupId } from "./types.js";

export interface ActionStageDemoOptions {
  pasteText?: string;
  utterance?: string;
  /** Text placed on the Buffer before preview_run (after reload). */
  runText?: string;
  selection?: Selection;
}

export type ActionStageDemoResult =
  | {
      ok: true;
      steps: string[];
      actionId: ActionId;
      actionIdAfterReload: ActionId;
      displayName: string;
      listedAfterReload: number;
      textBeforeRun: string;
      textAfterAccept: string;
      undoGroupId: UndoGroupId;
      outboundPresent: false;
      provenanceSource: "action";
      elapsedMs: number;
      /** Explicit: retention is observational only — never a merge gate. */
      retentionMetricRequired: false;
      usedRecipeNoun: false;
    }
  | {
      ok: false;
      steps: string[];
      reason: string;
      elapsedMs: number;
      retentionMetricRequired: false;
      usedRecipeNoun: false;
    };

const FLAGS = {
  retentionMetricRequired: false as const,
  usedRecipeNoun: false as const,
};

/**
 * Scripted Stage exit path against in-process seams + temp disk store.
 */
export function runActionStageDemo(
  options: ActionStageDemoOptions = {},
): ActionStageDemoResult {
  const started = performance.now();
  const steps: string[] = [];
  const pasteText = options.pasteText ?? "red fox red hen";
  const utterance = options.utterance ?? "regex s/red/blue/g";
  const runText = options.runText ?? pasteText;
  const storeDir = mkdtempSync(join(tmpdir(), "nova-action-stage-"));

  try {
    const intent = new IntentService({ modelAvailable: true });
    const shell = new EditorShell(intent);
    const store = new FileActionStore(storeDir);
    const actions = new ActionService(intent, store);

    // Prior scratch stays — F11/hotkey contract shape.
    shell.evokeNewUntitled();
    const prior = shell.activeBufferId!;
    shell.handleHotkeyEvoke();
    steps.push("hotkey_evoke");
    if (shell.listTabs().length !== 2 || shell.activeBufferId === prior) {
      return fail(steps, started, "hotkey did not keep prior Buffer / activate new one");
    }
    const activeTab = shell.getTab(shell.activeBufferId!);
    if (!activeTab.untitled) {
      return fail(steps, started, "hotkey Buffer is not untitled");
    }

    shell.editActive(pasteText);
    steps.push("paste");

    const parsed = intent.parse({
      bufferId: shell.activeBufferId!,
      utterance,
    });
    const preview = intent.preview(parsed);
    steps.push("intent_regex_draft");
    if (preview.kind !== "regex_draft") {
      return fail(
        steps,
        started,
        preview.kind === "error"
          ? `${preview.reason}: ${preview.guidance}`
          : `expected regex_draft, got ${preview.kind}`,
      );
    }
    if (preview.draft.replacement === undefined) {
      return fail(
        steps,
        started,
        "RegexDraft has no replacement — Stage Demo needs a replaceable Action",
      );
    }

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    steps.push("save_action");
    if (!saved.ok) {
      return fail(steps, started, `save failed: ${saved.reason}`);
    }
    const actionId = saved.action.id;
    const displayName = saved.action.displayName;

    // Restart equivalent: new facade, same store path.
    const reloaded = new ActionService(intent, new FileActionStore(storeDir));
    steps.push("store_reload");
    const listed = reloaded.list();
    if (listed.length !== 1 || listed[0]!.id !== actionId) {
      return fail(
        steps,
        started,
        `store reload lost Action (listed=${listed.length})`,
      );
    }
    const actionIdAfterReload = listed[0]!.id;

    // Re-run on a non-empty Selection after reload (may reuse same Buffer).
    shell.editActive(runText);
    const bufferId = shell.activeBufferId!;
    const bodyOf = (id: string) => {
      const n = intent.len(id);
      return n === 0 ? "" : intent.slice(id, 0, n);
    };
    const textBeforeRun = bodyOf(bufferId);
    const selection =
      options.selection ??
      ({ start: 0, end: textBeforeRun.length } satisfies Selection);

    const run = reloaded.previewRun({
      actionId: actionIdAfterReload,
      bufferId,
      selection,
    });
    steps.push("selection_preview_run");
    if (!run.ok) {
      return fail(steps, started, `preview_run failed: ${run.reason}`);
    }
    if (run.outbound !== undefined || run.cost.hasOutbound) {
      return fail(steps, started, "preview_run must not produce Outbound");
    }
    // Buffer unchanged until Accept.
    if (bodyOf(bufferId) !== textBeforeRun) {
      return fail(steps, started, "preview_run mutated Buffer before Accept");
    }

    const accepted = intent.accept(run.patches);
    steps.push("accept");
    if (!accepted.ok) {
      return fail(steps, started, `accept failed: ${accepted.reason}`);
    }

    const textAfterAccept = bodyOf(bufferId);
    const audit = intent.getProvenanceAudit(bufferId);
    const provenanceSource =
      audit[0]?.originalProvenance.source === "action"
        ? ("action" as const)
        : null;
    if (provenanceSource !== "action") {
      return fail(steps, started, "Accept Provenance source is not action");
    }

    return {
      ok: true,
      steps,
      actionId,
      actionIdAfterReload,
      displayName,
      listedAfterReload: listed.length,
      textBeforeRun,
      textAfterAccept,
      undoGroupId: accepted.undoGroupId,
      outboundPresent: false,
      provenanceSource,
      elapsedMs: performance.now() - started,
      ...FLAGS,
    };
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
}

function fail(
  steps: string[],
  started: number,
  reason: string,
): ActionStageDemoResult {
  return {
    ok: false,
    steps,
    reason,
    elapsedMs: performance.now() - started,
    ...FLAGS,
  };
}
