import { randomUUID } from "node:crypto";
import {
  applyAccept as coreApplyAccept,
  bumpRev,
  createBuffer as coreCreateBuffer,
  dropBuffer,
  len as coreLen,
  lineWindow as coreLineWindow,
  rev as coreRev,
  setText as coreSetText,
  slice as coreSlice,
  undo as coreUndo,
  type LineWindow,
} from "./buffer-core.js";
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
  BufferSnapshotOptions,
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
  UndoGroupId,
} from "./types.js";

const DEFAULT_VISIBLE_SAMPLE_CHARS = 4096;
const MODEL_UNAVAILABLE_GUIDANCE =
  "No local model is installed. Install a local model to run AI Intents, or enable a cloud path. Buffer editing and FindBar still work offline.";
const VALIDATION_FAILED_GUIDANCE =
  "Model output failed validation and cannot be Accepted. Edit the Buffer manually, or re-run the Intent.";

/** Metadata only — logical text / revision live in the Rust Buffer core. */
interface BufferState {
  id: BufferId;
  encoding: string;
  eol: Eol;
  bom: boolean;
}

interface UndoGroupRecord {
  id: UndoGroupId;
  bufferId: BufferId;
  revisionBefore: number;
  revisionAfter: number;
  encodingBefore: string;
  eolBefore: Eol;
  bomBefore: boolean;
  encodingAfter: string;
  eolAfter: Eol;
  bomAfter: boolean;
}

function bufferText(id: BufferId): string {
  const n = coreLen(id);
  return n === 0 ? "" : coreSlice(id, 0, n);
}

/**
 * Meta snapshot. Full `text` only when `includeText` — never the silent default
 * (pulling whole Buffer into JS is an explicit opt-in; prefer slice/lineWindow).
 */
