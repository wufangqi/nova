/**
 * WUF-107 / WUF-120 / WUF-121 — modeless Find workbench for the desktop shell.
 *
 * Find / replace / Intent (+ Actions) live here as tabs. Geometry: default
 * center, title-bar drag, client clamp, in-session position memory (cleared
 * on process restart). Buffer writes only via replaceAccept / Intent Accept.
 * Surface is injectable so CI never needs real OS dialog pixels.
 */

import {
  applyDrag,
  centerWorkbench,
  clampWorkbench,
  type ClientSize,
  type WorkbenchPoint,
  type WorkbenchSize,
} from "./find-workbench-geometry.ts";

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

/** Workbench tabs: 查找 | 替换 | Intent (Actions nest under Intent). */
export type WorkbenchTab = "find" | "replace" | "intent";

export type WorkbenchGeometry = WorkbenchPoint;

export type FindMarksState = {
  marksActive: boolean;
  hitCount: number;
  /** True when marks were limited to a visible window on a large Buffer. */
  degraded?: boolean;
};

/** Default size above which marks may degrade to the visible window. */
export const FIND_MARKS_LARGE_BUFFER = 256_000;

/** Visual mark layer — never mutates Buffer text. */
export type FindMarksSurface = {
  applyMarks(hits: FindHit[]): void;
  clearMarks(): void;
};

