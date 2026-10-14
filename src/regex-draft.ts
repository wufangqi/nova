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
  if (lower.startsWith("regex")) {
    const rest = trimmed.slice("regex".length).trim();
    if (rest.length === 0) {
      return { pattern: ".*", flags: "g" };
    }
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
