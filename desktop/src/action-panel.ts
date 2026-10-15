/**
 * WUF-93 — Action panel logic for the desktop shell.
 *
 * Menus/buttons only: all Action semantics go through `ActionPanelPort`
 * (IPC / Tauri). Buffer writes stay on the existing Accept/reject seam —
 * this panel never mutates Buffer text itself.
 */

import {
  messageForMutateFail,
  messageForPreviewRunFail,
  messageForSaveFail,
  messageForSaveOk,
} from "./action-ui.ts";

export type ActionView = {
  id: string;
  displayName: string;
  pattern: string;
  replacement?: string;
  flags?: string;
  createdAt: string;
};

export type Selection = { start: number; end: number };

export type SaveResult =
  | { ok: true; message: string; action: ActionView }
  | { ok: false; message: string };

export type MutateResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type RunOk = {
  ok: true;
  message: string;
  run: {
    previewId: string;
    patches: unknown[];
    cost: { latencyMsEstimate: number; tokensEstimate: number; hasOutbound: boolean };
  };
};

export type RunFail = { ok: false; message: string };

export type RunResult = RunOk | RunFail;

export type ActionPanelPort = {
  listActions(): Promise<ActionView[]>;
  saveFromRegexDraft(input: {
    previewId: string;
    displayName?: string;
  }): Promise<
    | { ok: true; action: ActionView }
    | { ok: false; reason: "not_regex_draft" | "cap_exceeded" | "stale_preview" }
  >;
  renameAction(input: {
    id: string;
    displayName: string;
  }): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  deleteAction(input: {
    id: string;
  }): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;
  previewRun(input: {
    actionId: string;
    selection: Selection;
  }): Promise<
    | {
        ok: true;
        run: {
          previewId: string;
          patches: unknown[];
          cost: {
            latencyMsEstimate: number;
            tokensEstimate: number;
            hasOutbound: boolean;
          };
        };
      }
    | { ok: false; reason: string; guidance: string }
  >;
};

/**
 * Controllable Action catalog + preview-run coordinator for the desktop shell.
 * Keeps a local list snapshot for rendering; refreshes after save/rename/delete.
 */
export class ActionPanel {
  private actions: ActionView[] = [];

  constructor(private readonly port: ActionPanelPort) {}

  list(): ActionView[] {
    return this.actions.map((a) => ({ ...a }));
  }

  async refresh(): Promise<ActionView[]> {
    this.actions = await this.port.listActions();
    return this.list();
  }

  /**
   * Save from an outstanding RegexDraft preview id.
   * `null` means the UI has no pending Intent preview to save.
   */
  async save(previewId: string | null): Promise<SaveResult> {
    if (previewId === null || previewId === "") {
      return {
        ok: false,
        message:
          "No Intent preview to save — run Intent first and get a RegexDraft.",
      };
    }
    const result = await this.port.saveFromRegexDraft({ previewId });
    if (!result.ok) {
      return { ok: false, message: messageForSaveFail(result.reason) };
    }
    await this.refresh();
    return {
      ok: true,
      message: messageForSaveOk(result.action.displayName),
      action: result.action,
    };
  }

  async rename(id: string, displayName: string): Promise<MutateResult> {
    const result = await this.port.renameAction({ id, displayName });
    if (!result.ok) {
      return { ok: false, message: messageForMutateFail(result.reason) };
    }
    await this.refresh();
    const label = displayName.trim() || id;
    return { ok: true, message: `Renamed to “${label}”.` };
  }

  async remove(id: string): Promise<MutateResult> {
    const result = await this.port.deleteAction({ id });
    if (!result.ok) {
      return { ok: false, message: messageForMutateFail(result.reason) };
    }
    await this.refresh();
    return { ok: true, message: "Action deleted." };
  }

  /**
   * Preview-run on the current Selection. Pass `null` when the editor has
   * no range (caret-only) — never silently expands to the whole Buffer.
   * Does not write Buffer text; caller Accepts/rejects via IntentService.
   */
  async run(actionId: string, selection: Selection | null): Promise<RunResult> {
    if (selection === null || selection.start === selection.end) {
      return {
        ok: false,
        message: messageForPreviewRunFail({
          reason: "empty_selection",
          guidance:
            "Selection is empty — highlight a non-empty range before running an Action.",
        }),
      };
    }
    const result = await this.port.previewRun({ actionId, selection });
    if (!result.ok) {
      return {
        ok: false,
        message: messageForPreviewRunFail(result),
      };
    }
    return {
      ok: true,
      message: "Action preview ready — Accept or Reject (local / deterministic).",
      run: result.run,
    };
  }
}
