/**
 * M2 ten-second Demo loop (WUF-79).
 * hotkey → new Buffer → paste → Intent → preview → Accept.
 * Offline AI path uses a preinstalled local model gateway — not a bundled
 * installer model (ADR-0003).
 */
import { EditorShell } from "./editor-shell.js";
import { IntentService } from "./intent-service.js";
import { LocalModelGateway } from "./model-gateway.js";
import type { ModelGateway } from "./model-gateway.js";
import type { Selection, UndoGroupId } from "./types.js";

export interface TenSecondDemoOptions {
  pasteText?: string;
  utterance?: string;
  selection?: Selection;
  modelGateway?: ModelGateway;
  cloudEnabled?: boolean;
  /** When false, AI is unavailable (ADR-0003 editor-only path). Default true. */
  modelAvailable?: boolean;
}

export type TenSecondDemoResult =
  | {
      ok: true;
      steps: string[];
      textBefore: string;
      textAfter: string;
      undoGroupId: UndoGroupId;
      elapsedMs: number;
      tabCount: number;
      outboundPresent: boolean;
      modelPath: "local_preinstalled" | "cloud" | "unavailable";
      /** Product: Demo machines may preinstall a model; default installer need not. */
      requiresBundledInstallerModel: false;
      usedWorkspaceNoun: false;
      usedProjectNoun: false;
      usedRecipeNoun: false;
    }
  | {
      ok: false;
      steps: string[];
      reason: string;
      elapsedMs: number;
      requiresBundledInstallerModel: false;
      usedWorkspaceNoun: false;
      usedProjectNoun: false;
      usedRecipeNoun: false;
    };

const NOUNS = {
  requiresBundledInstallerModel: false as const,
  usedWorkspaceNoun: false as const,
  usedProjectNoun: false as const,
  usedRecipeNoun: false as const,
};

/**
 * Run the reproducible ten-second Demo against in-process seams.
 * Prior scratch Buffer is kept when the hotkey fires again.
 */
export function runTenSecondDemo(
  options: TenSecondDemoOptions = {},
): TenSecondDemoResult {
  const started = performance.now();
  const steps: string[] = [];
  const pasteText = options.pasteText ?? "hello demo";
  const utterance = options.utterance ?? "make it uppercase";
  const modelAvailable = options.modelAvailable ?? true;
  const cloudEnabled = options.cloudEnabled ?? false;
  const gateway = options.modelGateway ?? new LocalModelGateway();

  const intent = new IntentService({
    modelAvailable,
    cloudEnabled,
    modelGateway: gateway,
  });
  const shell = new EditorShell(intent);

  // Prior scratch stays (no Workspace/Project — just open Buffers).
  shell.evokeNewUntitled();
  const prior = shell.activeBufferId!;
  shell.handleHotkeyEvoke();
  steps.push("hotkey_evoke");
  if (shell.listTabs().length !== 2 || shell.activeBufferId === prior) {
    return {
      ok: false,
      steps,
      reason: "hotkey did not keep prior Buffer / activate new one",
      elapsedMs: performance.now() - started,
      ...NOUNS,
    };
  }

  shell.editActive(pasteText);
  steps.push("paste");
  const activeId = shell.activeBufferId!;
  const textBefore = (() => {
    const n = intent.len(activeId);
    return n === 0 ? "" : intent.slice(activeId, 0, n);
  })();

  const selection =
    options.selection ??
    ({ start: 0, end: Math.min(5, textBefore.length) } satisfies Selection);

  const parsed = intent.parse({
    bufferId: shell.activeBufferId!,
    utterance,
    selection,
  });
  steps.push("parse");

  const preview = intent.preview(parsed);
  steps.push("preview");
  if (preview.kind !== "patches") {
    return {
      ok: false,
      steps,
      reason:
        preview.kind === "error"
          ? `${preview.reason}: ${preview.guidance}`
          : `unexpected preview kind: ${preview.kind}`,
      elapsedMs: performance.now() - started,
      ...NOUNS,
    };
  }

  const accepted = intent.accept(preview.patches);
  steps.push("accept");
  if (!accepted.ok) {
    return {
      ok: false,
      steps,
      reason: `accept failed: ${accepted.reason}`,
      elapsedMs: performance.now() - started,
      ...NOUNS,
    };
  }

  const textAfter = (() => {
    const n = intent.len(activeId);
    return n === 0 ? "" : intent.slice(activeId, 0, n);
  })();
  const modelPath: "local_preinstalled" | "cloud" | "unavailable" =
    !modelAvailable
      ? "unavailable"
      : cloudEnabled
        ? "cloud"
        : "local_preinstalled";

  return {
    ok: true,
    steps,
    textBefore,
    textAfter,
    undoGroupId: accepted.undoGroupId,
    elapsedMs: performance.now() - started,
    tabCount: shell.listTabs().length,
    outboundPresent: Boolean(preview.outbound?.length),
    modelPath,
    ...NOUNS,
  };
}
