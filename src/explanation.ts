/**
 * Explanation builders + anchor relocate (WUF-76).
 * Read-only: never mutates Buffer. Jump only when uniquely relocatable.
 */
import { randomUUID } from "node:crypto";
import type {
  AnchorResolveResult,
  Explanation,
  ExplanationAnchor,
  ResolvedScope,
  Revision,
} from "./types.js";

const PROBLEM_LINE =
  /\b(error|fail(?:ed|ure)?|exception|warn(?:ing)?|fatal)\b/i;

export function isExplainUtterance(utterance: string): boolean {
  const u = utterance.trim().toLowerCase();
  return (
    u.startsWith("explain") ||
    u.startsWith("what is") ||
    u.startsWith("what's") ||
    u.startsWith("summarize") ||
    u.startsWith("summary") ||
    u.startsWith("解释") ||
    u.includes("explain ")
  );
}

/**
 * Build a deterministic Explanation for Scope text.
 * Prefer problem-looking lines as anchors; else one Scope-wide (or first line) anchor.
 */
export function buildExplanation(
  bufferText: string,
  scope: ResolvedScope,
  baseRevision: Revision,
): Explanation {
  const scoped = bufferText.slice(scope.start, scope.end);
  const anchors: ExplanationAnchor[] = [];

  let lineStart = 0;
  const relativeLines = scoped.split("\n");
  for (const line of relativeLines) {
    const absStart = scope.start + lineStart;
    const absEnd = absStart + line.length;
    if (PROBLEM_LINE.test(line)) {
      anchors.push(
        makeAnchor(absStart, absEnd, line, `problem: ${line.trim()}`, baseRevision),
      );
    }
    lineStart += line.length + 1; // +1 for '\n' (last line may not have it; ok)
  }

  if (anchors.length === 0 && scoped.length > 0) {
    // Prefer first non-empty line; fall back to whole Scope.
    const first = relativeLines.find((l) => l.trim().length > 0) ?? scoped;
    const idx = scoped.indexOf(first);
    const absStart = scope.start + Math.max(0, idx);
    const absEnd = absStart + first.length;
    anchors.push(
      makeAnchor(
        absStart,
        absEnd,
        bufferText.slice(absStart, absEnd),
        "scope",
        baseRevision,
      ),
    );
  }

  const problemCount = anchors.filter((a) => a.note.startsWith("problem:")).length;
  const summary =
    problemCount > 0
      ? `Found ${problemCount} problem-looking span(s) in Scope (${scoped.length} chars).`
      : `Explanation of ${scoped.length} chars in Scope.`;

  return { summary, anchors };
}

function makeAnchor(
  start: number,
  end: number,
  excerpt: string,
  note: string,
  baseRevision: Revision,
): ExplanationAnchor {
  return {
    id: randomUUID(),
    start,
    end,
    note,
    excerpt,
    baseRevision,
  };
}

/**
 * Resolve an Explanation anchor against current Buffer text.
 * Same revision + matching excerpt ⇒ jump.
 * Drifted revision ⇒ unique excerpt match ⇒ relocate; else invalid (no wrong jump).
 */
export function resolveAnchor(
  bufferText: string,
  bufferRevision: Revision,
  anchor: ExplanationAnchor,
): AnchorResolveResult {
  if (anchor.start < 0 || anchor.end < anchor.start) {
    return { ok: false, status: "invalid", reason: "stale" };
  }

  if (bufferRevision === anchor.baseRevision) {
    if (anchor.end > bufferText.length) {
      return { ok: false, status: "invalid", reason: "stale" };
    }
    const slice = bufferText.slice(anchor.start, anchor.end);
    if (slice !== anchor.excerpt) {
      return { ok: false, status: "invalid", reason: "stale" };
    }
    return {
      ok: true,
      status: "valid",
      start: anchor.start,
      end: anchor.end,
    };
  }

  // Revision drifted — relocate only on a unique exact excerpt match.
  if (anchor.excerpt.length === 0) {
    return { ok: false, status: "invalid", reason: "reloc_failed" };
  }

  const hits: number[] = [];
  let from = 0;
  while (from <= bufferText.length) {
    const idx = bufferText.indexOf(anchor.excerpt, from);
    if (idx < 0) break;
    hits.push(idx);
    from = idx + 1;
  }

  if (hits.length !== 1) {
    return { ok: false, status: "invalid", reason: "reloc_failed" };
  }

  const start = hits[0]!;
  return {
    ok: true,
    status: "valid",
    start,
    end: start + anchor.excerpt.length,
  };
}
