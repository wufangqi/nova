/**
 * Byte ↔ logical-text codec for Buffer Encoding / EOL / BOM metadata.
 * Logical text in memory is Unicode (LF newlines); Path IO uses these helpers.
 */

import type { Eol } from "./types.js";

export type EncodingLabel =
  | "utf-8"
  | "utf-16le"
  | "utf-16be"
  | "gbk"
  | "gb18030"
  | "windows-1252"
  | "latin1";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

/** Map our Encoding labels to WHATWG / Node TextDecoder labels. */
function decoderLabel(encoding: string): string {
  switch (encoding) {
    case "utf-8":
    case "utf-16le":
    case "utf-16be":
    case "gbk":
    case "gb18030":
    case "windows-1252":
    case "latin1":
      return encoding;
    default:
      return encoding;
  }
}

export function detectBom(
  bytes: Uint8Array,
): { encoding: EncodingLabel; bomLength: number } | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return { encoding: "utf-8", bomLength: 3 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", bomLength: 2 };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", bomLength: 2 };
  }
  return null;
}

export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\r" && text[i + 1] === "\n") {
      crlf += 1;
      i += 1;
    } else if (c === "\n") {
      lf += 1;
    } else if (c === "\r") {
      cr += 1;
    }
  }
  if (crlf >= lf && crlf >= cr && crlf > 0) return "crlf";
  if (cr > lf && cr > 0) return "cr";
  return "lf";
}

/** Normalize logical text newlines to the Buffer's EOL convention. */
export function applyEol(text: string, eol: Eol): string {
  const unified = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (eol === "lf") return unified;
  if (eol === "crlf") return unified.replace(/\n/g, "\r\n");
  return unified.replace(/\n/g, "\r");
}

/** Strip CR so in-memory editing can use a single newline form. */
export function toLogicalNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export interface DecodedFile {
  text: string;
  encoding: EncodingLabel;
  eol: Eol;
  bom: boolean;
}

/**
 * Decode Path bytes into logical Unicode text + Encoding/EOL/BOM metadata.
 * Heuristic: BOM → preferred → utf-8 strict → gbk (high bytes) → windows-1252.
 */
export function decodeBytes(
  bytes: Uint8Array,
  preferred?: EncodingLabel,
): DecodedFile {
  const bom = detectBom(bytes);
  if (bom) {
    const body = bytes.subarray(bom.bomLength);
    const text = new TextDecoder(decoderLabel(bom.encoding)).decode(body);
    return {
      text: toLogicalNewlines(text),
      encoding: bom.encoding,
      eol: detectEol(text),
      bom: true,
    };
  }

  if (preferred) {
    const text = new TextDecoder(decoderLabel(preferred)).decode(bytes);
    return {
      text: toLogicalNewlines(text),
      encoding: preferred,
      eol: detectEol(text),
      bom: false,
    };
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      text: toLogicalNewlines(text),
      encoding: "utf-8",
      eol: detectEol(text),
      bom: false,
    };
  } catch {
    // not valid utf-8
  }

  const hasHigh = bytes.some((b) => b >= 0x80);
  if (hasHigh) {
    try {
      const text = new TextDecoder("gbk").decode(bytes);
      return {
        text: toLogicalNewlines(text),
        encoding: "gbk",
        eol: detectEol(text),
        bom: false,
      };
    } catch {
      // fall through
    }
  }

  const text = new TextDecoder("windows-1252").decode(bytes);
  return {
    text: toLogicalNewlines(text),
    encoding: "windows-1252",
    eol: detectEol(text),
    bom: false,
  };
}

export interface EncodeOptions {
  bom?: boolean;
}

/**
 * Encode logical Unicode text to Path bytes using Encoding + EOL (+ optional BOM).
 */
export function encodeText(
  text: string,
  encoding: string,
  eol: Eol,
  options: EncodeOptions = {},
): Buffer {
  const withEol = applyEol(toLogicalNewlines(text), eol);
  const label = decoderLabel(encoding);
  let body: Buffer;

  if (label === "utf-8") {
    body = Buffer.from(withEol, "utf8");
  } else if (label === "latin1" || label === "windows-1252") {
    body = Buffer.from(withEol, "latin1");
  } else if (label === "utf-16le") {
    body = Buffer.from(withEol, "utf16le");
  } else if (label === "utf-16be") {
    const le = Buffer.from(withEol, "utf16le");
    const be = Buffer.alloc(le.length);
    for (let i = 0; i + 1 < le.length; i += 2) {
      be[i] = le[i + 1]!;
      be[i + 1] = le[i]!;
    }
    body = be;
  } else {
    body = encodeGbkLike(withEol, label);
  }

  if (options.bom !== true) return body;
  if (label === "utf-8") return Buffer.concat([UTF8_BOM, body]);
  if (label === "utf-16le") return Buffer.concat([UTF16LE_BOM, body]);
  if (label === "utf-16be") return Buffer.concat([UTF16BE_BOM, body]);
  return body;
}

/** Dependency-free GBK/GB18030 encoder via TextDecoder inverse search. */
function encodeGbkLike(text: string, label: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    let found = false;
    for (let hi = 0x81; hi <= 0xfe && !found; hi++) {
      for (let lo = 0x40; lo <= 0xfe; lo++) {
        if (lo === 0x7f) continue;
        const decoded = new TextDecoder(label).decode(Uint8Array.of(hi, lo));
        if (decoded === ch) {
          out.push(hi, lo);
          found = true;
          break;
        }
      }
    }
    if (!found) out.push(0x3f);
  }
  return Buffer.from(out);
}

/**
 * Reinterpret mojibake: recover bytes from Unicode decoded with `fromEncoding`,
 * then decode those bytes with `toEncoding`.
 */
export function reinterpretText(
  mojibake: string,
  fromEncoding: string,
  toEncoding: string,
): string {
  const bytes = encodeText(mojibake, fromEncoding, "lf", { bom: false });
  const decoded = new TextDecoder(decoderLabel(toEncoding)).decode(bytes);
  return toLogicalNewlines(decoded);
}
