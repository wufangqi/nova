import { IntentService } from "./intent-service.js";
import {
  compilePcre,
  expandReplacement,
  type PcreFlags,
  PcreCompileError,
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
}

export interface FindResult {
  hits: FindHit[];
  count: number;
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

function resolveScope(
  text: string,
  scope: TextScope | undefined,
): { start: number; end: number } | null {
  if (!scope || scope.kind === "buffer") {
    return { start: 0, end: text.length };
  }
  if (
    scope.start < 0 ||
    scope.end < scope.start ||
    scope.end > text.length
  ) {
    return null;
  }
  return { start: scope.start, end: scope.end };
}

function matchInScope(
  fullText: string,
  span: { start: number; end: number },
  pattern: string,
  flags: PcreFlags | undefined,
  onMatch: (m: RegExpMatchArray, start: number, end: number) => void,
): void {
  const haystack = fullText.slice(span.start, span.end);
  const re = compilePcre(pattern, flags);
  for (const m of haystack.matchAll(re)) {
    const localStart = m.index ?? 0;
    const matchText = m[0] ?? "";
    const start = span.start + localStart;
    const end = start + matchText.length;
    onMatch(m, start, end);
    if (matchText.length === 0) {
      re.lastIndex = localStart + 1;
    }
  }
}

/**
 * Deterministic FindBar: PCRE find + replace-over-Scope → Patch.
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

  find(input: FindInput): FindResult {
    const pattern = this.resolvePattern(input);
    if (!pattern) return { hits: [], count: 0 };

    const buf = this.intent.getBuffer(input.bufferId);
    const span = resolveScope(buf.text, input.scope);
    if (!span) return { hits: [], count: 0 };

    const hits: FindHit[] = [];
    matchInScope(
      buf.text,
      span,
      pattern,
      this.resolveFlags(input),
      (m, start, end) => {
        const groups: Record<number, string> = {};
        for (let g = 1; g < m.length; g++) {
          if (m[g] !== undefined) groups[g] = m[g]!;
        }
        hits.push({ start, end, match: m[0] ?? "", groups });
      },
    );
    return { hits, count: hits.length };
  }

  /**
   * Build Patch[] for replace-over-Scope. Does not Accept / mutate Buffer.
   * Pattern/replacement come from input or the loaded RegexDraft.
   */
  previewReplace(input: ReplaceInput): PreviewReplaceResult {
    const pattern = this.resolvePattern(input);
    if (!pattern) return { ok: false, reason: "no_pattern" };

    const buf = this.intent.getBuffer(input.bufferId);
    const span = resolveScope(buf.text, input.scope);
    if (!span) return { ok: false, reason: "invalid_scope" };

    const replacement = this.resolveReplacement(input);
    const edits: TextEdit[] = [];
    try {
      matchInScope(
        buf.text,
        span,
        pattern,
        this.resolveFlags(input),
        (m, start, end) => {
          edits.push({
            start,
            end,
            replacement: expandReplacement(replacement, m),
            before: buf.text.slice(Math.max(0, start - 8), start),
            after: buf.text.slice(end, Math.min(buf.text.length, end + 8)),
          });
        },
      );
    } catch (err) {
      if (err instanceof PcreCompileError) {
        return { ok: false, reason: "invalid_pattern" };
      }
      throw err;
    }
    if (!edits.length) return { ok: false, reason: "no_matches" };

    const patch: Patch = {
      bufferId: buf.id,
      baseRevision: buf.revision,
      edits,
      provenance: { source: "findbar", label: "pcre-replace" },
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
