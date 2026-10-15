/**
 * Action facade — save / list / persist (WUF-89), rename / delete / soft cap (WUF-90),
 * preview_run (WUF-91). IPC thin wrap is IntentIpcHost (WUF-92).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FindBar } from "./find-bar.js";
import type { IntentService } from "./intent-service.js";
import type {
  ActionId,
  BufferId,
  MutateActionResult,
  PreviewId,
  PreviewRunResult,
  SaveActionResult,
  SavedAction,
  Selection,
} from "./types.js";

/** Soft catalog size (~50). Enforced on save. */
export const ACTION_SOFT_CAP = 50;

const STORE_FILE = "actions.json";

export interface ActionStore {
  load(): SavedAction[];
  saveAll(actions: SavedAction[]): void;
}

/** In-memory store for unit contracts. */
export class MemoryActionStore implements ActionStore {
  private actions: SavedAction[] = [];

  load(): SavedAction[] {
    return this.actions.map(cloneAction);
  }

  saveAll(actions: SavedAction[]): void {
    this.actions = actions.map(cloneAction);
  }
}

/**
 * Directory-backed store (restart-equivalent reload by constructing a new
 * ActionService with the same path). Exact OS profile path is not asserted.
 */
export class FileActionStore implements ActionStore {
  constructor(private readonly dir: string) {}

  load(): SavedAction[] {
    try {
      const raw = readFileSync(join(this.dir, STORE_FILE), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((row) => normalizeStored(row)).filter(Boolean) as SavedAction[];
    } catch {
      return [];
    }
  }

  saveAll(actions: SavedAction[]): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(
      join(this.dir, STORE_FILE),
      JSON.stringify(actions.map(cloneAction), null, 2),
      "utf8",
    );
  }
}

export interface ActionServiceOptions {
  /** Override soft cap (tests). Default ACTION_SOFT_CAP. */
  softCap?: number;
}

/**
 * Install-global Action catalog.
 * Not bound to Buffer Path; persistence is whatever ActionStore is injected.
 */
export class ActionService {
  private actions: SavedAction[];
  private readonly softCap: number;

  constructor(
    private readonly intent: IntentService,
    private readonly store: ActionStore,
    options: ActionServiceOptions = {},
  ) {
    this.softCap = options.softCap ?? ACTION_SOFT_CAP;
    this.actions = store.load().map(cloneAction);
    this.sortRecentFirst();
  }

  /**
   * Explicit save from an outstanding regex_draft preview.
   * Default display name = source utterance (human words).
   */
  saveFromRegexDraft(input: {
    previewId: PreviewId;
    displayName?: string;
  }): SaveActionResult {
    const record = this.intent.getOutstandingPreview(input.previewId);
    if (!record) {
      return { ok: false, reason: "stale_preview" };
    }
    if (record.kind !== "regex_draft") {
      return { ok: false, reason: "not_regex_draft" };
    }
    if (this.actions.length >= this.softCap) {
      return { ok: false, reason: "cap_exceeded" };
    }

    const displayName =
      input.displayName?.trim() || record.utterance.trim() || "Action";
    const action: SavedAction = {
      id: randomUUID(),
      displayName,
      draft: {
        pattern: record.draft.pattern,
        replacement: record.draft.replacement,
        flags: record.draft.flags,
      },
      createdAt: new Date().toISOString(),
    };
    this.actions.push(action);
    this.sortRecentFirst();
    this.store.saveAll(this.actions);
    return { ok: true, action: cloneAction(action) };
  }

  /** Install-global catalog; recent-first (stable muscle memory). */
  list(): SavedAction[] {
    return this.actions.map(cloneAction);
  }

  /**
   * Rename display name only — compiled RegexDraft stays immutable.
   * Duplicate display names are allowed.
   */
  rename(id: ActionId, displayName: string): MutateActionResult {
    const action = this.actions.find((a) => a.id === id);
    if (!action) {
      return { ok: false, reason: "not_found" };
    }
    const next = displayName.trim() || action.displayName;
    action.displayName = next;
    this.store.saveAll(this.actions);
    return { ok: true };
  }