export type FindDialogOptions = {
  marks?: FindMarksSurface;
  /** Buffer length probe for large-Buffer mark degradation. */
  getBufferLength?: () => Promise<number> | number;
  getVisibleRange?: () => FindScope | undefined;
  largeBufferThreshold?: number;
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

export type PresentOpts = {
  tab: WorkbenchTab;
  geometry: WorkbenchGeometry;
};

/**
 * Present/dismiss/focus hooks for the shell. Tests inject a recorder;
 * the desktop wires these to the modeless dialog DOM (not showModal).
 */
export type FindDialogSurface = {
  present(fields: FindDialogFields, opts: PresentOpts): void;
  dismiss(): void;
  focusPattern(): void;
  focusIntent?(): void;
  setTab?(tab: WorkbenchTab): void;
  setGeometry?(geometry: WorkbenchGeometry): void;
  /**
   * Size of the dialog after the given tab is shown. Called after `present` so
   * Intent (taller) vs Find heights are measured correctly for centering.
   */
  measureSize?(tab: WorkbenchTab): WorkbenchSize;
};

export type OpenDialogOpts = {
  tab?: WorkbenchTab;
  client?: ClientSize;
  size?: WorkbenchSize;
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

const DEFAULT_CLIENT: ClientSize = { widthPx: 1024, heightPx: 768 };
const DEFAULT_SIZE: WorkbenchSize = { widthPx: 576, heightPx: 420 };

/**
 * Controllable modeless Find workbench. Opening never blocks the editor;
 * RegexDraft fill opens + focuses Intent tab; replace still goes through Accept.
 */
export class FindDialog {
  private open = false;
  private fields: FindDialogFields = {
    pattern: "",
    replacement: "",
    flags: {},
  };
  private scope: FindScope = { kind: "buffer" };
  private tab: WorkbenchTab = "find";
  private geometry: WorkbenchGeometry = { leftPx: 0, topPx: 0 };
  /** In-memory only — undefined until the user drags (or after restart). */
  private sessionMemory: WorkbenchGeometry | undefined;
  private marks: FindMarksState = {
    marksActive: false,
    hitCount: 0,
    degraded: false,
  };
  private lastClient: ClientSize = DEFAULT_CLIENT;
  private lastSize: WorkbenchSize = DEFAULT_SIZE;
  private readonly marksSurface: FindMarksSurface | undefined;
  private readonly getBufferLength: (() => Promise<number> | number) | undefined;
  private readonly getVisibleRange: (() => FindScope | undefined) | undefined;
  private readonly largeBufferThreshold: number;

  constructor(
    private readonly port: FindDialogPort,
    private readonly surface: FindDialogSurface,
    options: FindDialogOptions = {},
  ) {
    this.marksSurface = options.marks;
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

  /**
   * Workbench hosts Intent + Actions UI (migrated off the shell bottom bar).
   * Geometry / tabs / marks live on this seam.
   */
  hostsIntentOrAction(): boolean {
    return true;
  }

  /** No install-level persistence key — session memory is process-local. */
  hasPersistentGeometryKey(): boolean {
    return false;
  }

  getTab(): WorkbenchTab {
    return this.tab;
  }

  setTab(tab: WorkbenchTab): void {
    this.tab = tab;
    if (this.open) {
      this.surface.setTab?.(tab);
      this.surface.present(this.getFields(), this.presentOpts());
    }
  }

  getGeometry(): WorkbenchGeometry {
    return { ...this.geometry };
  }

  getSessionGeometry(): WorkbenchGeometry | undefined {
    return this.sessionMemory ? { ...this.sessionMemory } : undefined;
  }

  getMarksState(): FindMarksState {
    return { ...this.marks };
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
      this.surface.present(this.getFields(), this.presentOpts());
    }
  }

  setScope(scope: FindScope): void {
    this.scope = scope;
  }

  openDialog(opts: OpenDialogOpts = {}): void {
    if (opts.client) this.lastClient = opts.client;
    if (opts.size) this.lastSize = opts.size;
    if (opts.tab) this.tab = opts.tab;
    this.open = true;
    // Present the target tab first so measureSize sees Intent (taller) layout.
    this.geometry = this.resolveGeometry(this.lastClient, this.lastSize);
    this.surface.present(this.getFields(), this.presentOpts());
    this.relayoutAfterPresent();
  }

  closeDialog(): void {
    if (!this.open) return;
    this.open = false;
    this.clearMarks();
    this.surface.dismiss();
  }

  focusPattern(): void {
    if (!this.open) this.openDialog({ tab: "find" });
    this.surface.focusPattern();
  }

  focusIntent(): void {
    if (!this.open) this.openDialog({ tab: "intent" });
    else this.setTab("intent");
    this.focusWorkbenchField();
  }

  /**
   * Title-bar drag: apply delta, clamp to client, remember for this session.
   */
  dragTitleBar(
    delta: { dx: number; dy: number },
    client: ClientSize = this.lastClient,
    size: WorkbenchSize = this.lastSize,
  ): WorkbenchGeometry {
    this.lastClient = client;
    this.lastSize = size;
    const next = clampWorkbench(
      applyDrag(this.geometry, delta),
      size,
      client,
    );
    this.geometry = next;
    this.sessionMemory = { ...next };
    if (this.open) {
      this.surface.setGeometry?.(next);
      this.surface.present(this.getFields(), this.presentOpts());
    }
    return { ...next };
  }

  /**
   * Fill from Intent RegexDraft, open Intent tab + focus.
   * Does not Accept into Buffer — only loads Find fields via the port.
   */
  async applyRegexDraft(
    draft: FindDraft,
    opts: Pick<OpenDialogOpts, "client" | "size"> = {},
  ): Promise<void> {
    if (opts.client) this.lastClient = opts.client;
    if (opts.size) this.lastSize = opts.size;
    await this.port.applyDraft(draft);
    this.fields = {
      pattern: draft.pattern,
      replacement: draft.replacement ?? "",
      flags: flagsFromDraftString(draft.flags),
    };
    this.tab = "intent";
    this.open = true;
    // Present Intent tab first, then remeasure — do not center on Find height.
    this.geometry = this.resolveGeometry(this.lastClient, this.lastSize);
    this.surface.present(this.getFields(), this.presentOpts());
    this.relayoutAfterPresent();
    // Explicit branch: void-returning focusIntent must not fall through via `??`.
    this.focusWorkbenchField();
  }

  /**
   * Mark hits for the current pattern on the active Buffer (via find port).
   * Does not write Buffer text. Large buffers may degrade to the visible window.
   */
  async markHits(extra: FindParams = {}): Promise<FindMarksState> {
    if (!this.fields.pattern && !extra.pattern) {
      this.clearMarks();
      return this.getMarksState();
    }

    let scope = extra.scope ?? this.scope;
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

    const found = await this.port.find(this.params({ ...extra, scope }));
    this.marks = {
      marksActive: found.count > 0,
      hitCount: found.count,
      degraded,
    };
    if (this.marks.marksActive) {
      this.marksSurface?.applyMarks(found.hits);
    } else {
      this.marksSurface?.clearMarks();
    }
    return this.getMarksState();
  }

  /** Clear marks (dismiss / explicit clear / Buffer edit). */
  clearMarks(): void {
    this.marksSurface?.clearMarks();
    this.marks = { marksActive: false, hitCount: 0, degraded: false };
  }

  /** Buffer content changed — drop marks so highlights do not go stale. */
  onBufferEdited(): void {
    this.clearMarks();
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

  private presentOpts(): PresentOpts {
    return { tab: this.tab, geometry: { ...this.geometry } };
  }

  /** Prefer Intent input when available; never call both. */
  private focusWorkbenchField(): void {
    if (typeof this.surface.focusIntent === "function") {
      this.surface.focusIntent();
      return;
    }
    this.surface.focusPattern();
  }

  /**
   * After the target tab is visible, remeasure and re-center/clamp so Intent
   * openings do not use the shorter Find-panel height.
   */
  private relayoutAfterPresent(): void {
    const measured = this.surface.measureSize?.(this.tab);
    if (!measured) return;
    this.lastSize = measured;
    this.geometry = this.resolveGeometry(this.lastClient, this.lastSize);
    this.surface.setGeometry?.(this.geometry);
    this.surface.present(this.getFields(), this.presentOpts());
  }

  private resolveGeometry(
    client: ClientSize,
    size: WorkbenchSize,
  ): WorkbenchGeometry {
    if (this.sessionMemory) {
      return clampWorkbench(this.sessionMemory, size, client);
    }
    return centerWorkbench(client, size);
  }
}
