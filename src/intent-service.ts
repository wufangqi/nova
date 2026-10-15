import { randomUUID } from "node:crypto";
import {
  buildExplanation,
  isExplainUtterance,
  resolveAnchor,
} from "./explanation.js";
import {
  LocalModelGateway,
  validateModelPatchOutput,
  type ModelGateway,
} from "./model-gateway.js";
import {
  buildRegexDraft,
  isRegexDraftUtterance,
} from "./regex-draft.js";
import type {
  AcceptResult,
  AnchorResolveResult,
  BufferCreateOptions,
  BufferId,
  BufferSnapshot,
  Cost,
  Eol,
  ExplanationAnchor,
  Intent,
  IntentServiceOptions,
  MainHistoryEntry,
  Outbound,
  OutstandingPreviewRecord,
  ParseInput,
  Patch,
  PreviewId,
  PreviewResult,
  ProvenanceAuditEntry,
  RegexDraft,
  ResolvedScope,
  TextEdit,
  UndoGroupId,
} from "./types.js";

const DEFAULT_VISIBLE_SAMPLE_CHARS = 4096;
const MODEL_UNAVAILABLE_GUIDANCE =
  "No local model is installed. Install a local model to run AI Intents, or enable a cloud path. Buffer editing and FindBar still work offline.";
const VALIDATION_FAILED_GUIDANCE =
  "Model output failed validation and cannot be Accepted. Edit the Buffer manually, or re-run the Intent.";

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

function clampRange(
  start: number,
  end: number,
  length: number,
): { start: number; end: number } | null {
  if (start < 0 || end < start || end > length) return null;
  return { start, end };
}

function resolveScope(
  text: string,
  input: ParseInput,
  sampleChars: number,
): { scope: ResolvedScope; scopeLabel: string } {
  const sel = input.selection;
  if (sel) {
    const r = clampRange(sel.start, sel.end, text.length);
    if (!r) throw new Error("invalid Selection");
    return {
      scope: { kind: "selection", start: r.start, end: r.end },
      scopeLabel: `Selection ${r.start}…${r.end}`,
    };
  }

  const win = input.visibleWindow;
  if (win) {
    const r = clampRange(win.start, win.end, text.length);
    if (!r) throw new Error("invalid visible window");
    return {
      scope: {
        kind: "visible",
        start: r.start,
        end: r.end,
        sampled: false,
      },
      scopeLabel: `Visible window ${r.start}…${r.end}`,
    };
  }

  // Default: visible sample — never silently the whole Buffer for large text.
  const end = Math.min(text.length, Math.max(0, sampleChars));
  return {
    scope: { kind: "visible", start: 0, end, sampled: true },
    scopeLabel: `Visible sample 0…${end}`,
  };
}

function scopeSlice(text: string, scope: ResolvedScope): string {
  return text.slice(scope.start, scope.end);
}

/**
 * IntentService — single Accept write seam for proposal Patches.
 * WUF-70: Buffer + accept / undo / dual-track Provenance.
 * WUF-73: Encoding/EOL/BOM metadata; Accept mutates them only when Patch.metadata is set.
 * WUF-74: parse / preview / reject (Cost, Scope, Outbound, no-model guidance).
 * WUF-75: transform Intents via model gateway + deterministic validator.
 * WUF-76: Explanation previews + safe anchor resolve (no Buffer mutation).
 * WUF-77: NL → RegexDraft (FindBar fill only; replace is an explicit later step).
 * WUF-89: outstanding preview records for Action save eligibility.
 */
export class IntentService {
  private buffers = new Map<BufferId, BufferState>();
  private undoGroups = new Map<UndoGroupId, UndoGroupRecord>();
  private mainHistory = new Map<BufferId, MainHistoryEntry[]>();
  private audit = new Map<BufferId, ProvenanceAuditEntry[]>();
  private outstandingPreviews = new Map<PreviewId, OutstandingPreviewRecord>();
  private readonly modelAvailable: boolean;
  private cloudEnabled: boolean;
  private readonly visibleSampleChars: number;
  private readonly modelGateway: ModelGateway;

  constructor(options: IntentServiceOptions = {}) {
    this.modelAvailable = options.modelAvailable ?? true;
    this.cloudEnabled = options.cloudEnabled ?? false;
    this.visibleSampleChars =
      options.visibleSampleChars ?? DEFAULT_VISIBLE_SAMPLE_CHARS;
    this.modelGateway =
      (options.modelGateway as ModelGateway | undefined) ??
      new LocalModelGateway();
  }

  /** Session toggle: when true, previews surface Outbound (cloud path). */
  setCloudEnabled(enabled: boolean): void {
    this.cloudEnabled = enabled;
  }

  getCloudEnabled(): boolean {
    return this.cloudEnabled;
  }

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

  /**
   * Natural language + Buffer (+ optional Selection / visible window) → Intent.
   * Scope defaults to visible sample when no Selection (never silent whole-Buffer).
   */
  parse(input: ParseInput): Intent {
    const buf = this.buffers.get(input.bufferId);
    if (!buf) throw new Error(`unknown Buffer: ${input.bufferId}`);
    const { scope, scopeLabel } = resolveScope(
      buf.text,
      input,
      this.visibleSampleChars,
    );
    return {
      id: randomUUID(),
      bufferId: buf.id,
      utterance: input.utterance,
      scope,
      scopeLabel,
    };
  }

