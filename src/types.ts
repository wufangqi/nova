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
