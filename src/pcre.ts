/**
 * PCRE-flavored compile / replace helpers for FindBar.
 * Engine: ECMAScript RegExp (lookaround, named groups, unicode) — the shared
 * dialect FindBar and future RegexDraft populate. True libpcre can swap later
 * behind this seam without changing callers.
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

/** Compile a PCRE-style pattern string into a global RegExp with match indices. */
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

/**
 * Expand a PCRE/JS-style replacement template against one match.
 * Supports `$n`, `\n`, `$&` / `\&`, `$$` / `\\`.
 */
export function expandReplacement(
  template: string,
  match: RegExpMatchArray,
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
