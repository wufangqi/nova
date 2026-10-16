import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ActionPanel,
  type ActionPanelPort,
  type ActionView,
} from "./action-panel.ts";
import {
  canOfferSaveAsAction,
  type PreviewKindForSave,
} from "./action-ui.ts";
import { createDomClosePrompter } from "./dom-close-prompter.ts";
import {
  openWithPicker,
  saveAsWithPicker,
  saveWithPicker,
  type FileOpsPort,
} from "./file-ops.ts";
import {
  FindDialog,
  type FindDialogFields,
  type FindDialogPort,
  type FindDialogSurface,
} from "./find-dialog.ts";
import { APP_PRODUCT_NAME, APP_VERSION } from "./app-meta.ts";
import { GotoLinePopup, type GotoLinePopupSurface } from "./goto-line-popup.ts";
import { formatPatchDiffAsync, type Patch } from "./patch-diff.ts";
import { closeTabWithPrompter, type TabClosePort } from "./tab-close.ts";
import {
  SHELL_FILE_MENU_ITEMS,
  SHELL_HELP_MENU_ITEMS,
  aboutInfoFromConfig,
  resolveShellShortcut,
  runShellAction,
  shouldDismissDetailsMenu,
  type ShellChromeAction,
  type ShellChromeHandlers,
} from "./shell-chrome.ts";
import { createTauriPathPicker } from "./tauri-path-picker.ts";
import {
  caretLineColumnInWindow,
  formatStatusMetrics,
  mapStatusMetrics,
  type StatusMetrics,
} from "./status-metrics.ts";
import {
  TITLE_DRAG_THRESHOLD_PX,
  formatTitle,
  handleTitleClick,
  onTitleClose,
  onTitleDoubleClick,
  onTitleDragThreshold,
  onTitleMaximize,
  onTitleMinimize,
  syncWindowTitle,
  titleChromeFeedback,
  titleChromeStateFromTab,
  type TitleChromeState,
  type TitleChromeWindowPort,
} from "./title-chrome.ts";
import { VirtualEditor } from "./virtual-editor.ts";
import { runWindowQuitRecovery } from "./window-quit.ts";

const pathPicker = createTauriPathPicker();
let closePrompter = createDomClosePrompter(document.body);

const fileOpsPort: FileOpsPort = {
  async getActiveTab() {
    const tabs = await invoke<ShellTabsResult>("list_tabs_cmd");
    const active = tabs.tabs.find((t) => t.active);
    if (!active) return undefined;
    return { path: active.path, untitled: active.untitled };
  },
  async openPath(path) {
    const result = await invoke<ShellBufferResult>("open_path_cmd", { path });
    await applyState(result.buffer, result.tabs);
    clearPreviewPanel();
    clearSuggestionsBar();
    clearFindHits();
  },
  async saveActive() {
    const result = await invoke<ShellTabsResult>("save_active_cmd");
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, result.tabs);
  },
  async saveActiveAs(path) {
    const result = await invoke<ShellTabsResult>("save_active_as_cmd", { path });
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, result.tabs);
  },
};

const tabClosePort: TabClosePort = {
  async getTab(bufferId) {
    const tabs = await invoke<ShellTabsResult>("list_tabs_cmd");
    const tab = tabs.tabs.find((t) => t.bufferId === bufferId);
    if (!tab) return undefined;
    return {
      title: tab.title.replace(/\*$/, ""),
      hasPath: tab.path != null,
      dirty: tab.dirty,
    };
  },
  async closeClean(bufferId) {
    const result = await invoke<ShellCloseResult>("request_close_cmd", {
      id: bufferId,
    });
    if (!result.close.ok) {
      throw new Error("expected clean close without confirm");
    }
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, result.tabs);
    clearPreviewPanel();
    clearSuggestionsBar();
    clearFindHits();
  },
  async discard(bufferId) {
    const confirmed = await invoke<ShellCloseResult>("confirm_close_cmd", {
      id: bufferId,
    });
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, confirmed.tabs);
    clearPreviewPanel();
    clearSuggestionsBar();
    clearFindHits();
  },
  async save(bufferId) {
    if (bufferId !== activeId) {
      await activateTab(bufferId);
    }
    const outcome = await saveWithPicker(pathPicker, fileOpsPort);
    if (outcome.kind === "cancelled" || outcome.kind === "no_active") {
      return "cancelled";
    }
    return "saved";
  },
};

/** Mirrors nova `GLOBAL_HOTKEY_ACCELERATOR` / Tauri registration. */
const GLOBAL_HOTKEY_ACCELERATOR = "Ctrl+Alt+N";
/** Mirrors nova `HOTKEY_EVOKE_EVENT`. */
const HOTKEY_EVOKE_EVENT = "hotkey-evoke";

type BufferSnapshot = {
  id: string;
  text?: string;
  revision: number;
};

type TabInfo = {
  bufferId: string;
  title: string;
  path: string | null;
  untitled: boolean;
  dirty: boolean;
  active: boolean;
};

