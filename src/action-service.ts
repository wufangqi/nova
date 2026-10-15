/**
 * Action facade — save / list / persist (WUF-89).
 * Soft-cap / rename / delete / preview_run land in later Work tickets.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IntentService } from "./intent-service.js";
import type {
  PreviewId,
  SaveActionResult,
  SavedAction,
} from "./types.js";

/** Soft catalog size (~50). Enforced on save; rename/delete UX is WUF-90. */
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