  /** Remove from install-global catalog. */
  delete(id: ActionId): MutateActionResult {
    const index = this.actions.findIndex((a) => a.id === id);
    if (index < 0) {
      return { ok: false, reason: "not_found" };
    }
    this.actions.splice(index, 1);
    this.store.saveAll(this.actions);
    return { ok: true };
  }

  /**
   * Deterministic re-run on a non-empty Selection → Patch preview.
   * Uses the same PCRE surface as FindBar; never Outbound / never model.
   * Buffer writes only via IntentService.accept of the returned patches.
   */
  previewRun(input: {
    actionId: ActionId;
    bufferId: BufferId;
    selection: Selection;
  }): PreviewRunResult {
    const { selection } = input;
    if (selection.start === selection.end) {
      return {
        ok: false,
        reason: "empty_selection",
        guidance:
          "Selection is empty — highlight a non-empty range before running an Action (never applies to the whole Buffer silently).",
      };
    }

    const action = this.actions.find((a) => a.id === input.actionId);
    if (!action) {
      return {
        ok: false,
        reason: "not_found",
        guidance: "Action not found — it may have been deleted.",
      };
    }

    // Find-only definitions cannot rewrite Buffer text.
    if (action.draft.replacement === undefined) {
      return {
        ok: false,
        reason: "no_replacement",
        guidance:
          "This Action has a pattern but no replacement — find-only; text Accept is not offered.",
      };
    }

    const buf = this.intent.getBuffer(input.bufferId);
    const len = this.intent.len(input.bufferId);
    if (
      selection.start < 0 ||
      selection.end < selection.start ||
      selection.end > len
    ) {
      return {
        ok: false,
        reason: "invalid_selection",
        guidance: "Selection is out of range for this Buffer.",
      };
    }

    const bar = new FindBar(this.intent);
    bar.applyDraft(action.draft);
    const replace = bar.previewReplace({
      bufferId: input.bufferId,
      scope: {
        kind: "range",
        start: selection.start,
        end: selection.end,
      },
    });

    if (!replace.ok) {
      if (replace.reason === "no_matches") {
        return {
          ok: false,
          reason: "zero_matches",
          guidance:
            "Zero matches in the Selection — nothing to Accept; try a different range or Action.",
        };
      }
      if (replace.reason === "invalid_pattern") {
        return {
          ok: false,
          reason: "invalid_pattern",
          guidance: "Action pattern failed to compile (PCRE).",
        };
      }
      if (replace.reason === "no_pattern") {
        return {
          ok: false,
          reason: "no_pattern",
          guidance: "Action has an empty pattern.",
        };
      }
      return {
        ok: false,
        reason: "invalid_selection",
        guidance: "Selection is invalid for this Buffer.",
      };
    }

    const patches = replace.patches.map((p) => ({
      ...p,
      edits: p.edits.map((e) => ({ ...e })),
      provenance: {
        source: "action" as const,
        label: action.displayName,
      },
    }));

    const previewId = this.intent.registerPatchesPreview(action.displayName);
    return {
      ok: true,
      previewId,
      patches,
      cost: {
        latencyMsEstimate: 5,
        tokensEstimate: 0,
        hasOutbound: false,
      },
    };
  }

  private sortRecentFirst(): void {
    this.actions.sort((a, b) => {
      if (a.createdAt === b.createdAt) return a.id < b.id ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }
}

function cloneAction(a: SavedAction): SavedAction {
  return {
    id: a.id,
    displayName: a.displayName,
    draft: {
      pattern: a.draft.pattern,
      replacement: a.draft.replacement,
      flags: a.draft.flags,
    },
    createdAt: a.createdAt,
  };
}

function normalizeStored(row: unknown): SavedAction | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.displayName !== "string") return null;
  if (typeof o.createdAt !== "string") return null;
  if (!o.draft || typeof o.draft !== "object") return null;
  const d = o.draft as Record<string, unknown>;
  if (typeof d.pattern !== "string") return null;
  return {
    id: o.id,
    displayName: o.displayName,
    createdAt: o.createdAt,
    draft: {
      pattern: d.pattern,
      replacement: typeof d.replacement === "string" ? d.replacement : undefined,
      flags: typeof d.flags === "string" ? d.flags : undefined,
    },
  };
}
