/**
 * Shared flag / replacement helpers for FindBar + RegexDraft.
 *
 * WUF-100: Find *scanning* runs in Rust (`regex` crate) via buffer-core —
 * not ECMAScript RegExp. `compilePcre` remains for draft-side validation /
 * legacy callers only; it is not the Find engine. PCRE lookaround and some
 * backref dialects are known debt (see nova-docs WUF-100 PCRE-DEBT.md).
 */

export interface PcreFlags {
  /** Case-insensitive (`i`). */
  i?: boolean;
  /** Multiline `^`/`$` (`m`). */
  m?: boolean;
  /** Dot matches newline (`s` / DOTALL). */
  s?: boolean;
}

export class PcreCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PcreCompileError";
  }
}

/** Encode flags for the Rust Find engine (`i`/`m`/`s` chars). */
export function flagsToCoreString(flags: PcreFlags = {}): string {
  let s = "";
  if (flags.i) s += "i";
  if (flags.m) s += "m";
  if (flags.s) s += "s";
  return s;
}

/**
 * Compile a pattern with ECMAScript RegExp (draft / legacy only).
 * FindBar scan does **not** use this — see buffer-core findStart.
 */
export function compilePcre(pattern: string, flags: PcreFlags = {}): RegExp {
  let flagStr = "gd";
  if (flags.i) flagStr += "i";
  if (flags.m) flagStr += "m";
  if (flags.s) flagStr += "s";
  try {
    return new RegExp(pattern, flagStr);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PcreCompileError(msg);
  }
}

export interface ReplacementMatch {
  /** Full match text (`$&`). */
  0: string;
  [group: number]: string | undefined;
}

/**
 * Expand a replacement template against one match.
 * Supports `$n`, `\n`, `$&` / `\&`, `$$` / `\\`.
 */
export function expandReplacement(
  template: string,
  match: ReplacementMatch | RegExpMatchArray,
): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch !== "$" && ch !== "\\") {
      out += ch;
      continue;
    }
    const next = template[i + 1];
    if (next === undefined) {
      out += ch;
      continue;
    }
    if (ch === "$" && next === "$") {
      out += "$";
      i++;
      continue;
    }
    if (ch === "\\" && next === "\\") {
      out += "\\";
      i++;
      continue;
    }
    if (next === "&") {
      out += match[0] ?? "";
      i++;
      continue;
    }
    if (next >= "0" && next <= "9") {
      let digits = next;
      i++;
      while (i + 1 < template.length) {
        const d = template[i + 1]!;
        if (d < "0" || d > "9") break;
        digits += d;
        i++;
      }
      const n = Number(digits);
      out += match[n] ?? "";
      continue;
    }
    out += ch;
  }
  return out;
}

/** Build a ReplacementMatch from Find hit groups. */
export function hitToReplacementMatch(
  matchText: string,
  groups: Record<number, string>,
): ReplacementMatch {
  const m: ReplacementMatch = { 0: matchText };
  for (const [k, v] of Object.entries(groups)) {
    m[Number(k)] = v;
  }
  return m;
}
