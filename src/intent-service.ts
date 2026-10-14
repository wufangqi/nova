import { randomUUID } from "node:crypto";
import type {
  AcceptResult,
  BufferId,
  BufferSnapshot,
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
  eol: "lf" | "crlf" | "cr";
}

interface UndoGroupRecord {
  id: UndoGroupId;
  bufferId: BufferId;
  textBefore: string;
  revisionBefore: number;
  textAfter: string;
  revisionAfter: number;
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

  // Search for before + oldSpan + after. Without the original span content we
  // only know its length — require unique before/after framing to be safe.
  // Prefer: find `before` then verify `after` at before.length + expectedLen.
  if (before.length === 0 && after.length === 0) {
    // No anchors → cannot safely relocate across revisions.
    return null;
  }

  const candidates: number[] = [];
  if (before.length === 0) {
    // Match by trailing `after` only: end of span sits just before `after`.
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
 * WUF-70 covers Buffer + accept / undo / dual-track Provenance.
 * parse / preview arrive in later Work tickets.
 */
export class IntentService {
  private buffers = new Map<BufferId, BufferState>();
  private undoGroups = new Map<UndoGroupId, UndoGroupRecord>();
  private mainHistory = new Map<BufferId, MainHistoryEntry[]>();
  private audit = new Map<BufferId, ProvenanceAuditEntry[]>();

  createBuffer(text = ""): BufferSnapshot {
    const id = randomUUID();
    const state: BufferState = {
      id,
      text,
      revision: 0,
      encoding: "utf-8",
      eol: "lf",
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

    // Overlap check on relocated spans (whole batch or nothing).
    const sorted = [...relocated].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.start < sorted[i - 1]!.end) {
        return { ok: false, reason: "invalid" };
      }
    }

    const textBefore = buf.text;
    const revisionBefore = buf.revision;
    const textAfter = applyEdits(buf.text, relocated);

    buf.text = textAfter;
    buf.revision += 1;

    const undoGroupId = randomUUID();
    this.undoGroups.set(undoGroupId, {
      id: undoGroupId,
      bufferId,
      textBefore,
      revisionBefore,
      textAfter,
      revisionAfter: buf.revision,
    });

    const mainEntry: MainHistoryEntry = {
      undoGroupId,
      committedBy: "user",
      bufferRevisionAfter: buf.revision,
      textAfter,
    };
    this.mainHistory.get(bufferId)!.push(mainEntry);

    // One audit row per Patch in the batch (preserves each original Provenance).
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

    // Only the tip UndoGroup may be undone (M2: one step back to pre-Accept).
    if (buf.text !== group.textAfter || buf.revision !== group.revisionAfter) {
      throw new Error("UndoGroup is not at Buffer tip");
    }

    buf.text = group.textBefore;
    buf.revision = group.revisionBefore;
    this.undoGroups.delete(undoGroupId);

    const main = this.mainHistory.get(group.bufferId)!;
    const idx = main.findIndex((e) => e.undoGroupId === undoGroupId);
    if (idx >= 0) main.splice(idx, 1);
    // Audit side-car is retained for metrics even after undo.
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