  /**
   * Preview: transform Intents go through model gateway + validator.
   * Cost always present on success; Outbound when cloudEnabled.
   * Missing local model ⇒ structured error with install guidance (ADR-0003).
   * Invalid model output ⇒ validation_failed (manual edit exit; never Acceptable).
   */
  preview(intent: Intent): PreviewResult {
    const buf = this.buffers.get(intent.bufferId);
    if (!buf) throw new Error(`unknown Buffer: ${intent.bufferId}`);

    if (!this.modelAvailable) {
      return {
        kind: "error",
        reason: "model_unavailable",
        guidance: MODEL_UNAVAILABLE_GUIDANCE,
      };
    }

    const scoped = scopeSlice(buf.text, intent.scope);
    const previewId = randomUUID();

    // Cloud path: noticeability even when a local gateway is injected for tests.
    const outbound: Outbound[] | undefined = this.cloudEnabled
      ? [
          {
            task: "transform",
            text: scoped,
            destination: "cloud",
          },
        ]
      : undefined;

    const cost: Cost = {
      latencyMsEstimate: this.cloudEnabled ? 400 : 40,
      tokensEstimate: Math.max(1, Math.ceil(scoped.length / 4)),
      hasOutbound: Boolean(outbound?.length),
    };

    if (isExplainUtterance(intent.utterance)) {
      // Read-only Explanation — never mutates Buffer; Accept is not used.
      this.outstandingPreviews.set(previewId, {
        kind: "explanation",
        utterance: intent.utterance,
      });
      return {
        kind: "explanation",
        previewId,
        explanation: buildExplanation(buf.text, intent.scope, buf.revision),
        cost: {
          ...cost,
          // Explanations are lighter than transforms.
          latencyMsEstimate: this.cloudEnabled ? 300 : 20,
        },
        outbound: outbound
          ? outbound.map((o) => ({ ...o, task: "explain" }))
          : undefined,
      };
    }

    if (isRegexDraftUtterance(intent.utterance)) {
      // RegexDraft only populates FindBar — never Accepts into Buffer text.
      const draft: RegexDraft = buildRegexDraft(intent.utterance);
      this.outstandingPreviews.set(previewId, {
        kind: "regex_draft",
        utterance: intent.utterance,
        draft: { ...draft },
      });
      return {
        kind: "regex_draft",
        previewId,
        draft,
        cost: {
          ...cost,
          latencyMsEstimate: this.cloudEnabled ? 280 : 15,
        },
        outbound: outbound
          ? outbound.map((o) => ({ ...o, task: "regex_draft" }))
          : undefined,
      };
    }

    // Transform path: real/local model → validate → Patch preview.
    const modelOut = this.modelGateway.transform({
      utterance: intent.utterance,
      scopeText: scoped,
      scope: intent.scope,
      bufferText: buf.text,
      bufferRevision: buf.revision,
    });

    const validated = validateModelPatchOutput(
      modelOut.raw,
      intent.scope,
      buf.text.length,
    );
    if (!validated.ok) {
      return {
        kind: "error",
        reason: "validation_failed",
        guidance: VALIDATION_FAILED_GUIDANCE,
        manualEditOk: true,
      };
    }

    const patch: Patch = {
      bufferId: buf.id,
      baseRevision: buf.revision,
      edits: validated.edits.map((e) => ({
        start: e.start,
        end: e.end,
        replacement: e.replacement,
        before:
          e.start > 0
            ? buf.text.slice(Math.max(0, e.start - 8), e.start)
            : "",
        after: buf.text.slice(
          e.end,
          Math.min(buf.text.length, e.end + 8),
        ),
      })),
      provenance: {
        source: "ai",
        label: this.modelGateway.id,
      },
      intentId: intent.id,
    };

    this.outstandingPreviews.set(previewId, {
      kind: "patches",
      utterance: intent.utterance,
    });
    return {
      kind: "patches",
      previewId,
      patches: [patch],
      cost,
      outbound,
    };
  }

  /** Discard an outstanding preview; Buffer is never mutated. */
  reject(previewId: PreviewId): void {
    this.outstandingPreviews.delete(previewId);
  }

  /**
   * Lookup for Action save eligibility (WUF-89).
   * Absent after reject or unknown id ⇒ caller treats as stale_preview.
   */
  getOutstandingPreview(
    previewId: PreviewId,
  ): OutstandingPreviewRecord | undefined {
    return this.outstandingPreviews.get(previewId);
  }

  /**
   * Jump target for an Explanation anchor against the current Buffer.
   * Valid ⇒ offsets to jump to. Invalid ⇒ distinguishable; never a wrong jump.
   */
  resolveExplanationAnchor(
    bufferId: BufferId,
    anchor: ExplanationAnchor,
  ): AnchorResolveResult {
    const buf = this.buffers.get(bufferId);
    if (!buf) {
      return { ok: false, status: "invalid", reason: "unknown" };
    }
    return resolveAnchor(buf.text, buf.revision, anchor);
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
