import { randomUUID } from "node:crypto";
import type {
  AcceptResult,
  BufferCreateOptions,
  BufferId,
  BufferSnapshot,
  Eol,
  MainHistoryEntry,
  Patch,
  ProvenanceAuditEntry,
  TextEdit,
  UndoGroupId,
} from "./types.js";

interface BufferState {
  id: BufferId;
  text: string;
  revision: number;
  encoding: string;
  eol: Eol;
  bom: boolean;
}

interface UndoGroupRecord {
  id: UndoGroupId;
  bufferId: BufferId;
  textBefore: string;
  revisionBefore: number;
  textAfter: string;
  revisionAfter: number;
  encodingBefore: string;
  eolBefore: Eol;
  bomBefore: boolean;
  encodingAfter: string;
  eolAfter: Eol;
  bomAfter: boolean;
}

interface RelocatedEdit {
  start: number;
  end: number;
  replacement: string;
}

function snapshot(b: BufferState): BufferSnapshot {
  return {
    id: b.id,
    text: b.text,
    revision: b.revision,
    encoding: b.encoding,
    eol: b.eol,
    bom: b.bom,
  };
}

/**
 * Relocate a single edit onto current text.
 * Same revision → offsets apply as-is (validated against length).
 * Drifted revision → require exact before/after context match for the old span.
 */
function relocateEdit(
  text: string,
  edit: TextEdit,
  baseRevision: number,
  currentRevision: number,
): RelocatedEdit | null {
  if (edit.start < 0 || edit.end < edit.start) return null;

  if (baseRevision === currentRevision) {
    if (edit.end > text.length) return null;
    return { start: edit.start, end: edit.end, replacement: edit.replacement };
  }

  const before = edit.before ?? "";
  const after = edit.after ?? "";
  const expectedLen = edit.end - edit.start;

  if (before.length === 0 && after.length === 0) {
    return null;
  }

  const candidates: number[] = [];
  if (before.length === 0) {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(after, from);
      if (idx < 0) break;
      const end = idx;
      const start = end - expectedLen;
      if (start >= 0) candidates.push(start);
      from = idx + 1;
    }
  } else {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(before, from);
      if (idx < 0) break;
      const start = idx + before.length;
      const end = start + expectedLen;
      if (end <= text.length) {
        const trail = text.slice(end, end + after.length);
        if (trail === after) candidates.push(start);
      }
      from = idx + 1;
    }
  }

  if (candidates.length !== 1) return null;
  const start = candidates[0]!;
  return {
    start,
    end: start + expectedLen,
    replacement: edit.replacement,
  };
}

/** Apply edits right-to-left so earlier offsets stay valid. */
function applyEdits(text: string, edits: RelocatedEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of ordered) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}

/**
 * IntentService — single Accept write seam for proposal Patches.
 * WUF-70: Buffer + accept / undo / dual-track Provenance.
 * WUF-73: Encoding/EOL/BOM metadata; Accept mutates them only when Patch.metadata is set.
 */
export class IntentService {
  private buffers = new Map<BufferId, BufferState>();
  private undoGroups = new Map<UndoGroupId, UndoGroupRecord>();
  private mainHistory = new Map<BufferId, MainHistoryEntry[]>();
  private audit = new Map<BufferId, ProvenanceAuditEntry[]>();

  createBuffer(text = "", options: BufferCreateOptions = {}): BufferSnapshot {
    const id = randomUUID();
    const state: BufferState = {
      id,
      text,
      revision: 0,
      encoding: options.encoding ?? "utf-8",
      eol: options.eol ?? "lf",
      bom: options.bom ?? false,
    };
    this.buffers.set(id, state);
    this.mainHistory.set(id, []);
    this.audit.set(id, []);
    return snapshot(state);
  }

