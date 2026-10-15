/**
 * NL → RegexDraft helpers (WUF-77).
 * Drafts only populate FindBar; they never write Buffer text.
 * Patterns share the FindBar PCRE dialect (`compilePcre`).
 */
import type { RegexDraft } from "./types.js";
import type { PcreFlags } from "./pcre.js";

export function isRegexDraftUtterance(utterance: string): boolean {
  const u = utterance.trim().toLowerCase();
  return (
    u.startsWith("regex ") ||
    u.startsWith("regex/") ||
    u === "regex" ||
    u.startsWith("write a regex") ||
    u.startsWith("write regex") ||
    u.startsWith("make a regex") ||
    u.startsWith("regex for") ||
    u.startsWith("match ") ||
    u.startsWith("find pattern") ||
    u.startsWith("写正则") ||
    u.startsWith("写一个正则") ||
    u.startsWith("匹配")
  );
}

/**
 * Deterministic NL → RegexDraft (local stub; no Buffer mutation).
 * - `regex <pattern>` / `regex /pattern/flags` → literal pattern
 * - phrase templates → a small library of common patterns
 */
export function buildRegexDraft(utterance: string): RegexDraft {
  const trimmed = utterance.trim();
  const lower = trimmed.toLowerCase();

  // Explicit: regex <pattern>  or  regex /pattern/flags
  // or sed-style replace: regex s/pattern/replacement/flags (Action Demo path)
  if (lower.startsWith("regex")) {
    const rest = trimmed.slice("regex".length).trim();
    if (rest.length === 0) {
      return { pattern: ".*", flags: "g" };
    }
    const sed = parseSedReplace(rest);
    if (sed) return sed;
    const slash = parseSlashPattern(rest);
    if (slash) return slash;
    return { pattern: rest, flags: "g" };
  }

  // Chinese: 写正则 … / 匹配 …
  if (lower.startsWith("写正则") || lower.startsWith("写一个正则")) {
    const rest = trimmed.replace(/^写(?:一个)?正则\s*/u, "").trim();
    if (rest.length > 0) {
      const slash = parseSlashPattern(rest);
      if (slash) return slash;
      return { pattern: rest, flags: "g" };
    }
  }

  return { pattern: patternFromPhrase(lower), flags: "g" };
}

function parseSlashPattern(rest: string): RegexDraft | null {
  if (!rest.startsWith("/")) return null;
  const end = rest.lastIndexOf("/");
  if (end <= 0) return null;
  const pattern = rest.slice(1, end);
  const flags = rest.slice(end + 1) || "g";
  return { pattern, flags: flags.includes("g") ? flags : `${flags}g` };
}

/**
 * Sed-style `s/pattern/replacement/flags` → RegexDraft with replacement.
 * Enables Intent → save Action → preview_run → Accept without FindBar edit.
 */
function parseSedReplace(rest: string): RegexDraft | null {
  const body = rest.trim();
  if (!/^s\//i.test(body)) return null;
  const afterS = body.slice(2); // drop leading s/
  const patEnd = afterS.indexOf("/");
  if (patEnd < 0) return null;
  const pattern = afterS.slice(0, patEnd);
  const afterPat = afterS.slice(patEnd + 1);
  const replEnd = afterPat.indexOf("/");
  if (replEnd < 0) {
    // s/pat/repl — no trailing flags
    if (afterPat.length === 0) return null;
    return { pattern, replacement: afterPat, flags: "g" };
  }
  const replacement = afterPat.slice(0, replEnd);
  const flagsRaw = afterPat.slice(replEnd + 1);
  const flags = flagsRaw.length === 0 ? "g" : flagsRaw.includes("g") ? flagsRaw : `${flagsRaw}g`;
  return { pattern, replacement, flags };
}

function patternFromPhrase(lower: string): string {
  if (
    lower.includes("email") ||
    lower.includes("e-mail") ||
    lower.includes("邮箱") ||
    lower.includes("邮件")
  ) {
    return "[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}";
  }
  if (
    lower.includes("digit") ||
    lower.includes("number") ||
    lower.includes("数字") ||
    lower.includes("\\d")
  ) {
    return "\\d+";
  }
  if (lower.includes("word") || lower.includes("单词")) {
    return "\\w+";
  }
  if (lower.includes("whitespace") || lower.includes("空白")) {
    return "\\s+";
  }
  if (lower.startsWith("match ")) {
    const target = lower.slice("match ".length).trim();
    if (target.length > 0 && !/\s/.test(target)) {
      return escapeLiteral(target);
    }
  }
  if (lower.startsWith("匹配")) {
    const target = lower.slice("匹配".length).trim();
    if (target.length > 0 && !/\s/.test(target)) {
      return escapeLiteral(target);
    }
  }
  // Fallback: match any non-empty run — user can refine in FindBar.
  return ".+";
}

function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse RegexDraft.flags string into FindBar PcreFlags (+ track global). */
export function flagsFromDraft(flags?: string): PcreFlags & { g?: boolean } {
  const f = flags ?? "g";
  return {
    i: f.includes("i"),
    m: f.includes("m"),
    s: f.includes("s"),
    g: f.includes("g") || f.length === 0,
  };
}

export function draftFlagsString(
  flags: PcreFlags & { g?: boolean },
): string {
  let out = "";
  if (flags.g !== false) out += "g";
  if (flags.i) out += "i";
  if (flags.m) out += "m";
  if (flags.s) out += "s";
  return out || "g";
}
