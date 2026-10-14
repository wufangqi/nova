/**
 * Model gateway + deterministic Patch validator (WUF-75).
 * Local gateway is offline — no network; suitable for eval machines with a
 * preinstalled local model.
 */
import type { ResolvedScope } from "./types.js";

export interface ModelTransformRequest {
  utterance: string;
  scopeText: string;
  scope: ResolvedScope;
  bufferText: string;
  bufferRevision: number;
}

/** Opaque model payload; validator turns valid JSON into edits. */
export interface ModelTransformRaw {
  raw: string;
}

export interface ModelGateway {
  /** Stable id for Provenance.label. */
  id: string;
  /** True when this gateway never sends text off-machine. */
  offline: boolean;
  transform(req: ModelTransformRequest): ModelTransformRaw;
}

export interface ValidatedEdit {
  start: number;
  end: number;
  replacement: string;
}

export type ValidateOk = { ok: true; edits: ValidatedEdit[] };
export type ValidateFail = { ok: false; reason: string };
export type ValidateResult = ValidateOk | ValidateFail;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deterministic validator: model output must be JSON with in-Scope edits.
 * Invalid output never becomes an Acceptable Patch.
 */
export function validateModelPatchOutput(
  raw: string,
  scope: ResolvedScope,
  bufferLength: number,
): ValidateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "model output is not JSON" };
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.edits)) {
    return { ok: false, reason: "model output missing edits array" };
  }

  if (parsed.edits.length === 0) {
    return { ok: false, reason: "model output has empty edits" };
  }

  const edits: ValidatedEdit[] = [];
  for (const item of parsed.edits) {
    if (!isRecord(item)) {
      return { ok: false, reason: "edit is not an object" };
    }
    const { start, end, replacement } = item;
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      typeof replacement !== "string"
    ) {
      return { ok: false, reason: "edit fields invalid" };
    }
    if (start < 0 || end < start || end > bufferLength) {
      return { ok: false, reason: "edit out of Buffer bounds" };
    }
    // Edits must stay inside the Intent Scope.
    if (start < scope.start || end > scope.end) {
      return { ok: false, reason: "edit out of Scope" };
    }
    edits.push({ start, end, replacement });
  }

  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) {
      return { ok: false, reason: "overlapping edits" };
    }
  }

  return { ok: true, edits };
}

/**
 * Preinstalled local model for offline eval / Demo machines.
 * Understands simple transform utterances; never touches the network.
 */
export class LocalModelGateway implements ModelGateway {
  readonly id = "local-model";
  readonly offline = true;

  transform(req: ModelTransformRequest): ModelTransformRaw {
    const u = req.utterance.trim().toLowerCase();
    let replacement: string;
    if (u.includes("lowercase") || u.includes("lower case")) {
      replacement = req.scopeText.toLowerCase();
    } else if (u.includes("reverse")) {
      replacement = [...req.scopeText].reverse().join("");
    } else {
      // Default transform family: uppercase (covers "uppercase" / "make it upper…").
      replacement = req.scopeText.toUpperCase();
    }

    return {
      raw: JSON.stringify({
        edits: [
          {
            start: req.scope.start,
            end: req.scope.end,
            replacement,
          },
        ],
      }),
    };
  }
}
