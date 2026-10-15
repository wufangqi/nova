import {
  findAwait,
  findStart,
  len as coreLen,
  rev as coreRev,
  slice as coreSlice,
  type FindHitCore,
  type FindProgress,
} from "./buffer-core.js";
import { IntentService } from "./intent-service.js";
import {
  expandReplacement,
  flagsToCoreString,
  hitToReplacementMatch,
  type PcreFlags,
} from "./pcre.js";
import {
  draftFlagsString,
  flagsFromDraft,
} from "./regex-draft.js";
import type {
  AcceptResult,
  BufferId,
  Patch,
  RegexDraft,
  TextEdit,
} from "./types.js";

/** Text range FindBar / Intent operate over. */
export type TextScope =
  | { kind: "buffer" }
  | { kind: "range"; start: number; end: number };

export interface FindHit {
  start: number;
  end: number;
  match: string;
  /** Capture groups (index 1…); empty when none. */
  groups: Record<number, string>;
  /** 0-based line index in the Buffer (from core). */
  line: number;
  /** 0-based character column (from core). */
  column: number;
}

export interface FindResult {
  hits: FindHit[];
  count: number;
  /** Present when the core job ended as cancelled (distinct from count 0). */
  cancelled?: boolean;
  /** Present when the core rejected the pattern (e.g. lookaround / PCRE debt). */
  error?: string;
}

export type PreviewReplaceOk = { ok: true; patches: Patch[] };
export type PreviewReplaceFail = {
  ok: false;
  reason: "invalid_pattern" | "no_matches" | "invalid_scope" | "no_pattern";
};
export type PreviewReplaceResult = PreviewReplaceOk | PreviewReplaceFail;

export interface FindInput {
  bufferId: BufferId;
  /** When omitted, uses the draft loaded via `applyDraft` / setters. */
  pattern?: string;
  scope?: TextScope;
  flags?: PcreFlags;
}

export interface ReplaceInput extends FindInput {
  /** When omitted, uses the loaded draft replacement. */
  replacement?: string;
}

function resolveScopeBounds(
  textLen: number,
  scope: TextScope | undefined,
): { start: number; end: number } | null {
  if (!scope || scope.kind === "buffer") {
    return { start: 0, end: textLen };
  }
  if (
    scope.start < 0 ||
    scope.end < scope.start ||
    scope.end > textLen
  ) {
    return null;
  }
  return { start: scope.start, end: scope.end };
}

function coreHitToFindHit(h: FindHitCore): FindHit {
  const groups: Record<number, string> = {};
  for (const c of h.captures ?? []) {
    groups[c.index] = c.text;
  }
  return {
    start: h.start,
    end: h.end,
    match: h.matchText,
    groups,
    line: h.line,
    column: h.column,
  };
}

function progressToFindResult(progress: FindProgress): FindResult {
  if (progress.status === "cancelled") {
    return {
      hits: progress.hits.map(coreHitToFindHit),
      count: progress.count,
      cancelled: true,
    };
  }
  if (progress.status === "error") {
    return {
      hits: [],
      count: 0,
      error: progress.error ?? "invalid_pattern",
    };
  }
  return {
    hits: progress.hits.map(coreHitToFindHit),
    count: progress.count,
  };
}

/**
 * Deterministic FindBar: core-side Rust `regex` find + replace-over-Scope → Patch.
 * Writes only through IntentService.accept — never mutates Buffer itself.
 * RegexDraft (WUF-77) populates this surface; replace is an explicit second step.
 */
export class FindBar {
  private pattern = "";
  private replacement = "";
  private flags: PcreFlags = {};

  constructor(private readonly intent: IntentService) {}

  /** Fill FindBar from an Intent RegexDraft. Does not touch Buffer. */
  applyDraft(draft: RegexDraft): void {
    this.pattern = draft.pattern;
    this.replacement = draft.replacement ?? "";
    const parsed = flagsFromDraft(draft.flags);
    this.flags = { i: parsed.i, m: parsed.m, s: parsed.s };
  }

  /** Current FindBar fields as a RegexDraft (shared surface with Intent preview). */
  getDraft(): RegexDraft {
    return {
      pattern: this.pattern,
      replacement: this.replacement || undefined,
      flags: draftFlagsString(this.flags),
    };
  }

  /** User refine after NL fill — pattern only. */
  setPattern(pattern: string): void {
    this.pattern = pattern;
  }

  setReplacement(replacement: string): void {
    this.replacement = replacement;
  }

  setFlags(flags: PcreFlags): void {
    this.flags = { ...flags };
  }

  private resolvePattern(input: FindInput): string | null {
    const p = input.pattern ?? this.pattern;
    return p.length > 0 ? p : null;
  }

  private resolveFlags(input: FindInput): PcreFlags {
    return input.flags ?? this.flags;
  }

  private resolveReplacement(input: ReplaceInput): string {
    return input.replacement ?? this.replacement;
  }

  private runCoreFind(input: FindInput): FindResult {
    const pattern = this.resolvePattern(input);
    if (!pattern) return { hits: [], count: 0 };

    const textLen = coreLen(input.bufferId);
    const span = resolveScopeBounds(textLen, input.scope);
    if (!span) return { hits: [], count: 0 };

    const flags = flagsToCoreString(this.resolveFlags(input));
    const jobId = findStart(input.bufferId, {
      pattern,
      ...(flags ? { flags } : {}),
      start: span.start,
      end: span.end,
    });
    return progressToFindResult(findAwait(jobId));
  }

  find(input: FindInput): FindResult {
    return this.runCoreFind(input);
  }

  /**
   * Build Patch[] for replace-over-Scope. Does not Accept / mutate Buffer.
   * Pattern/replacement come from input or the loaded RegexDraft.
   * Hits come from the Rust Find engine (same as `find`).
   */
  previewReplace(input: ReplaceInput): PreviewReplaceResult {
    const pattern = this.resolvePattern(input);
    if (!pattern) return { ok: false, reason: "no_pattern" };

    const textLen = coreLen(input.bufferId);
    const span = resolveScopeBounds(textLen, input.scope);
    if (!span) return { ok: false, reason: "invalid_scope" };

    const found = this.runCoreFind(input);
    if (found.error) return { ok: false, reason: "invalid_pattern" };
    if (found.cancelled) return { ok: false, reason: "no_matches" };
    if (!found.hits.length) return { ok: false, reason: "no_matches" };

    const replacement = this.resolveReplacement(input);
    const revision = coreRev(input.bufferId);
    const edits: TextEdit[] = found.hits.map((hit) => {
      const beforeStart = Math.max(0, hit.start - 8);
      const afterEnd = Math.min(textLen, hit.end + 8);
      return {
        start: hit.start,
        end: hit.end,
        replacement: expandReplacement(
          replacement,
          hitToReplacementMatch(hit.match, hit.groups),
        ),
        before: coreSlice(input.bufferId, beforeStart, hit.start),
        after: coreSlice(input.bufferId, hit.end, afterEnd),
      };
    });

    const patch: Patch = {
      bufferId: input.bufferId,
      baseRevision: revision,
      edits,
      provenance: { source: "findbar", label: "regex-replace" },
    };
    return { ok: true, patches: [patch] };
  }

  /** previewReplace then IntentService.accept — single UndoGroup on success. */
  replaceAccept(input: ReplaceInput): AcceptResult {
    const preview = this.previewReplace(input);
    if (!preview.ok) {
      return { ok: false, reason: "invalid" };
    }
    return this.intent.accept(preview.patches);
  }
}
