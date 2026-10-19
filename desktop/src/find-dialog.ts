/**
 * WUF-107 / WUF-120 — modeless FindBar dialog for the desktop shell.
 *
 * Tabs: 查找 | 替换 | Intent. Intent uses local RegexDraft (NL→pattern) and
 * hit marks that never write Buffer. Bottom-bar Patch Intent / Action list
 * stay on the main surface. Surface/marks are injectable so CI never needs
 * real OS dialog pixels.
 */

export type FindFlags = {
  i?: boolean;
  m?: boolean;
  s?: boolean;
};

export type FindTab = "find" | "replace" | "intent";

export const FIND_TABS: readonly FindTab[] = ["find", "replace", "intent"];

/** Default size above which marks may degrade to the visible window. */
export const FIND_MARKS_LARGE_BUFFER = 256_000;

export type FindDialogFields = {
  pattern: string;
  replacement: string;
  flags: FindFlags;
};

export type FindDraft = {
  pattern: string;
  replacement?: string;
  flags?: string;
};

export type FindHit = {
  start: number;
  end: number;
  match: string;
  line?: number;
};

export type FindScope =
  | { kind: "buffer" }
  | { kind: "range"; start: number; end: number };

export type FindParams = {
  pattern?: string;
  replacement?: string;
  flags?: FindFlags;
  scope?: FindScope;
};

export type FindIntentTabState = {
  utterance: string;
  /** Same source as find-tab pattern. */
  pattern: string;
  hitCount: number;
  marksActive: boolean;
  /** True when marks were limited to a visible window on a large Buffer. */
  degraded: boolean;
};

export type FindDialogPort = {
  find(params: FindParams): Promise<{ hits: FindHit[]; count: number }>;
  previewReplace(params: FindParams): Promise<{
    preview:
      | {
          ok: true;
          patches: Array<{ provenance: { source: string } }>;
        }
      | { ok: false; reason?: string; guidance?: string };
  }>;
  replaceAccept(params: FindParams): Promise<{
    accept: { ok: true } | { ok: false; reason?: string; guidance?: string };
  }>;
  applyDraft(draft: FindDraft): Promise<void>;
};

export type FindDialogPresentMeta = {
  tab: FindTab;
  intent: FindIntentTabState;
};

/**
 * Present/dismiss/focus hooks for the shell. Tests inject a recorder;
 * the desktop wires these to the modeless dialog DOM (not showModal).
 */
export type FindDialogSurface = {
  present(fields: FindDialogFields, meta?: FindDialogPresentMeta): void;
  dismiss(): void;
  focusPattern(): void;
  focusIntentUtterance?(): void;
};

/** Visual mark layer — never mutates Buffer text. */
export type FindMarksSurface = {
  applyMarks(hits: FindHit[]): void;
  clearMarks(): void;
};

export type RegexDraftEngine = {
  build(utterance: string): FindDraft;
};

export type FindDialogOptions = {
  marks?: FindMarksSurface;
  draftEngine?: RegexDraftEngine;
  /** Buffer length probe for large-Buffer mark degradation. */
  getBufferLength?: () => Promise<number> | number;
  getVisibleRange?: () => FindScope | undefined;
  largeBufferThreshold?: number;
};

function flagsFromDraftString(flags: string | undefined): FindFlags {
  const f = flags ?? "";
  return {
    i: f.includes("i") || undefined,
    m: f.includes("m") || undefined,
    s: f.includes("s") || undefined,
  };
}

function flagsToDraftString(flags: FindFlags): string | undefined {
  let out = "";
  if (flags.i) out += "i";
  if (flags.m) out += "m";
  if (flags.s) out += "s";
  return out.length > 0 ? out : undefined;
}

function copyFields(fields: FindDialogFields): FindDialogFields {
  return {
    pattern: fields.pattern,
    replacement: fields.replacement,
    flags: { ...fields.flags },
  };
}

/**
 * Controllable modeless Find dialog. Opening never blocks the editor;
 * RegexDraft fill opens on the Intent tab; replace still goes through Accept.
 */
export class FindDialog {
  private open = false;
  private tab: FindTab = "find";
  private utterance = "";
  private hitCount = 0;
  private marksActive = false;
  private degraded = false;
  private fields: FindDialogFields = {
    pattern: "",
    replacement: "",
    flags: {},
  };
  private scope: FindScope = { kind: "buffer" };
  private readonly marks: FindMarksSurface | undefined;
  private readonly draftEngine: RegexDraftEngine | undefined;
  private readonly getBufferLength: (() => Promise<number> | number) | undefined;
  private readonly getVisibleRange: (() => FindScope | undefined) | undefined;
  private readonly largeBufferThreshold: number;

