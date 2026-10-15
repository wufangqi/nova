/**
 * WUF-93 — desktop Action UI helpers (menus/buttons only).
 * Action rules live in IPC → ActionService; this module maps outcomes to copy
 * and eligibility so the shell never reimplements catalog / run semantics.
 */

export type PreviewKindForSave =
  | "patches"
  | "explanation"
  | "regex_draft"
  | "error"
  | null;

/** Save-as-Action is only offered from a RegexDraft Intent result. */
export function canOfferSaveAsAction(kind: PreviewKindForSave): boolean {
  return kind === "regex_draft";
}

export type SaveFailReason =
  | "not_regex_draft"
  | "cap_exceeded"
  | "stale_preview";

/** Plain-language feedback for save_from_regex_draft failures. */
export function messageForSaveFail(reason: SaveFailReason): string {
  switch (reason) {
    case "not_regex_draft":
      return "Only a RegexDraft preview can be saved as an Action.";
    case "cap_exceeded":
      return "Action limit reached — delete one before saving another.";
    case "stale_preview":
      return "That preview expired — run Intent again, then Save as Action.";
    default: {
      const _exhaustive: never = reason;
      return `Could not save Action: ${String(_exhaustive)}`;
    }
  }
}

export function messageForSaveOk(displayName: string): string {
  return `Saved Action “${displayName}”.`;
}

export type MutateFailReason = "not_found";

export function messageForMutateFail(reason: MutateFailReason): string {
  switch (reason) {
    case "not_found":
      return "Action not found.";
    default: {
      const _exhaustive: never = reason;
      return `Action update failed: ${String(_exhaustive)}`;
    }
  }
}

/**
 * Prefer facade guidance; keep empty Selection vs zero matches distinct.
 */
export function messageForPreviewRunFail(fail: {
  reason: string;
  guidance: string;
}): string {
  switch (fail.reason) {
    case "empty_selection":
      return "Selection is empty — highlight a non-empty range before running an Action.";
    case "zero_matches":
      return "No matches in the Selection — nothing to Accept.";
    case "no_replacement":
      return "This Action is find-only (pattern, no replacement) — text Accept is not offered.";
    case "not_found":
      return "Action not found — it may have been deleted.";
    default:
      return fail.guidance.trim() || `Action run failed: ${fail.reason}`;
  }
}
