/** Domain identifiers — IntentService Accept seam (WUF-70). */

export type BufferId = string;
export type Revision = number;
export type UndoGroupId = string;
export type IntentId = string;

export type Eol = "lf" | "crlf" | "cr";

export type ProvenanceSource =
  | "user"
  | "ai"
  | "action"
  | "plugin"
  | "findbar"
  | "encoding";

export interface Provenance {
  source: ProvenanceSource;
  /** Optional human-readable tag (model name, action id, …). */
  label?: string;
}

export interface BufferSnapshot {
  id: BufferId;
  text: string;
  revision: Revision;
  encoding: string;
  eol: Eol;
  /** Whether Path IO should write a BOM for this Encoding. */
  bom: boolean;
}

/** Optional Buffer metadata applied only when Accept is explicit about it. */
export interface PatchMetadata {
  encoding?: string;
  eol?: Eol;
  bom?: boolean;
}

/**
 * One text span replacement anchored at a base revision.
 * `before` / `after` are relocate hints (exact adjacent slices at proposal time).
 */
export interface TextEdit {
  start: number;
  end: number;
  replacement: string;
  before?: string;
  after?: string;
}

export interface Patch {
  bufferId: BufferId;
  baseRevision: Revision;
  edits: TextEdit[];
  provenance: Provenance;
  intentId?: IntentId;
  /** Explicit Encoding/EOL/BOM change; omitted ⇒ Accept leaves metadata alone. */
  metadata?: PatchMetadata;
}

export type AcceptOk = { ok: true; undoGroupId: UndoGroupId };
export type AcceptFail = {
  ok: false;
  reason: "reloc_failed" | "stale" | "invalid";
};
export type AcceptResult = AcceptOk | AcceptFail;

/** Main editing history: Accept is always a human commit. */
export interface MainHistoryEntry {
  undoGroupId: UndoGroupId;
  committedBy: "user";
  bufferRevisionAfter: Revision;
  textAfter: string;
}

/** Audit side-car: original Provenance survives Accept (ADR-0002). */
export interface ProvenanceAuditEntry {
  undoGroupId: UndoGroupId;
  committedBy: "user";
  originalProvenance: Provenance;
  intentId?: IntentId;
  bufferId: BufferId;
  textBefore: string;
  textAfter: string;
}

export interface BufferCreateOptions {
  encoding?: string;
  eol?: Eol;
  bom?: boolean;
}

/** WUF-74 — Intent parse / preview seam. */

export type PreviewId = string;

/** Continuous range in a Buffer (may be empty = caret). */
export interface Selection {
  start: number;
  end: number;
}

/** Currently visible window into a Buffer (UI viewport). */
export interface VisibleWindow {
  start: number;
  end: number;
}

/**
 * Scope resolved for one Intent — always bounded and user-visible.
 * Default without Selection: visible window, or a sample of the Buffer.
 */
export type ResolvedScope =
  | { kind: "selection"; start: number; end: number }
  | { kind: "visible"; start: number; end: number; sampled: boolean }
  | { kind: "buffer"; start: number; end: number };

export interface Intent {
  id: IntentId;
  bufferId: BufferId;
  utterance: string;
  scope: ResolvedScope;
  /** Human-visible description of Scope (must not be empty). */
  scopeLabel: string;
}

export interface Cost {
  latencyMsEstimate: number;
  tokensEstimate: number;
  hasOutbound: boolean;
}

export interface Outbound {
  task: string;
  text: string;
  destination: "cloud";
}

/** One jump target inside an Explanation, anchored at preview-time revision. */
export interface ExplanationAnchor {
  id: string;
  start: number;
  end: number;
  note: string;
  /** Exact Buffer slice at preview time — used to relocate after edits. */
  excerpt: string;
  baseRevision: Revision;
}

export interface Explanation {
  summary: string;
  anchors: ExplanationAnchor[];
}

