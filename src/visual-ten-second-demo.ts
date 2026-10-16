/**
 * Visual ten-second Demo loop over the desktop IPC seam (WUF-87).
 * hotkey → new Buffer → paste → Intent → diff → Accept.
 * Same IntentIpcHost methods the Tauri UI invokes — scriptable + contract-tested.
 * Offline AI uses a preinstalled local model gateway; bundled installer model
 * is not a hard gate (ADR-0003).
 */
import { IntentIpcHost } from "./ipc/host.js";
import { formatPatchDiff } from "./ipc/patch-diff.js";
import { LocalModelGateway } from "./model-gateway.js";
import type { ModelGateway } from "./model-gateway.js";
import type { Selection, UndoGroupId } from "./types.js";

export interface VisualTenSecondDemoOptions {
  host?: IntentIpcHost;
  pasteText?: string;
  utterance?: string;
  selection?: Selection;
  modelGateway?: ModelGateway;
  cloudEnabled?: boolean;
  /** When false, AI preview fails with guidance; editor path still runs. */
  modelAvailable?: boolean;
}

export type VisualTenSecondDemoResult =
  | {
      ok: true;
      steps: string[];
      textBefore: string;
      textAfter: string;
      diffText: string;
      undoGroupId: UndoGroupId;
      elapsedMs: number;
      tabCount: number;
      outboundPresent: boolean;
      modelPath: "local_preinstalled" | "cloud" | "unavailable";
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
      textAfterPaste?: string;
      tabCount: number;
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
 * Drive the visual Demo through IntentIpcHost (desktop IPC facade).
 * Prior scratch Buffer is kept when the hotkey fires again.
 */
export async function runVisualTenSecondDemo(
  options: VisualTenSecondDemoOptions = {},
): Promise<VisualTenSecondDemoResult> {
  const started = performance.now();
  const steps: string[] = [];
  const pasteText = options.pasteText ?? "hello demo";
  const utterance = options.utterance ?? "make it uppercase";
  const modelAvailable = options.modelAvailable ?? true;
  const cloudEnabled = options.cloudEnabled ?? false;

  const host =
    options.host ??
    new IntentIpcHost({
      modelAvailable,
      cloudEnabled,
      modelGateway: options.modelGateway ?? new LocalModelGateway(),
    });

  // Prior scratch stays (no Workspace/Project — just open Buffers).
  const prior = await host.handle({ method: "evoke", params: {} });
  if (!prior.ok) {
    return fail(steps, started, prior.error, 0);
  }
  const priorId = prior.result.buffer.id;

  const evoked = await host.handle({ method: "evoke", params: {} });
  steps.push("hotkey_evoke");
  if (!evoked.ok) {
    return fail(steps, started, evoked.error, 0);
  }
  const tabs = evoked.result.tabs;
  if (tabs.length !== 2 || evoked.result.buffer.id === priorId) {
    return fail(
      steps,
      started,
      "hotkey did not keep prior Buffer / activate new one",
      tabs.length,
    );
  }

  const pasted = await host.handle({
    method: "edit_active",
    params: { text: pasteText },
  });
  steps.push("paste");
  if (!pasted.ok) {
    return fail(steps, started, pasted.error, tabs.length);
  }
  // Shell snapshots omit full text (WUF-101); read via slice.
  const beforeSlice = await host.handle({
    method: "slice",
    params: {
      id: pasted.result.buffer.id,
      start: 0,
      end: pasteText.length,
    },
  });
  if (!beforeSlice.ok) {
    return fail(steps, started, beforeSlice.error, tabs.length);
  }
  const textBefore = beforeSlice.result.text;

  const selection =
    options.selection ??
    ({ start: 0, end: Math.min(5, textBefore.length) } satisfies Selection);

  const previewed = await host.handle({
    method: "preview_intent",
    params: { utterance, selection },
  });
  steps.push("preview");
  if (!previewed.ok) {
    return fail(steps, started, previewed.error, tabs.length, textBefore);
  }

  const preview = previewed.result.preview;
  if (preview.kind !== "patches") {
    const reason =
      preview.kind === "error"
        ? `${preview.reason}: ${preview.guidance}`
        : `unexpected preview kind: ${preview.kind}`;
    return fail(steps, started, reason, tabs.length, textBefore);
  }

  const diffText = formatPatchDiff(textBefore, preview.patches);
  steps.push("diff");

  const accepted = await host.handle({
    method: "accept",
    params: { patches: preview.patches },
  });
  steps.push("accept");
  if (!accepted.ok) {
    return fail(steps, started, accepted.error, tabs.length, textBefore);
  }
  if (!accepted.result.accept.ok) {
    return fail(
      steps,
      started,
      `accept failed: ${accepted.result.accept.reason}`,
      tabs.length,
      textBefore,
    );
  }

  const state = await host.handle({ method: "get_shell_state", params: {} });
  if (!state.ok || !state.result.buffer) {
    return fail(
      steps,
      started,
      state.ok ? "no active Buffer after Accept" : state.error,
      tabs.length,
      textBefore,
    );
  }

  const modelPath: "local_preinstalled" | "cloud" | "unavailable" =
    !modelAvailable
      ? "unavailable"
      : cloudEnabled
        ? "cloud"
        : "local_preinstalled";

  const lenRes = await host.handle({
    method: "buffer_len",
    params: { id: state.result.buffer.id },
  });
  if (!lenRes.ok) {
    return fail(steps, started, lenRes.error, tabs.length, textBefore);
  }
  const afterSlice = await host.handle({
    method: "slice",
    params: {
      id: state.result.buffer.id,
      start: 0,
      end: lenRes.result.len,
    },
  });
  if (!afterSlice.ok) {
    return fail(steps, started, afterSlice.error, tabs.length, textBefore);
  }

  return {
    ok: true,
    steps,
    textBefore,
    textAfter: afterSlice.result.text,
    diffText,
    undoGroupId: accepted.result.accept.undoGroupId,
    elapsedMs: performance.now() - started,
    tabCount: state.result.tabs.length,
    outboundPresent: Boolean(preview.outbound?.length),
    modelPath,
    ...NOUNS,
  };
}

function fail(
  steps: string[],
  started: number,
  reason: string,
  tabCount: number,
  textAfterPaste?: string,
): VisualTenSecondDemoResult {
  return {
    ok: false,
    steps,
    reason,
    elapsedMs: performance.now() - started,
    textAfterPaste,
    tabCount,
    ...NOUNS,
  };
}