function snapshot(
  b: BufferState,
  options: BufferSnapshotOptions = {},
): BufferSnapshot {
  const snap: BufferSnapshot = {
    id: b.id,
    revision: coreRev(b.id),
    encoding: b.encoding,
    eol: b.eol,
    bom: b.bom,
  };
  if (options.includeText === true) {
    snap.text = bufferText(b.id);
  }
  return snap;
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
  textLen: number,
  input: ParseInput,
  sampleChars: number,
): { scope: ResolvedScope; scopeLabel: string } {
  const sel = input.selection;
  if (sel) {
    const r = clampRange(sel.start, sel.end, textLen);
    if (!r) throw new Error("invalid Selection");
    return {
      scope: { kind: "selection", start: r.start, end: r.end },
      scopeLabel: `Selection ${r.start}…${r.end}`,
    };
  }

  const win = input.visibleWindow;
  if (win) {
    const r = clampRange(win.start, win.end, textLen);
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
  const end = Math.min(textLen, Math.max(0, sampleChars));
  return {
    scope: { kind: "visible", start: 0, end, sampled: true },
    scopeLabel: `Visible sample 0…${end}`,
  };
}

function scopeSlice(bufferId: BufferId, scope: ResolvedScope): string {
  if (scope.start === scope.end) return "";
  return coreSlice(bufferId, scope.start, scope.end);
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
 * WUF-97: Accept / reject / Undo delegate text+revision to Rust Buffer core.
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

  createBuffer(
    text = "",
    options: BufferCreateOptions = {},
    snapshotOptions: BufferSnapshotOptions = {},
  ): BufferSnapshot {
    const id = coreCreateBuffer(text);
    const state: BufferState = {
      id,
      encoding: options.encoding ?? "utf-8",
      eol: options.eol ?? "lf",
      bom: options.bom ?? false,
    };
    this.buffers.set(id, state);
    this.mainHistory.set(id, []);
    this.audit.set(id, []);
    return snapshot(state, snapshotOptions);
  }

  getBuffer(
    id: BufferId,
    options: BufferSnapshotOptions = {},
  ): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    return snapshot(b, options);
  }

  /** Core-equivalent slice — does not require holding full Buffer text in JS. */
  slice(id: BufferId, start: number, end: number): string {
    if (!this.buffers.has(id)) throw new Error(`unknown Buffer: ${id}`);
    return coreSlice(id, start, end);
  }

  /** Core-equivalent line window. */
  lineWindow(
    id: BufferId,
    lineStart: number,
    lineCount: number,
  ): LineWindow {
    if (!this.buffers.has(id)) throw new Error(`unknown Buffer: ${id}`);
    return coreLineWindow(id, lineStart, lineCount);
  }

  len(id: BufferId): number {
    if (!this.buffers.has(id)) throw new Error(`unknown Buffer: ${id}`);
    return coreLen(id);
  }

  rev(id: BufferId): number {
    if (!this.buffers.has(id)) throw new Error(`unknown Buffer: ${id}`);
    return coreRev(id);
  }

  /** Direct human edit of logical text (not a Patch Accept). */
  editBuffer(
    id: BufferId,
    text: string,
    options: BufferSnapshotOptions = {},
  ): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    coreSetText(id, text);
    return snapshot(b, options);
  }

  /**
   * Explicit user control of Encoding/EOL/BOM (not a silent model side-effect).
   * Bumps revision so outstanding Patches relocate or void.
   */
  setBufferMeta(
    id: BufferId,
    meta: { encoding?: string; eol?: Eol; bom?: boolean },
    options: BufferSnapshotOptions = {},
  ): BufferSnapshot {
    const b = this.buffers.get(id);
    if (!b) throw new Error(`unknown Buffer: ${id}`);
    if (meta.encoding !== undefined) b.encoding = meta.encoding;
    if (meta.eol !== undefined) b.eol = meta.eol;
    if (meta.bom !== undefined) b.bom = meta.bom;
    bumpRev(id);
    return snapshot(b, options);
  }

  /**
   * Natural language + Buffer (+ optional Selection / visible window) → Intent.
   * Scope defaults to visible sample when no Selection (never silent whole-Buffer).
   */
  parse(input: ParseInput): Intent {
    const buf = this.buffers.get(input.bufferId);
    if (!buf) throw new Error(`unknown Buffer: ${input.bufferId}`);
    const textLen = coreLen(buf.id);
    const { scope, scopeLabel } = resolveScope(
      textLen,
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
   * Model context is Scope-only — never the whole Buffer without Selection.
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

    const scoped = scopeSlice(buf.id, intent.scope);
    const textLen = coreLen(buf.id);
    const revision = coreRev(buf.id);
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
        explanation: buildExplanation(
          bufferText(buf.id),
          intent.scope,
          revision,
        ),
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
    // Pass Scope text only — do not ship whole-Buffer as model context.
    const modelOut = this.modelGateway.transform({
      utterance: intent.utterance,
      scopeText: scoped,
      scope: intent.scope,
      bufferText: scoped,
      bufferRevision: revision,
    });

    const validated = validateModelPatchOutput(
      modelOut.raw,
      intent.scope,
      textLen,
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
      baseRevision: revision,
      edits: validated.edits.map((e) => ({
        start: e.start,
        end: e.end,
        replacement: e.replacement,
        before:
          e.start > 0
            ? coreSlice(buf.id, Math.max(0, e.start - 8), e.start)
            : "",
        after: coreSlice(
          buf.id,
          e.end,
          Math.min(textLen, e.end + 8),
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
   * Register a hand-built patches preview (Action preview_run).
   * Enables IntentService.reject(previewId); Accept still uses accept(patches).
   */
  registerPatchesPreview(utterance = ""): PreviewId {
    const previewId = randomUUID();
    this.outstandingPreviews.set(previewId, {
      kind: "patches",
      utterance,
    });
    return previewId;
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
    return resolveAnchor(bufferText(buf.id), coreRev(buf.id), anchor);
  }

  accept(patches: Patch[]): AcceptResult {
    if (!patches.length) return { ok: false, reason: "invalid" };

    const bufferId = patches[0]!.bufferId;
    if (patches.some((p) => p.bufferId !== bufferId)) {
      return { ok: false, reason: "invalid" };
    }

    const buf = this.buffers.get(bufferId);
    if (!buf) return { ok: false, reason: "invalid" };

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

    const textBefore = bufferText(bufferId);
    const revisionBefore = coreRev(bufferId);
    const encodingBefore = buf.encoding;
    const eolBefore = buf.eol;
    const bomBefore = buf.bom;

    const applied = coreApplyAccept(
      bufferId,
      patches.map((p) => ({
        baseRevision: p.baseRevision,
        edits: p.edits.map((e) => ({
          start: e.start,
          end: e.end,
          replacement: e.replacement,
          before: e.before,
          after: e.after,
        })),
      })),
    );

    if (!applied.ok) {
      return { ok: false, reason: applied.reason };
    }

    buf.encoding = nextEncoding;
    buf.eol = nextEol;
    buf.bom = nextBom;

    const textAfter = bufferText(bufferId);
    const undoGroupId = applied.undoGroupId;
    this.undoGroups.set(undoGroupId, {
      id: undoGroupId,
      bufferId,
      revisionBefore,
      revisionAfter: applied.rev,
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
      bufferRevisionAfter: applied.rev,
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
      coreRev(group.bufferId) !== group.revisionAfter ||
      buf.encoding !== group.encodingAfter ||
      buf.eol !== group.eolAfter ||
      buf.bom !== group.bomAfter
    ) {
      throw new Error("UndoGroup is not at Buffer tip");
    }

    coreUndo(group.bufferId, undoGroupId);
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

  /** Test / lifecycle helper — drop core store entry when Buffer is discarded. */
  disposeBuffer(id: BufferId): void {
    if (!this.buffers.delete(id)) return;
    this.mainHistory.delete(id);
    this.audit.delete(id);
    try {
      dropBuffer(id);
    } catch {
      /* already dropped */
    }
  }
}