/** Result of resolving an Explanation anchor against the current Buffer. */
export type AnchorResolveOk = {
  ok: true;
  status: "valid";
  start: number;
  end: number;
};

export type AnchorResolveFail = {
  ok: false;
  status: "invalid";
  reason: "reloc_failed" | "stale" | "unknown";
};

export type AnchorResolveResult = AnchorResolveOk | AnchorResolveFail;

export interface RegexDraft {
  pattern: string;
  replacement?: string;
  flags?: string;
}

export type PreviewOk =
  | {
      kind: "patches";
      previewId: PreviewId;
      patches: Patch[];
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "explanation";
      previewId: PreviewId;
      explanation: Explanation;
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "regex_draft";
      previewId: PreviewId;
      draft: RegexDraft;
      cost: Cost;
      outbound?: Outbound[];
    };

export type PreviewFail = {
  kind: "error";
  reason: "model_unavailable" | "validation_failed";
  guidance: string;
  /**
   * When true, caller should leave the user on the Buffer to edit by hand
   * (no Acceptable Patch was produced).
   */
  manualEditOk?: boolean;
};

export type PreviewResult = PreviewOk | PreviewFail;

export interface ParseInput {
  bufferId: BufferId;
  utterance: string;
  selection?: Selection;
  /** Current visible window; when absent and no Selection, sample is used. */
  visibleWindow?: VisibleWindow;
}

/** Injected model backend for transform Intents (WUF-75). */
export interface ModelGatewayLike {
  id: string;
  offline: boolean;
  transform(req: {
    utterance: string;
    scopeText: string;
    scope: ResolvedScope;
    bufferText: string;
    bufferRevision: number;
  }): { raw: string };
}

export interface IntentServiceOptions {
  /** When false, AI preview fails with install guidance (ADR-0003). Default true. */
  modelAvailable?: boolean;
  /** When true, routes via cloud and surfaces Outbound. Default false. */
  cloudEnabled?: boolean;
  /** Max chars for default visible sample. Default 4096. */
  visibleSampleChars?: number;
  /**
   * Model gateway for transform Intents.
   * Default when modelAvailable: LocalModelGateway (offline eval path).
   */
  modelGateway?: ModelGatewayLike;
}

/** Outstanding preview lookup for Action save (WUF-89). */
export type OutstandingPreviewRecord =
  | { kind: "patches"; utterance: string }
  | { kind: "explanation"; utterance: string }
  | { kind: "regex_draft"; utterance: string; draft: RegexDraft };

/** WUF-89 — Action catalog (save / list / persist). */

export type ActionId = string;

export interface SavedAction {
  id: ActionId;
  /** Default = source Intent utterance; renamable (display name only). */
  displayName: string;
  /** Compiled copy at save time; immutable after save. */
  draft: RegexDraft;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export type SaveActionOk = { ok: true; action: SavedAction };
export type SaveActionFail = {
  ok: false;
  reason: "not_regex_draft" | "cap_exceeded" | "stale_preview";
};
export type SaveActionResult = SaveActionOk | SaveActionFail;

/** WUF-90 — rename / delete catalog mutations. */
export type MutateActionOk = { ok: true };
export type MutateActionFail = { ok: false; reason: "not_found" };
export type MutateActionResult = MutateActionOk | MutateActionFail;

/** WUF-91 — Action preview_run on Selection → Patch preview. */
export type PreviewRunOk = {
  ok: true;
  previewId: PreviewId;
  patches: Patch[];
  cost: Cost;
  /** Always absent — Action runs never create Outbound. */
  outbound?: undefined;
};

export type PreviewRunFail = {
  ok: false;
  reason:
    | "empty_selection"
    | "zero_matches"
    | "no_replacement"
    | "not_found"
    | "invalid_selection"
    | "invalid_pattern"
    | "no_pattern";
  guidance: string;
};

export type PreviewRunResult = PreviewRunOk | PreviewRunFail;