type ShellBufferResult = {
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type ShellTabsResult = {
  tabs: TabInfo[];
};

type ShellCloseResult = {
  close:
    | { ok: true; closed: true; asked: boolean }
    | {
        ok: false;
        reason: "confirm_discard_untitled" | "confirm_discard_dirty";
        bufferId: string;
      };
  tabs: TabInfo[];
};

type ShellStateResult = {
  buffer: BufferSnapshot | null;
  tabs: TabInfo[];
};

type Cost = {
  latencyMsEstimate: number;
  tokensEstimate: number;
  hasOutbound: boolean;
};

type Outbound = {
  task: string;
  text: string;
  destination: "cloud";
};

type ExplanationAnchor = {
  id: string;
  start: number;
  end: number;
  note: string;
  excerpt: string;
  baseRevision: number;
};

type Explanation = {
  summary: string;
  anchors: ExplanationAnchor[];
};

type PreviewResult =
  | {
      kind: "patches";
      previewId: string;
      patches: Patch[];
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "explanation";
      previewId: string;
      explanation: Explanation;
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "regex_draft";
      previewId: string;
      draft: { pattern: string; replacement?: string; flags?: string };
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "error";
      reason: string;
      guidance: string;
    };

type PreviewIntentResult = {
  intent: { utterance: string; scopeLabel: string };
  preview: PreviewResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type SelectSuggestionResult = {
  preview: PreviewResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
  utterance: string;
};

type AcceptIpcResult = {
  accept: { ok: true; undoGroupId: string } | { ok: false; reason: string };
  buffers: BufferSnapshot[];
};


type FindHit = {
  start: number;
  end: number;
  line: number;
  column: number;
  match: string;
  groups: Record<number, string>;
};

type FindIpcResult = {
  hits: FindHit[];
  count: number;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type PreviewReplaceIpcResult = {
  preview:
    | { ok: true; patches: Patch[] }
    | {
        ok: false;
        reason: string;
      };
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type ReplaceAcceptIpcResult = {
  accept: { ok: true; undoGroupId: string } | { ok: false; reason: string };
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type ApplyDraftIpcResult = {
  draft: { pattern: string; replacement?: string; flags?: string };
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type Suggestion = {
  id: string;
  label: string;
  utterance: string;
};

type AnchorResolveResult =
  | { ok: true; status: "valid"; start: number; end: number }
  | {
      ok: false;
      status: "invalid";
      reason: "reloc_failed" | "stale" | "unknown";
    };

type ResolveExplanationAnchorResult = {
  resolve: AnchorResolveResult;
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

type SavedActionRow = {
  id: string;
  displayName: string;
  draft: { pattern: string; replacement?: string; flags?: string };
  createdAt: string;
};

type SaveFromRegexDraftResult =
  | { ok: true; action: SavedActionRow }
  | {
      ok: false;
      reason: "not_regex_draft" | "cap_exceeded" | "stale_preview";
    };

type ListActionsResult = { actions: SavedActionRow[] };

type MutateActionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" };

type PreviewRunIpcResult = {
  run:
    | {
        ok: true;
        previewId: string;
        patches: Patch[];
        cost: Cost;
      }
    | {
        ok: false;
        reason: string;
        guidance: string;
      };
  buffer: BufferSnapshot;
  tabs: TabInfo[];
};

function toActionView(action: SavedActionRow): ActionView {
  return {
    id: action.id,
    displayName: action.displayName,
    pattern: action.draft.pattern,
    replacement: action.draft.replacement,
    flags: action.draft.flags,
    createdAt: action.createdAt,
  };
}

/** Tauri invoke port — thin wrap; Action semantics stay in the IPC host. */
const actionPort: ActionPanelPort = {
  async listActions() {
    const result = await invoke<ListActionsResult>("list_actions_cmd");
    return result.actions.map(toActionView);
  },
  async saveFromRegexDraft({ previewId, displayName }) {
    const result = await invoke<SaveFromRegexDraftResult>(
      "save_from_regex_draft_cmd",
      {
        previewId,
        displayName: displayName ?? null,
      },
    );
    return result.ok
      ? { ok: true, action: toActionView(result.action) }
      : { ok: false, reason: result.reason };
  },
  async renameAction({ id, displayName }) {
    return invoke<MutateActionResult>("rename_action_cmd", {
      id,
      displayName,
    });
  },
  async deleteAction({ id }) {
    return invoke<MutateActionResult>("delete_action_cmd", { id });
  },
  async previewRun({ actionId, selection }) {
    const result = await invoke<PreviewRunIpcResult>("preview_run_cmd", {
      params: { actionId, selection },
    });
    const run = result.run;
    return run.ok
      ? {
          ok: true,
          run: {
            previewId: run.previewId,
            patches: run.patches,
            cost: run.cost,
          },
        }
      : { ok: false, reason: run.reason, guidance: run.guidance };
  },
};

const actionPanel = new ActionPanel(actionPort);

/** Tauri invoke port for Find — same IPC methods as the contract tests inject. */
const findPort: FindDialogPort = {
  async find(params) {
    const result = await invoke<FindIpcResult>("find_cmd", { params });
    return { hits: result.hits, count: result.count };
  },
  async previewReplace(params) {
    const result = await invoke<PreviewReplaceIpcResult>("preview_replace_cmd", {
      params,
    });
    return { preview: result.preview };
  },
  async replaceAccept(params) {
    const result = await invoke<ReplaceAcceptIpcResult>("replace_accept_cmd", {
      params,
    });
    return { accept: result.accept };
  },
  async applyDraft(draft) {
    await invoke<ApplyDraftIpcResult>("apply_draft_cmd", { draft });
  },
};

function writeFindFieldsToDom(fields: FindDialogFields) {
  el<HTMLInputElement>("find-pattern").value = fields.pattern;
  el<HTMLInputElement>("find-replacement").value = fields.replacement;
  el<HTMLInputElement>("find-flag-i").checked = !!fields.flags.i;
  el<HTMLInputElement>("find-flag-m").checked = !!fields.flags.m;
  el<HTMLInputElement>("find-flag-s").checked = !!fields.flags.s;
}

function readFindFieldsFromDom(): FindDialogFields {
  return {
    pattern: el<HTMLInputElement>("find-pattern").value,
    replacement: el<HTMLInputElement>("find-replacement").value,
    flags: {
      i: el<HTMLInputElement>("find-flag-i").checked || undefined,
      m: el<HTMLInputElement>("find-flag-m").checked || undefined,
      s: el<HTMLInputElement>("find-flag-s").checked || undefined,
    },
  };
}

const findSurface: FindDialogSurface = {
  present(fields) {
    writeFindFieldsToDom(fields);
    el<HTMLElement>("find-dialog").hidden = false;
  },
  dismiss() {
    el<HTMLElement>("find-dialog").hidden = true;
  },
  focusPattern() {
    const input = el<HTMLInputElement>("find-pattern");
    input.focus();
    input.select();
  },
};

const findDialog = new FindDialog(findPort, findSurface);

let activeId: string | null = null;
let pendingPreviewId: string | null = null;
let pendingPreviewKind: PreviewKindForSave = null;
let pendingPatches: Patch[] | null = null;
let lastUndoGroupId: string | null = null;
let virtualEditor: VirtualEditor;
let gotoLinePopup: GotoLinePopup;
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function setStatus(message: string) {
  el<HTMLElement>("status").textContent = message;
}

function renderStatusMetrics(metrics: StatusMetrics) {
  const labels = formatStatusMetrics(metrics);
  const root = el<HTMLElement>("status-metrics");
  for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
    const span = root.querySelector(`[data-metric="${key}"] .metric-value`);
    if (span) span.textContent = labels[key];
  }
}

let metricsRefreshToken = 0;

/** Refresh right-hand metrics from Buffer len/lines + caret (left status untouched). */
async function refreshStatusMetrics() {
  const token = ++metricsRefreshToken;
  if (!activeId) {
    renderStatusMetrics(
      mapStatusMetrics({
        hasBuffer: false,
        length: 0,
        lineCount: 0,
        caretOffset: null,
        caretLine: null,
        caretColumn: null,
      }),
    );
    return;
  }
  // Length and lineCount from the same IPC host so edits refresh both immediately
  // (VirtualEditor.totalLines may still be stale until flushEdit finishes).
  let length = 0;
  let lineCount = 0;
  try {
    const [lenRes, linesRes] = await Promise.all([
      invoke<{ len: number }>("buffer_len_cmd", { id: activeId }),
      invoke<{ lineCount: number }>("buffer_line_count_cmd", { id: activeId }),
    ]);
    length = lenRes.len;
    lineCount = linesRes.lineCount;
  } catch {
    length = 0;
    lineCount = 0;
  }
  if (token !== metricsRefreshToken) return;
  const ctx = virtualEditor.caretWindowContext();
  const pos = ctx ? caretLineColumnInWindow(ctx) : null;
  renderStatusMetrics(
    mapStatusMetrics({
      hasBuffer: true,
      length,
      lineCount,
      caretOffset: ctx?.caretOffset ?? null,
      caretLine: pos?.line ?? null,
      caretColumn: pos?.column ?? null,
    }),
  );
}

async function sliceActive(start: number, end: number): Promise<string> {
  if (!activeId || start === end) return "";
  const result = await invoke<{ text: string }>("slice_cmd", { id: activeId, start, end });
  return result.text;
}

function setIntentActions(opts: {
  accept?: boolean;
  reject?: boolean;
  undo?: boolean;
}) {
  el<HTMLButtonElement>("intent-accept").disabled = !(opts.accept ?? false);
  el<HTMLButtonElement>("intent-reject").disabled = !(opts.reject ?? false);
  el<HTMLButtonElement>("intent-undo").disabled = !(
    opts.undo ?? Boolean(lastUndoGroupId)
  );
}

function setSaveAsActionEnabled(enabled: boolean) {
  el<HTMLButtonElement>("save-as-action").disabled = !enabled;
}

function clearExplanationPanel() {
  const panel = el<HTMLElement>("explanation-panel");
  panel.hidden = true;
  el<HTMLElement>("explanation-summary").textContent = "";
  el<HTMLElement>("explanation-anchors").replaceChildren();
}

function clearSuggestionsBar() {
  const bar = el<HTMLElement>("suggestions-bar");
  bar.hidden = true;
  bar.replaceChildren();
}

function clearPreviewPanel() {
  pendingPreviewId = null;
  pendingPreviewKind = null;
  pendingPatches = null;
  el<HTMLElement>("intent-meta").hidden = true;
  el<HTMLElement>("intent-meta").textContent = "";
  el<HTMLElement>("outbound-banner").hidden = true;
  el<HTMLElement>("outbound-banner").textContent = "";
  el<HTMLElement>("patch-diff").hidden = true;
  el<HTMLElement>("patch-diff").textContent = "";
  clearExplanationPanel();
  setIntentActions({ accept: false, reject: false });
  setSaveAsActionEnabled(false);
}

/** Current editor range (caret counts as empty Selection for Action run). */
function editorRange(): { start: number; end: number } {
  return virtualEditor.absSelection();
}

function renderTabs(tabs: TabInfo[]) {
  const bar = el<HTMLElement>("tab-bar");
  bar.replaceChildren();
  for (const tab of tabs) {
    const wrap = document.createElement("div");
    wrap.className = tab.active ? "tab-item active" : "tab-item";
    wrap.dataset.bufferId = tab.bufferId;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = tab.active ? "tab active" : "tab";
    btn.textContent = tab.title;
    btn.title = tab.dirty ? `${tab.title} (unsaved)` : tab.title;
    btn.dataset.bufferId = tab.bufferId;
    if (tab.dirty) {
      btn.dataset.dirty = "true";
    }
    btn.addEventListener("click", () => {
      void activateTab(tab.bufferId);
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    closeBtn.setAttribute("aria-label", `Close ${tab.title}`);
    closeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      void closeBuffer(tab.bufferId);
    });

    wrap.append(btn, closeBtn);
    bar.appendChild(wrap);
  }
}

let currentTitleState: TitleChromeState = { path: null, dirty: false };
let titleFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let titleClickSuppressUntil = 0;

function titleWindowPort(): TitleChromeWindowPort {
  const win = getCurrentWindow();
  return {
    startDragging: () => win.startDragging(),
    toggleMaximize: () => win.toggleMaximize(),
    minimize: () => win.minimize(),
    close: () => win.close(),
  };
}

function showTitleFeedback(text: string, kind: "copied" | "no_path") {
  const chip = document.getElementById("title-chrome-feedback");
  if (!chip) return;
  chip.textContent = text;
  chip.hidden = false;
  chip.dataset.kind = kind;
  if (titleFeedbackTimer) clearTimeout(titleFeedbackTimer);
  titleFeedbackTimer = setTimeout(() => {
    chip.hidden = true;
    chip.textContent = "";
    delete chip.dataset.kind;
  }, 1500);
}

async function syncTitleChrome(active: TabInfo | undefined) {
  currentTitleState = titleChromeStateFromTab(active);
  const title = formatTitle(currentTitleState);
  const label = document.getElementById("title-chrome-label");
  if (label) label.textContent = title;
  try {
    await syncWindowTitle(currentTitleState, {
      setTitle: (t) => getCurrentWindow().setTitle(t),
    });
  } catch {
    /* non-Tauri / capability missing — contract covers the seam */
  }
}

function mountTitleChrome() {
  const region = document.getElementById("title-chrome");
  if (!region) return;

  let press: { x: number; y: number; dragging: boolean } | null = null;

  region.addEventListener("dblclick", (ev) => {
    ev.preventDefault();
    titleClickSuppressUntil = Date.now() + 400;
    press = null;
    void onTitleDoubleClick(titleWindowPort()).catch(() => {
      /* best-effort outside Tauri */
    });
  });

  region.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    press = { x: ev.clientX, y: ev.clientY, dragging: false };
    try {
      region.setPointerCapture(ev.pointerId);
    } catch {
      /* capture optional */
    }
  });

  region.addEventListener("pointermove", (ev) => {
    if (!press || press.dragging) return;
    const dx = ev.clientX - press.x;
    const dy = ev.clientY - press.y;
    if (Math.hypot(dx, dy) < TITLE_DRAG_THRESHOLD_PX) return;
    press.dragging = true;
    void onTitleDragThreshold(titleWindowPort()).catch(() => {
      /* best-effort outside Tauri */
    });
  });

  region.addEventListener("pointerup", () => {
    if (!press) return;
    const wasDrag = press.dragging;
    press = null;
    if (wasDrag || Date.now() < titleClickSuppressUntil) return;
    void handleTitleClick(currentTitleState, {
      writeClipboard: (text) => navigator.clipboard.writeText(text),
    })
      .then((result) => {
        showTitleFeedback(
          titleChromeFeedback(result),
          result.ok ? "copied" : "no_path",
        );
      })
      .catch((err) => setStatus(String(err)));
  });

  region.addEventListener("pointercancel", () => {
    press = null;
  });

  // Caption buttons (decorations:false) — must not trigger title copy/drag.
  const controls = document.getElementById("title-chrome-controls");
  if (controls) {
    for (const type of ["pointerdown", "pointerup", "click", "dblclick"] as const) {
      controls.addEventListener(type, (ev) => {
        ev.stopPropagation();
      });
    }
  }
  const bindCaption = (
    id: string,
    run: (win: TitleChromeWindowPort) => Promise<void>,
  ) => {
    const btn = document.getElementById(id);
    if (!(btn instanceof HTMLButtonElement)) return;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      press = null;
      void run(titleWindowPort()).catch((err) => setStatus(String(err)));
    });
  };
  bindCaption("win-minimize", onTitleMinimize);
  bindCaption("win-maximize", onTitleMaximize);
  bindCaption("win-close", onTitleClose);
}

async function applyState(buffer: BufferSnapshot | null, tabs: TabInfo[]) {
  activeId = buffer?.id ?? null;
  renderTabs(tabs);
  await virtualEditor.bind(buffer?.id ?? null, buffer?.revision);
  const active = tabs.find((t) => t.active);
  await syncTitleChrome(active);
  await refreshStatusMetrics();
}

function editorSelection():
  | { start: number; end: number }
  | undefined {
  return virtualEditor.absSelectionOrUndefined();
}


function findScope():
  | { kind: "buffer" }
  | { kind: "range"; start: number; end: number } {
  const selection = editorSelection();
  if (selection) {
    return { kind: "range", start: selection.start, end: selection.end };
  }
  return { kind: "buffer" };
}

function findFlags(): { i?: boolean; m?: boolean; s?: boolean } {
  return {
    i: el<HTMLInputElement>("find-flag-i").checked || undefined,
    m: el<HTMLInputElement>("find-flag-m").checked || undefined,
    s: el<HTMLInputElement>("find-flag-s").checked || undefined,
  };
}

function findParams(extra: { pattern?: string; replacement?: string } = {}) {
  const pattern =
    extra.pattern ?? el<HTMLInputElement>("find-pattern").value;
  const replacement =
    extra.replacement ?? el<HTMLInputElement>("find-replacement").value;
  return {
    pattern: pattern.length > 0 ? pattern : undefined,
    replacement: replacement.length > 0 ? replacement : undefined,
    flags: findFlags(),
    scope: findScope(),
  };
}

function setFindReplaceAccept(enabled: boolean) {
  el<HTMLButtonElement>("find-replace-accept").disabled = !enabled;
}

function clearFindHits() {
  setFindReplaceAccept(false);
  const hitsEl = el<HTMLElement>("find-hits");
  hitsEl.hidden = true;
  hitsEl.replaceChildren();
}

async function fillFindBarFromDraft(draft: {
  pattern: string;
  replacement?: string;
  flags?: string;
}) {
  // Opens/focuses the modeless Find dialog; apply_draft stays on the IPC seam.
  await findDialog.applyRegexDraft(draft);
}

function renderFindHits(hits: FindHit[], count: number) {
  const hitsEl = el<HTMLElement>("find-hits");
  hitsEl.hidden = false;
  hitsEl.replaceChildren();
  const summary = document.createElement("div");
  summary.textContent = `${count} hit${count === 1 ? "" : "s"}`;
  hitsEl.appendChild(summary);
  for (const h of hits.slice(0, 50)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "find-hit";
    const groups =
      Object.keys(h.groups).length > 0
        ? ` groups=${JSON.stringify(h.groups)}`
        : "";
    btn.textContent = `[${h.start},${h.end}) ${JSON.stringify(h.match)}${groups}`;
    btn.addEventListener("click", () => {
      void virtualEditor.revealRange(h.start, h.end, h.line);
    });
    hitsEl.appendChild(btn);
  }
  if (count > 50) {
    const more = document.createElement("div");
    more.textContent = `…and ${count - 50} more`;
    hitsEl.appendChild(more);
  }
}

async function jumpEditorTo(start: number, end: number, hintLine?: number) {
  await virtualEditor.revealRange(start, end, hintLine);
}

async function evoke() {
  const result = await invoke<ShellBufferResult>("evoke_cmd");
  await applyState(result.buffer, result.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();
  setStatus(`New untitled Buffer (${result.buffer.id.slice(0, 8)}…)`);
  virtualEditor.focus();
}

/** Visual ten-second Demo (WUF-87): new Buffer → paste → Intent → diff → Accept. */
async function runVisualDemo() {
  const pasteText = "hello demo";
  const utterance = "make it uppercase";
  const selection = { start: 0, end: 5 };

  setStatus("Demo: evoke new Buffer…");
  const evoked = await invoke<ShellBufferResult>("evoke_cmd");
  await applyState(evoked.buffer, evoked.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();

  setStatus("Demo: paste…");
  const pasted = await invoke<ShellBufferResult>("edit_active_cmd", {
    text: pasteText,
  });
  await applyState(pasted.buffer, pasted.tabs);
  await virtualEditor.revealRange(selection.start, selection.end);

  el<HTMLInputElement>("intent-input").value = utterance;
  setStatus("Demo: Intent preview…");
  const previewed = await invoke<PreviewIntentResult>("preview_intent_cmd", {
    utterance,
    selection,
    visibleWindow: null,
  });
  await applyPreviewResult(
    previewed.preview,
    previewed.buffer,
    previewed.tabs,
    previewed.intent.scopeLabel,
  );

  if (previewed.preview.kind === "error") {
    setStatus(
      `Demo: AI unavailable (${previewed.preview.reason}) — editor still usable`,
    );
    return;
  }
  if (previewed.preview.kind !== "patches") {
    setStatus(`Demo: unexpected preview (${previewed.preview.kind})`);
    return;
  }

  setStatus("Demo: Accept…");
  const accepted = await invoke<AcceptIpcResult>("accept_cmd", {
    patches: previewed.preview.patches,
  });
  if (!accepted.accept.ok) {
    setStatus(`Demo Accept failed: ${accepted.accept.reason}`);
    return;
  }
  lastUndoGroupId = accepted.accept.undoGroupId;
  const state = await invoke<ShellStateResult>("get_shell_state_cmd");
  await applyState(state.buffer, state.tabs);
  clearPreviewPanel();
  setIntentActions({ undo: true });
  const demoSlice = await invoke<{ text: string }>("slice_cmd", {
    id: state.buffer!.id,
    start: 0,
    end: 64,
  });
  setStatus(
    `Demo done: hotkey→paste→Intent→diff→Accept (${demoSlice.text})`,
  );
}

async function activateTab(id: string) {
  if (id === activeId) return;
  const result = await invoke<ShellBufferResult>("activate_tab_cmd", { id });
  await applyState(result.buffer, result.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();
  setStatus(`Switched to ${result.tabs.find((t) => t.active)?.title ?? id}`);
}

async function submitGotoLine() {
  const raw = el<HTMLInputElement>("goto-line").value;
  const result = await gotoLinePopup.submit(raw);
  if (!result.ok) {
    setStatus("Enter a 1-based line number");
    return;
  }
  setStatus(`Went to line ${result.line}`);
  await refreshStatusMetrics();
}

async function openPath() {
  try {
    const outcome = await openWithPicker(pathPicker, fileOpsPort);
    if (outcome.kind === "cancelled") {
      setStatus("Open cancelled");
      return;
    }
    if (outcome.kind === "opened") {
      setStatus(`Opened ${outcome.path}`);
    }
  } catch (err) {
    setStatus(String(err));
  }
}

async function noteRecoveryDrop(bufferId: string | null | undefined) {
  if (!bufferId) return;
  try {
    await invoke("recovery_drop_cmd", { id: bufferId });
  } catch {
    /* recovery drop is best-effort */
  }
}

async function save() {
  try {
    const savedId = activeId;
    const outcome = await saveWithPicker(pathPicker, fileOpsPort);
    if (outcome.kind === "cancelled") {
      setStatus("Save As cancelled");
      return;
    }
    if (outcome.kind === "no_active") {
      setStatus("No Buffer to save");
      return;
    }
    if (outcome.kind === "saved") {
      await noteRecoveryDrop(savedId);
      setStatus(`Saved ${outcome.path}`);
      return;
    }
    if (outcome.kind === "saved_as") {
      await noteRecoveryDrop(savedId);
      setStatus(`Saved as ${outcome.path}`);
    }
  } catch (err) {
    setStatus(String(err));
  }
}

async function saveAsPath() {
  try {
    const savedId = activeId;
    const outcome = await saveAsWithPicker(pathPicker, fileOpsPort);
    if (outcome.kind === "cancelled") {
      setStatus("Save As cancelled");
      return;
    }
    if (outcome.kind === "no_active") {
      setStatus("No Buffer to save");
      return;
    }
    if (outcome.kind === "saved_as") {
      await noteRecoveryDrop(savedId);
      setStatus(`Saved as ${outcome.path}`);
    }
  } catch (err) {
    setStatus(String(err));
  }
}

async function closeBuffer(bufferId: string) {
  try {
    const outcome = await closeTabWithPrompter(
      closePrompter,
      tabClosePort,
      bufferId,
    );
    if (outcome.kind === "missing") {
      setStatus("No Buffer to close");
      return;
    }
    if (outcome.kind === "cancelled") {
      setStatus("Close cancelled");
      return;
    }
    if (
      outcome.kind === "closed" &&
      (outcome.via === "discard" || outcome.via === "save")
    ) {
      await noteRecoveryDrop(bufferId);
    }
    if (outcome.via === "clean") {
      setStatus("Closed (clean, no prompt)");
      return;
    }
    if (outcome.via === "save") {
      setStatus("Saved and closed");
      return;
    }
    setStatus("Closed without saving");
  } catch (err) {
    setStatus(String(err));
  }
}

async function persistRecoveryOnWindowQuit(): Promise<number> {
  const result = await invoke<{ preservedCount: number }>(
    "recovery_persist_quit_cmd",
  );
  return result.preservedCount;
}

async function restoreRecoveryOnLaunch(): Promise<{
  restoredCount: number;
  buffer: BufferSnapshot | null;
  tabs: TabInfo[];
}> {
  return invoke("recovery_restore_launch_cmd");
}

async function closeActive() {
  if (!activeId) {
    setStatus("No Buffer to close");
    return;
  }
  await closeBuffer(activeId);
}

async function onHotkeyEvoke(payload: ShellBufferResult) {
  await applyState(payload.buffer, payload.tabs);
  clearPreviewPanel();
  setStatus(
    `Hotkey ${GLOBAL_HOTKEY_ACCELERATOR}: new untitled (${payload.buffer.id.slice(0, 8)}…)`,
  );
  virtualEditor.focus();
}

function showCostAndOutbound(preview: Exclude<PreviewResult, { kind: "error" }>) {
  const meta = el<HTMLElement>("intent-meta");
  meta.hidden = false;
  meta.textContent = `Cost · ~${preview.cost.latencyMsEstimate}ms · ~${preview.cost.tokensEstimate} tokens · outbound=${preview.cost.hasOutbound ? "yes" : "no"}`;

  const banner = el<HTMLElement>("outbound-banner");
  if (preview.outbound && preview.outbound.length > 0) {
    const lines = preview.outbound.map(
      (o) =>
        `Outbound → ${o.destination} (${o.task}): ${o.text.slice(0, 120)}${o.text.length > 120 ? "…" : ""}`,
    );
    banner.hidden = false;
    banner.textContent = lines.join("\n");
  } else {
    banner.hidden = true;
    banner.textContent = "";
  }
}

function renderExplanation(explanation: Explanation) {
  const panel = el<HTMLElement>("explanation-panel");
  panel.hidden = false;
  el<HTMLElement>("explanation-summary").textContent = explanation.summary;

  const list = el<HTMLElement>("explanation-anchors");
  list.replaceChildren();
  for (const anchor of explanation.anchors) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.anchorId = anchor.id;
    const label = document.createElement("span");
    label.textContent = anchor.excerpt.slice(0, 80) + (anchor.excerpt.length > 80 ? "…" : "");
    const note = document.createElement("span");
    note.className = "anchor-note";
    note.textContent = anchor.note;
    btn.append(label, note);
    btn.addEventListener("click", () => {
      void jumpToAnchor(anchor);
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function jumpToAnchor(anchor: ExplanationAnchor) {
  try {
    const result = await invoke<ResolveExplanationAnchorResult>(
      "resolve_explanation_anchor_cmd",
      { anchor },
    );
    await applyState(result.buffer, result.tabs);

    const list = el<HTMLElement>("explanation-anchors");
    for (const btn of list.querySelectorAll("button")) {
      btn.classList.toggle(
        "invalid",
        (btn as HTMLButtonElement).dataset.anchorId === anchor.id &&
          !result.resolve.ok,
      );
    }

    if (result.resolve.ok) {
      await jumpEditorTo(result.resolve.start, result.resolve.end);
      setStatus(
        `Jumped to anchor (${result.resolve.start}–${result.resolve.end}) — Buffer unchanged`,
      );
      return;
    }
    setStatus(
      `Anchor invalid (${result.resolve.reason}) — no jump; Buffer unchanged`,
    );
  } catch (err) {
    setStatus(String(err));
  }
}

async function applyPreviewResult(
  preview: PreviewResult,
  buffer: BufferSnapshot,
  tabs: TabInfo[],
  scopeHint: string,
) {
  clearPreviewPanel();
  await applyState(buffer, tabs);

  if (preview.kind === "error") {
    setStatus(`${preview.reason}: ${preview.guidance}`);
    return;
  }

  showCostAndOutbound(preview);
  pendingPreviewId = preview.previewId;
  pendingPreviewKind = preview.kind;

  const diffEl = el<HTMLElement>("patch-diff");
  if (preview.kind === "patches") {
    pendingPatches = preview.patches;
    diffEl.hidden = false;
    diffEl.textContent = await formatPatchDiffAsync(preview.patches, sliceActive);
    setIntentActions({ accept: true, reject: true });
    setSaveAsActionEnabled(false);
    setStatus(`Preview ready (${scopeHint}) — Accept or Reject`);
    return;
  }

  if (preview.kind === "explanation") {
    renderExplanation(preview.explanation);
    setIntentActions({ accept: false, reject: true });
    setSaveAsActionEnabled(false);
    setStatus("Explanation preview (read-only — click anchor to jump; Reject to dismiss)");
    return;
  }

  // RegexDraft fills Find dialog only — never Accepts into Buffer.
  const draft = preview.draft;
  await fillFindBarFromDraft(draft);
  clearFindHits();
  diffEl.hidden = false;
  diffEl.textContent = `RegexDraft filled Find dialog: /${draft.pattern}/${draft.flags ?? ""}${
    draft.replacement !== undefined ? ` → ${JSON.stringify(draft.replacement)}` : ""
  }\nBuffer unchanged — use Find / Preview replace / Replace Accept, or Save as Action.`;
  setIntentActions({ accept: false, reject: true });
  setSaveAsActionEnabled(canOfferSaveAsAction("regex_draft"));
  setStatus(
    "RegexDraft → Find dialog (no Buffer write) — Save as Action to pin for reuse",
  );
}

function renderActionList(actions: ActionView[]) {
  const list = el<HTMLElement>("action-list");
  list.replaceChildren();
  if (actions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "action-empty";
    empty.textContent =
      "No Actions yet — Save as Action from a RegexDraft preview";
    list.appendChild(empty);
    return;
  }
  for (const action of actions) {
    const row = document.createElement("li");
    row.dataset.actionId = action.id;

    const name = document.createElement("span");
    name.className = "action-name";
    name.textContent = action.displayName;
    name.title = `/${action.pattern}/${action.flags ?? ""}`;
    row.appendChild(name);

    const runBtn = document.createElement("button");
    runBtn.type = "button";
    runBtn.textContent = "Run";
    runBtn.title = "Preview-run on current Selection";
    runBtn.addEventListener("click", () => {
      void previewRunAction(action);
    });
    row.appendChild(runBtn);

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", () => {
      void renameListedAction(action);
    });
    row.appendChild(renameBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      void deleteListedAction(action);
    });
    row.appendChild(deleteBtn);

    list.appendChild(row);
  }
}

async function refreshActionList() {
  try {
    const actions = await actionPanel.refresh();
    renderActionList(actions);
  } catch (err) {
    setStatus(String(err));
  }
}

async function saveAsAction() {
  try {
    // Only offer save when UI shows a RegexDraft; otherwise pass null so
    // ActionPanel returns plain-language refusal (no compiled-regex editor).
    const idForSave = canOfferSaveAsAction(pendingPreviewKind)
      ? pendingPreviewId
      : null;
    const result = await actionPanel.save(idForSave);
    if (result.ok) {
      renderActionList(actionPanel.list());
    }
    setStatus(result.message);
  } catch (err) {
    setStatus(String(err));
  }
}

async function previewRunAction(action: ActionView) {
  if (!activeId) {
    setStatus("No active Buffer for Action");
    return;
  }
  try {
    const range = editorRange();
    const selection =
      range.start === range.end ? null : range;
    const result = await actionPanel.run(action.id, selection);
    if (!result.ok) {
      setStatus(result.message);
      return;
    }

    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, state.tabs);

    clearPreviewPanel();
    pendingPreviewId = result.run.previewId;
    pendingPreviewKind = "patches";
    pendingPatches = result.run.patches as Patch[];
    const meta = el<HTMLElement>("intent-meta");
    meta.hidden = false;
    meta.textContent = `Cost · ~${result.run.cost.latencyMsEstimate}ms · ~${result.run.cost.tokensEstimate} tokens · outbound=no (Action)`;
    el<HTMLElement>("outbound-banner").hidden = true;
    const diffEl = el<HTMLElement>("patch-diff");
    diffEl.hidden = false;
    diffEl.textContent = await formatPatchDiffAsync(pendingPatches, sliceActive);
    setIntentActions({ accept: true, reject: true });
    setSaveAsActionEnabled(false);
    setStatus(result.message);
  } catch (err) {
    setStatus(String(err));
  }
}

async function renameListedAction(action: ActionView) {
  const next = window.prompt("Rename Action", action.displayName);
  if (next === null) return;
  try {
    const result = await actionPanel.rename(action.id, next);
    if (result.ok) {
      renderActionList(actionPanel.list());
    }
    setStatus(result.message);
  } catch (err) {
    setStatus(String(err));
  }
}

async function deleteListedAction(action: ActionView) {
  const ok = window.confirm(`Delete Action “${action.displayName}”?`);
  if (!ok) return;
  try {
    const result = await actionPanel.remove(action.id);
    if (result.ok) {
      renderActionList(actionPanel.list());
    }
    setStatus(result.message);
  } catch (err) {
    setStatus(String(err));
  }
}

async function runPreview() {
  if (!activeId) {
    setStatus("No active Buffer for Intent");
    return;
  }
  const utterance = el<HTMLInputElement>("intent-input").value.trim();
  if (!utterance) {
    setStatus("Enter an Intent utterance");
    return;
  }

  try {
    const selection = editorSelection();
    const result = await invoke<PreviewIntentResult>("preview_intent_cmd", {
      utterance,
      selection: selection ?? null,
      visibleWindow: null,
    });
    await applyPreviewResult(
      result.preview,
      result.buffer,
      result.tabs,
      result.intent.scopeLabel,
    );
  } catch (err) {
    setStatus(String(err));
  }
}


async function runFind() {
  if (!activeId) {
    setStatus("No active Buffer for Find");
    return;
  }
  try {
    const result = await invoke<FindIpcResult>("find_cmd", {
      params: findParams(),
    });
    await applyState(result.buffer, result.tabs);
    setFindReplaceAccept(false);
    renderFindHits(result.hits, result.count);
    setStatus(`Find: ${result.count} hit${result.count === 1 ? "" : "s"}`);
  } catch (err) {
    setStatus(String(err));
  }
}

async function previewFindReplace() {
  if (!activeId) {
    setStatus("No active Buffer for replace preview");
    return;
  }
  try {
    const result = await invoke<PreviewReplaceIpcResult>("preview_replace_cmd", {
      params: findParams(),
    });
    await applyState(result.buffer, result.tabs);
    const hitsEl = el<HTMLElement>("find-hits");
    hitsEl.hidden = false;
    if (!result.preview.ok) {
      setFindReplaceAccept(false);
      hitsEl.textContent = `Replace preview failed: ${result.preview.reason}`;
      setStatus(`Replace preview: ${result.preview.reason}`);
      return;
    }
    setFindReplaceAccept(true);
    hitsEl.textContent = await formatPatchDiffAsync(
      result.preview.patches,
      sliceActive,
    );
    setStatus(
      "Replace preview ready — Replace Accept writes via IntentService (UndoGroup)",
    );
  } catch (err) {
    setStatus(String(err));
  }
}

async function acceptFindReplace() {
  if (!activeId) {
    setStatus("No active Buffer for replace");
    return;
  }
  try {
    const result = await invoke<ReplaceAcceptIpcResult>("replace_accept_cmd", {
      params: findParams(),
    });
    if (!result.accept.ok) {
      setStatus(`Replace Accept failed: ${result.accept.reason}`);
      return;
    }
    lastUndoGroupId = result.accept.undoGroupId;
    await applyState(result.buffer, result.tabs);
    clearFindHits();
    setIntentActions({ undo: true });
    setStatus(
      `FindBar replace Accepted — UndoGroup ${lastUndoGroupId.slice(0, 8)}…`,
    );
  } catch (err) {
    setStatus(String(err));
  }
}

async function acceptPreview() {
  if (!pendingPatches || pendingPatches.length === 0) {
    setStatus("No Patch preview to Accept");
    return;
  }
  try {
    const result = await invoke<AcceptIpcResult>("accept_cmd", {
      patches: pendingPatches,
    });
    if (!result.accept.ok) {
      setStatus(`Accept failed: ${result.accept.reason}`);
      return;
    }
    lastUndoGroupId = result.accept.undoGroupId;
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    await applyState(state.buffer, state.tabs);
    clearPreviewPanel();
    setIntentActions({ undo: true });
    setStatus(`Accepted — UndoGroup ${lastUndoGroupId.slice(0, 8)}…`);
  } catch (err) {
    setStatus(String(err));
  }
}

async function rejectPreview() {
  if (!pendingPreviewId) {
    setStatus("No preview to Reject");
    return;
  }
  try {
    await invoke("reject_preview_cmd", { previewId: pendingPreviewId });
    clearPreviewPanel();
    setStatus("Preview rejected — Buffer unchanged");
  } catch (err) {
    setStatus(String(err));
  }
}

async function undoLast() {
  if (!lastUndoGroupId) {
    setStatus("Nothing to Undo");
    return;
  }
  try {
    const result = await invoke<ShellBufferResult>("undo_cmd", {
      undoGroupId: lastUndoGroupId,
    });
    lastUndoGroupId = null;
    await applyState(result.buffer, result.tabs);
    setIntentActions({ undo: false });
    setStatus("UndoGroup restored Buffer");
  } catch (err) {
    setStatus(String(err));
  }
}

async function onCloudToggle() {
  const enabled = el<HTMLInputElement>("cloud-enabled").checked;
  try {
    await invoke("set_cloud_enabled_cmd", { enabled });
    setStatus(
      enabled
        ? "Cloud path on — next Preview will surface Outbound"
        : "Cloud path off",
    );
  } catch (err) {
    setStatus(String(err));
  }
}

async function onSuggestionsToggle() {
  const enabled = el<HTMLInputElement>("suggestions-enabled").checked;
  try {
    const result = await invoke<{ enabled: boolean }>(
      "set_suggestions_enabled_cmd",
      { enabled },
    );
    if (!result.enabled) {
      clearSuggestionsBar();
    }
    setStatus(
      result.enabled
        ? "Suggestions on — paste may offer a few next steps"
        : "Suggestions off (global)",
    );
  } catch (err) {
    setStatus(String(err));
  }
}

function renderSuggestions(items: Suggestion[]) {
  const bar = el<HTMLElement>("suggestions-bar");
  bar.replaceChildren();
  if (items.length === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const label = document.createElement("span");
  label.textContent = "Suggestions:";
  bar.appendChild(label);
  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "suggestion-chip";
    btn.textContent = item.label;
    btn.title = item.utterance;
    btn.addEventListener("click", () => {
      void selectSuggestion(item);
    });
    bar.appendChild(btn);
  }
}

async function onEditorPaste(ev: ClipboardEvent) {
  if (!el<HTMLInputElement>("suggestions-enabled").checked) {
    clearSuggestionsBar();
    return;
  }
  const clipboardText = ev.clipboardData?.getData("text") ?? "";
  if (!clipboardText.trim()) {
    clearSuggestionsBar();
    return;
  }
  try {
    const result = await invoke<{ suggestions: Suggestion[] }>(
      "suggestions_for_paste_cmd",
      { clipboardText },
    );
    renderSuggestions(result.suggestions);
    if (result.suggestions.length > 0) {
      setStatus(
        `${result.suggestions.length} Suggestion(s) — select one to enter Intent preview (does not write Buffer)`,
      );
    }
  } catch (err) {
    setStatus(String(err));
  }
}

async function selectSuggestion(suggestion: Suggestion) {
  if (!activeId) {
    setStatus("No active Buffer for Suggestion");
    return;
  }
  try {
    const selection = editorSelection();
    const result = await invoke<SelectSuggestionResult>("select_suggestion_cmd", {
      suggestion,
      selection: selection ?? null,
    });
    el<HTMLInputElement>("intent-input").value = result.utterance;
    clearSuggestionsBar();
    await applyPreviewResult(
      result.preview,
      result.buffer,
      result.tabs,
      "Suggestion",
    );
    if (result.preview.kind !== "error") {
      setStatus(
        `Suggestion → Intent preview (${result.utterance}) — Buffer not written`,
      );
    }
  } catch (err) {
    setStatus(String(err));
  }
}

function openFindChrome(): void {
  findDialog.setFields(readFindFieldsFromDom());
  findDialog.focusPattern();
}

function closeChromeMenus(): void {
  for (const id of ["file-menu", "help-menu"] as const) {
    const menu = document.getElementById(id);
    if (menu instanceof HTMLDetailsElement) menu.open = false;
  }
}

function appendMenuItem(
  list: HTMLUListElement,
  opts: {
    id: ShellChromeAction;
    label: string;
    accelerator?: string;
    handlers: ShellChromeHandlers;
  },
): void {
  const li = document.createElement("li");
  li.setAttribute("role", "none");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("role", "menuitem");
  btn.dataset.shellAction = opts.id;
  const label = document.createElement("span");
  label.textContent = opts.label;
  btn.append(label);
  if (opts.accelerator) {
    const accel = document.createElement("span");
    accel.className = "accel";
    accel.textContent = opts.accelerator;
    btn.append(accel);
  }
  btn.addEventListener("click", () => {
    closeChromeMenus();
    void Promise.resolve(runShellAction(opts.id, opts.handlers)).catch((err) =>
      setStatus(String(err)),
    );
  });
  li.append(btn);
  list.append(li);
}

function mountShellMenus(handlers: ShellChromeHandlers): void {
  const fileList = el<HTMLUListElement>("file-menu-list");
  fileList.replaceChildren();
  for (const item of SHELL_FILE_MENU_ITEMS) {
    appendMenuItem(fileList, {
      id: item.id,
      label: item.label,
      accelerator: item.accelerator,
      handlers,
    });
  }

  const helpList = el<HTMLUListElement>("help-menu-list");
  helpList.replaceChildren();
  for (const item of SHELL_HELP_MENU_ITEMS) {
    appendMenuItem(helpList, {
      id: item.id,
      label: item.label,
      accelerator: item.accelerator,
      handlers,
    });
  }

  // WebView2 keeps <details> open on outside click — dismiss explicitly.
  document.addEventListener(
    "pointerdown",
    (ev) => {
      for (const id of ["file-menu", "help-menu"] as const) {
        const menu = document.getElementById(id);
        if (!(menu instanceof HTMLDetailsElement)) continue;
        if (shouldDismissDetailsMenu(menu, ev.target)) menu.open = false;
      }
    },
    true,
  );
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closeChromeMenus();
  });
}

function openAboutDialog(): void {
  const info = aboutInfoFromConfig({
    productName: APP_PRODUCT_NAME,
    version: APP_VERSION,
  });
  el("about-name").textContent = info.name;
  el("about-version").textContent = `Version ${info.version}`;
  el("about-blurb").textContent = info.blurb;
  const dialog = el<HTMLDialogElement>("about-dialog");
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Re-bind after body exists so the overlay mounts under .app when preferred.
  closePrompter = createDomClosePrompter(
    document.querySelector(".app") ?? document.body,
  );
  const shellHandlers: ShellChromeHandlers = {
    new: () => evoke().catch((err) => setStatus(String(err))),
    open: () => openPath(),
    save: () => save(),
    save_as: () => saveAsPath(),
    find: () => openFindChrome(),
    demo: () => runVisualDemo().catch((err) => setStatus(String(err))),
    about: () => openAboutDialog(),
    // Same three-way ClosePrompter path as the tab × button.
    close: () => closeActive(),
  };

  mountShellMenus(shellHandlers);
  mountTitleChrome();

  virtualEditor = new VirtualEditor(
    el("editor-viewport"),
    el("editor-spacer"),
    el("editor-window"),
    el("editor"),
    {
      lineWindow: (id, lineStart, lineCount) =>
        invoke("line_window_cmd", { id, lineStart, lineCount }),
      lineCount: async (id) => {
        const r = await invoke<{ lineCount: number }>("buffer_line_count_cmd", { id });
        return r.lineCount;
      },
      editRange: async (start, end, replacement) => {
        const result = await invoke<ShellBufferResult>("edit_active_cmd", {
          start, end, replacement,
        });
        renderTabs(result.tabs);
        activeId = result.buffer.id;
        await syncTitleChrome(result.tabs.find((t) => t.active));
        // Metrics refresh after VirtualEditor updates lineCount (see flushEdit);
        // also refresh here for length/caret when no further selection event fires.
        void refreshStatusMetrics();
        return { revision: result.buffer.revision };
      },
    },
    el("line-gutter"),
  );
  const editorEl = el<HTMLTextAreaElement>("editor");
  editorEl.addEventListener("paste", (ev) => {
    void onEditorPaste(ev);
  });
  // Caret moves update 行/列/位置 without touching the left status message.
  for (const evt of ["keyup", "click", "select", "input"] as const) {
    editorEl.addEventListener(evt, () => {
      void refreshStatusMetrics();
    });
  }
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === editorEl) {
      void refreshStatusMetrics();
    }
  });
  const gotoSurface: GotoLinePopupSurface = {
    present() {
      el<HTMLElement>("goto-line-popup").hidden = false;
      el<HTMLInputElement>("goto-line").value = "";
    },
    dismiss() {
      el<HTMLElement>("goto-line-popup").hidden = true;
    },
    focusInput() {
      const input = el<HTMLInputElement>("goto-line");
      input.focus();
      input.select();
    },
  };
  gotoLinePopup = new GotoLinePopup(
    {
      async gotoLine(line) {
        await virtualEditor.gotoLine(line);
        await refreshStatusMetrics();
      },
    },
    gotoSurface,
  );
  el<HTMLInputElement>("goto-line").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitGotoLine();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      gotoLinePopup.closePopup();
    }
  });
  window.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.toLowerCase() === "g") {
      ev.preventDefault();
      gotoLinePopup.openPopup();
      return;
    }
    if (ev.key === "Escape" && gotoLinePopup.isOpen()) {
      ev.preventDefault();
      gotoLinePopup.closePopup();
      return;
    }
    const shellAction = resolveShellShortcut(ev);
    if (shellAction) {
      ev.preventDefault();
      void Promise.resolve(runShellAction(shellAction, shellHandlers)).catch(
        (err) => setStatus(String(err)),
      );
    }
  });

  el<HTMLButtonElement>("intent-preview").addEventListener("click", () => {
    void runPreview();
  });
  el<HTMLButtonElement>("intent-accept").addEventListener("click", () => {
    void acceptPreview();
  });
  el<HTMLButtonElement>("intent-reject").addEventListener("click", () => {
    void rejectPreview();
  });
  el<HTMLButtonElement>("intent-undo").addEventListener("click", () => {
    void undoLast();
  });
  el<HTMLButtonElement>("save-as-action").addEventListener("click", () => {
    void saveAsAction();
  });
  el<HTMLButtonElement>("action-refresh").addEventListener("click", () => {
    void refreshActionList().then(() => setStatus("Action 列表已刷新"));
  });
  el<HTMLInputElement>("cloud-enabled").addEventListener("change", () => {
    void onCloudToggle();
  });
  el<HTMLInputElement>("suggestions-enabled").addEventListener("change", () => {
    void onSuggestionsToggle();
  });
  el<HTMLInputElement>("intent-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void runPreview();
    }
  });

  el<HTMLButtonElement>("find-close").addEventListener("click", () => {
    findDialog.closeDialog();
  });
  el<HTMLButtonElement>("find-go").addEventListener("click", () => {
    findDialog.setFields(readFindFieldsFromDom());
    void runFind();
  });
  el<HTMLButtonElement>("find-preview-replace").addEventListener("click", () => {
    findDialog.setFields(readFindFieldsFromDom());
    void previewFindReplace();
  });
  el<HTMLButtonElement>("find-replace-accept").addEventListener("click", () => {
    findDialog.setFields(readFindFieldsFromDom());
    void acceptFindReplace();
  });
  el<HTMLInputElement>("find-pattern").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      findDialog.setFields(readFindFieldsFromDom());
      void runFind();
    }
  });

  void listen<ShellBufferResult>(HOTKEY_EVOKE_EVENT, (event) => {
    void onHotkeyEvoke(event.payload);
  }).catch((err) => setStatus(String(err)));

  void listen<string>("hotkey-evoke-error", (event) => {
    setStatus(`Hotkey evoke failed: ${event.payload}`);
  }).catch(() => {
    /* optional channel */
  });

  // Window close: RecoveryBuffer persist only — never per-tab three-button storm.
  // Must destroy/close after preventDefault; destroy needs core:window:allow-destroy.
  void getCurrentWindow()
    .onCloseRequested(async (event) => {
      event.preventDefault();
      const win = getCurrentWindow();
      try {
        const outcome = await runWindowQuitRecovery({
          persistDirty: persistRecoveryOnWindowQuit,
        });
        if (outcome.statusMessage) {
          setStatus(outcome.statusMessage);
          await new Promise((r) => setTimeout(r, 350));
        }
      } catch (err) {
        setStatus(String(err));
        await new Promise((r) => setTimeout(r, 350));
      }
      try {
        await win.destroy();
      } catch (err) {
        setStatus(`Window destroy failed: ${String(err)}`);
        try {
          await win.close();
        } catch (closeErr) {
          setStatus(`Window close failed: ${String(closeErr)}`);
        }
      }
    })
    .catch(() => {
      /* non-Tauri / capability missing — contracts cover the seam */
    });

  void (async () => {
    try {
      const state = await invoke<{ enabled: boolean }>(
        "get_suggestions_enabled_cmd",
      );
      el<HTMLInputElement>("suggestions-enabled").checked = state.enabled;
    } catch {
      el<HTMLInputElement>("suggestions-enabled").checked = false;
    }

    let restoredCount = 0;
    try {
      const restored = await restoreRecoveryOnLaunch();
      restoredCount = restored.restoredCount;
      if (restoredCount > 0) {
        await applyState(restored.buffer, restored.tabs);
        clearPreviewPanel();
        clearSuggestionsBar();
        clearFindHits();
      } else {
        await evoke();
      }
    } catch {
      await evoke();
    }

    await refreshActionList();
    try {
      const accel = await invoke<string>("get_global_hotkey_cmd");
      if (restoredCount > 0) {
        setStatus(`已恢复未保存标签 — global hotkey ${accel}`);
      } else {
        setStatus(`Ready — global hotkey ${accel}`);
      }
    } catch {
      if (restoredCount > 0) {
        setStatus(
          `已恢复未保存标签 — global hotkey ${GLOBAL_HOTKEY_ACCELERATOR}`,
        );
      } else {
        setStatus(`Ready — global hotkey ${GLOBAL_HOTKEY_ACCELERATOR}`);
      }
    }
  })().catch((err) => setStatus(String(err)));
});