  constructor(
    private readonly port: FindDialogPort,
    private readonly surface: FindDialogSurface,
    options: FindDialogOptions = {},
  ) {
    this.marks = options.marks;
    this.draftEngine = options.draftEngine;
    this.getBufferLength = options.getBufferLength;
    this.getVisibleRange = options.getVisibleRange;
    this.largeBufferThreshold =
      options.largeBufferThreshold ?? FIND_MARKS_LARGE_BUFFER;
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Modeless: Find never captures the editor for exclusive input. */
  blocksEditor(): boolean {
    return false;
  }

  tabs(): readonly FindTab[] {
    return FIND_TABS;
  }

  hasIntentTab(): boolean {
    return true;
  }

  /**
   * Bottom-bar Patch Intent stays on the main surface.
   * (Legacy name kept for older callers — same meaning.)
   */
  hostsIntentOrAction(): boolean {
    return this.hostsBottomBarPatchIntent() || this.hostsActionList();
  }

  hostsBottomBarPatchIntent(): boolean {
    return false;
  }

  hostsActionList(): boolean {
    return false;
  }

  getActiveTab(): FindTab {
    return this.tab;
  }

  setActiveTab(tab: FindTab): void {
    this.tab = tab;
    if (this.open) this.syncPresent();
  }

  getFields(): FindDialogFields {
    return copyFields(this.fields);
  }

  getIntentState(): FindIntentTabState {
    return {
      utterance: this.utterance,
      pattern: this.fields.pattern,
      hitCount: this.hitCount,
      marksActive: this.marksActive,
      degraded: this.degraded,
    };
  }

  setUtterance(utterance: string): void {
    this.utterance = utterance;
    if (this.open) this.syncPresent();
  }

  setFields(fields: Partial<FindDialogFields>): void {
    if (fields.pattern !== undefined) this.fields.pattern = fields.pattern;
    if (fields.replacement !== undefined) {
      this.fields.replacement = fields.replacement;
    }
    if (fields.flags !== undefined) {
      this.fields.flags = { ...fields.flags };
    }
    if (this.open) this.syncPresent();
  }

  setScope(scope: FindScope): void {
    this.scope = scope;
  }

  openDialog(tab: FindTab = "find"): void {
    this.tab = tab;
    this.open = true;
    this.syncPresent();
  }

  closeDialog(): void {
    if (!this.open) return;
    this.clearMarks();
    this.open = false;
    this.surface.dismiss();
  }

  focusPattern(): void {
    if (!this.open) this.openDialog("find");
    this.surface.focusPattern();
  }

  focusIntentUtterance(): void {
    if (!this.open) this.openDialog("intent");
    else this.setActiveTab("intent");
    this.surface.focusIntentUtterance?.();
  }

  /**
   * Fill from Intent RegexDraft, open on Intent tab.
   * Does not Accept into Buffer — only loads Find fields via the port.
   */
  async applyRegexDraft(
    draft: FindDraft,
    opts: { utterance?: string } = {},
  ): Promise<void> {
    await this.port.applyDraft(draft);
    this.fields = {
      pattern: draft.pattern,
      replacement: draft.replacement ?? "",
      flags: flagsFromDraftString(draft.flags),
    };
    if (opts.utterance !== undefined) this.utterance = opts.utterance;
    this.tab = "intent";
    this.open = true;
    this.syncPresent();
    if (this.surface.focusIntentUtterance) {
      this.surface.focusIntentUtterance();
    } else {
      this.surface.focusPattern();
    }
  }

  /**
   * Generate pattern from utterance via local RegexDraft, then mark hits.
   */
  async generate(): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.draftEngine) {
      return { ok: false, reason: "no_draft_engine" };
    }
    const trimmed = this.utterance.trim();
    if (trimmed.length === 0) {
      this.clearMarks();
      return { ok: false, reason: "empty_utterance" };
    }
    const draft = this.draftEngine.build(trimmed);
    this.fields.pattern = draft.pattern;
    if (draft.replacement !== undefined) {
      this.fields.replacement = draft.replacement;
    }
    if (draft.flags !== undefined) {
      this.fields.flags = flagsFromDraftString(draft.flags);
    }
    await this.port.applyDraft({
      pattern: draft.pattern,
      replacement: draft.replacement,
      flags: draft.flags,
    });
    if (this.open) this.syncPresent();
    await this.remark();
    return { ok: true };
  }

  /** Re-scan Buffer with the current pattern and refresh marks. */
  async remark(): Promise<void> {
    const pattern = this.fields.pattern;
    if (!pattern) {
      this.clearMarks();
      return;
    }

    let scope = this.scope;
    let degraded = false;
    if (this.getBufferLength) {
      const len = await this.getBufferLength();
      if (len > this.largeBufferThreshold) {
        const visible = this.getVisibleRange?.();
        if (visible && visible.kind === "range") {
          scope = visible;
          degraded = true;
        }
      }
    }

    const found = await this.port.find({
      pattern,
      flags: this.fields.flags,
      scope,
    });
    this.hitCount = found.count;
    this.degraded = degraded;
    this.marksActive = found.count > 0;
    if (this.marksActive) {
      this.marks?.applyMarks(found.hits);
    } else {
      this.marks?.clearMarks();
    }
    if (this.open) this.syncPresent();
  }

  clearMarks(): void {
    this.marks?.clearMarks();
    this.marksActive = false;
    this.hitCount = 0;
    this.degraded = false;
    if (this.open) this.syncPresent();
  }

  /** Buffer content changed — marks must not linger on stale text. */
  notifyBufferEdited(): void {
    this.clearMarks();
  }

  canSaveAsAction(): boolean {
    return this.tab === "intent" && this.fields.pattern.trim().length > 0;
  }

  getDraftForSave(): FindDraft | null {
    if (!this.canSaveAsAction()) return null;
    return {
      pattern: this.fields.pattern,
      replacement: this.fields.replacement,
      flags: flagsToDraftString(this.fields.flags),
    };
  }

  private syncPresent(): void {
    this.surface.present(this.getFields(), {
      tab: this.tab,
      intent: this.getIntentState(),
    });
  }

  private params(extra: FindParams = {}): FindParams {
    return {
      pattern: extra.pattern ?? this.fields.pattern,
      replacement: extra.replacement ?? this.fields.replacement,
      flags: extra.flags ?? this.fields.flags,
      scope: extra.scope ?? this.scope,
    };
  }

  async find(extra: FindParams = {}): Promise<{ hits: FindHit[]; count: number }> {
    return this.port.find(this.params(extra));
  }

  async previewReplace(extra: FindParams = {}) {
    return this.port.previewReplace(this.params(extra));
  }

  async replaceAccept(extra: FindParams = {}) {
    return this.port.replaceAccept(this.params(extra));
  }
}
