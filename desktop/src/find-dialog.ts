/**
 * WUF-107 — modeless FindBar dialog for the desktop shell.
 *
 * Find/replace/flags live here; Intent/Action stay on the main surface.
 * Buffer writes only via replaceAccept → Intent Accept (never silent).
 * Surface is injectable so CI never needs real OS dialog pixels.
 */

export type FindFlags = {
  i?: boolean;
  m?: boolean;
  s?: boolean;
};

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

/**
 * Present/dismiss/focus hooks for the shell. Tests inject a recorder;
 * the desktop wires these to the modeless dialog DOM (not showModal).
 */
export type FindDialogSurface = {
  present(fields: FindDialogFields): void;
  dismiss(): void;
  focusPattern(): void;
};

function flagsFromDraftString(flags: string | undefined): FindFlags {
  const f = flags ?? "";
  return {
    i: f.includes("i") || undefined,
    m: f.includes("m") || undefined,
    s: f.includes("s") || undefined,
  };
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
 * RegexDraft fill opens + focuses; replace still goes through Accept.
 */
export class FindDialog {
  private open = false;
  private fields: FindDialogFields = {
    pattern: "",
    replacement: "",
    flags: {},
  };
  private scope: FindScope = { kind: "buffer" };

  constructor(
    private readonly port: FindDialogPort,
    private readonly surface: FindDialogSurface,
  ) {}

  isOpen(): boolean {
    return this.open;
  }

  /** Modeless: Find never captures the editor for exclusive input. */
  blocksEditor(): boolean {
    return false;
  }

  /** Intent/Action panels remain on the main surface, not inside Find. */
  hostsIntentOrAction(): boolean {
    return false;
  }

  getFields(): FindDialogFields {
    return copyFields(this.fields);
  }

  setFields(fields: Partial<FindDialogFields>): void {
    if (fields.pattern !== undefined) this.fields.pattern = fields.pattern;
    if (fields.replacement !== undefined) {
      this.fields.replacement = fields.replacement;
    }
    if (fields.flags !== undefined) {
      this.fields.flags = { ...fields.flags };
    }
    if (this.open) {
      this.surface.present(this.getFields());
    }
  }

  setScope(scope: FindScope): void {
    this.scope = scope;
  }

  openDialog(): void {
    this.open = true;
    this.surface.present(this.getFields());
  }

  closeDialog(): void {
    if (!this.open) return;
    this.open = false;
    this.surface.dismiss();
  }

  focusPattern(): void {
    if (!this.open) this.openDialog();
    this.surface.focusPattern();
  }

  /**
   * Fill from Intent RegexDraft, open + focus the dialog.
   * Does not Accept into Buffer — only loads Find fields via the port.
   */
  async applyRegexDraft(draft: FindDraft): Promise<void> {
    await this.port.applyDraft(draft);
    this.fields = {
      pattern: draft.pattern,
      replacement: draft.replacement ?? "",
      flags: flagsFromDraftString(draft.flags),
    };
    this.open = true;
    this.surface.present(this.getFields());
    this.surface.focusPattern();
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