  getBuffer(id: BufferId): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    return snapshot(b);
  }

  /** Direct human edit of logical text (not a Patch Accept). */
  editBuffer(id: BufferId, text: string): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    b.text = text;
    b.revision += 1;
    return snapshot(b);
  }

  /**
   * Explicit user control of Encoding/EOL/BOM (not a silent model side-effect).
   * Bumps revision so outstanding Patches relocate or void.
   */
  setBufferMeta(
    id: BufferId,
    meta: { encoding?: string; eol?: Eol; bom?: boolean },
  ): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    if (meta.encoding !== undefined) b.encoding = meta.encoding;
    if (meta.eol !== undefined) b.eol = meta.eol;
    if (meta.bom !== undefined) b.bom = meta.bom;
    b.revision += 1;
    return snapshot(b);
  }

  accept(patches: Patch[]): AcceptResult {
    if (!patches.length) return { ok: false, reason: "invalid" };

    const bufferId = patches[0]!.bufferId;
    if (patches.some((p) => p.bufferId !== bufferId)) {
      return { ok: false, reason: "invalid" };
    }

    const buf = this.buffers.get(bufferId);
    if (!buf) return { ok: false, reason: "invalid" };

    const relocated: RelocatedEdit[] = [];
    for (const patch of patches) {
      if (!patch.edits.length) return { ok: false, reason: "invalid" };
      for (const edit of patch.edits) {
        const r = relocateEdit(
          buf.text,
          edit,
          patch.baseRevision,
          buf.revision,
        );
        if (!r) return { ok: false, reason: "reloc_failed" };
        relocated.push(r);
      }
    }

    const sorted = [...relocated].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start < sorted[i - 1]!.end) {
        return { ok: false, reason: "invalid" };
      }
    }

    // Merge explicit metadata from the batch (later Patch wins per field).
    let nextEncoding = buf.encoding;
    let nextEol = buf.eol;
    let nextBom = buf.bom;
    let metaTouched = false;
    for (const patch of patches) {
      const m = patch.metadata;
      if (!m) continue;
      metaTouched = true;
      if (m.encoding !== undefined) nextEncoding = m.encoding;
      if (m.eol !== undefined) nextEol = m.eol;
      if (m.bom !== undefined) nextBom = m.bom;
    }
    // Ordinary Patches without metadata must not alter Encoding/EOL/BOM.
    if (!metaTouched) {
      nextEncoding = buf.encoding;
      nextEol = buf.eol;
      nextBom = buf.bom;
    }

    const textBefore = buf.text;
    const revisionBefore = buf.revision;
    const encodingBefore = buf.encoding;
    const eolBefore = buf.eol;
    const bomBefore = buf.bom;
    const textAfter = applyEdits(buf.text, relocated);

    buf.text = textAfter;
    buf.encoding = nextEncoding;
    buf.eol = nextEol;
    buf.bom = nextBom;
    buf.revision += 1;

    const undoGroupId = randomUUID();
    this.undoGroups.set(undoGroupId, {
      id: undoGroupId,
      bufferId,
      textBefore,
      revisionBefore,
      textAfter,
      revisionAfter: buf.revision,
      encodingBefore,
      eolBefore,
      bomBefore,
      encodingAfter: buf.encoding,
      eolAfter: buf.eol,
      bomAfter: buf.bom,
    });

    const mainEntry: MainHistoryEntry = {
      undoGroupId,
      committedBy: "user",
      bufferRevisionAfter: buf.revision,
      textAfter,
    };
    this.mainHistory.get(bufferId)!.push(mainEntry);

    for (const patch of patches) {
      this.audit.get(bufferId)!.push({
        undoGroupId,
        committedBy: "user",
        originalProvenance: patch.provenance,
        intentId: patch.intentId,
        bufferId,
        textBefore,
        textAfter,
      });
    }

    return { ok: true, undoGroupId };
  }

  undo(undoGroupId: UndoGroupId): void {
    const group = this.undoGroups.get(undoGroupId);
    if (!group) throw new Error(`unknown UndoGroup: ${undoGroupId}`);
    const buf = this.buffers.get(group.bufferId);
    if (!buf) throw new Error(`unknown Buffer: ${group.bufferId}`);

    if (
      buf.text !== group.textAfter ||
      buf.revision !== group.revisionAfter ||
      buf.encoding !== group.encodingAfter ||
      buf.eol !== group.eolAfter ||
      buf.bom !== group.bomAfter
    ) {
      throw new Error("UndoGroup is not at Buffer tip");
    }

    buf.text = group.textBefore;
    buf.revision = group.revisionBefore;
    buf.encoding = group.encodingBefore;
    buf.eol = group.eolBefore;
    buf.bom = group.bomBefore;
    this.undoGroups.delete(undoGroupId);

    const main = this.mainHistory.get(group.bufferId)!;
    const idx = main.findIndex((e) => e.undoGroupId === undoGroupId);
    if (idx >= 0) main.splice(idx, 1);
  }

  getMainHistory(bufferId: BufferId): MainHistoryEntry[] {
    const h = this.mainHistory.get(bufferId);
    if (!h) throw new Error(`unknown Buffer: ${bufferId}`);
    return [...h];
  }

  getProvenanceAudit(bufferId: BufferId): ProvenanceAuditEntry[] {
    const a = this.audit.get(bufferId);
    if (!a) throw new Error(`unknown Buffer: ${bufferId}`);
    return [...a];
  }
}
