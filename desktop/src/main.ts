import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ActionPanel,
  type ActionPanelPort,
  type ActionView,
} from "./action-panel.ts";
import {
  canOfferSaveAsAction,
  type PreviewKindForSave,
} from "./action-ui.ts";
import {
  chooseSaveAction,
  pathInputValueForActive,
} from "./path-toolbar.ts";
import { formatPatchDiff, type Patch } from "./patch-diff.ts";

/** Mirrors nova `GLOBAL_HOTKEY_ACCELERATOR` / Tauri registration. */
const GLOBAL_HOTKEY_ACCELERATOR = "Ctrl+Alt+N";
/** Mirrors nova `HOTKEY_EVOKE_EVENT`. */
const HOTKEY_EVOKE_EVENT = "hotkey-evoke";

type BufferSnapshot = {
  id: string;
  text: string;
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

let applyingRemote = false;
let activeId: string | null = null;
let pendingPreviewId: string | null = null;
let pendingPreviewKind: PreviewKindForSave = null;
let pendingPatches: Patch[] | null = null;
let lastUndoGroupId: string | null = null;
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function setStatus(message: string) {
  el<HTMLElement>("status").textContent = message;
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
  const editor = el<HTMLTextAreaElement>("editor");
  return { start: editor.selectionStart, end: editor.selectionEnd };
}

function renderTabs(tabs: TabInfo[]) {
  const bar = el<HTMLElement>("tab-bar");
  bar.replaceChildren();
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = tab.active ? "tab active" : "tab";
    btn.textContent = tab.title;
    btn.dataset.bufferId = tab.bufferId;
    btn.addEventListener("click", () => {
      void activateTab(tab.bufferId);
    });
    bar.appendChild(btn);
  }
}

function applyState(buffer: BufferSnapshot | null, tabs: TabInfo[]) {
  const editor = el<HTMLTextAreaElement>("editor");
  const pathInput = el<HTMLInputElement>("path-input");
  activeId = buffer?.id ?? null;
  renderTabs(tabs);
  applyingRemote = true;
  editor.disabled = !buffer;
  editor.value = buffer?.text ?? "";
  applyingRemote = false;
  const active = tabs.find((t) => t.active);
  // Always sync — untitled must clear so Save cannot reuse another tab's Path.
  pathInput.value = pathInputValueForActive(active);
}

function editorSelection():
  | { start: number; end: number }
  | undefined {
  const editor = el<HTMLTextAreaElement>("editor");
  if (editor.selectionStart !== editor.selectionEnd) {
    return { start: editor.selectionStart, end: editor.selectionEnd };
  }
  return undefined;
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
  hitsEl.textContent = "";
}

function fillFindBarFromDraft(draft: {
  pattern: string;
  replacement?: string;
  flags?: string;
}) {
  el<HTMLInputElement>("find-pattern").value = draft.pattern;
  el<HTMLInputElement>("find-replacement").value = draft.replacement ?? "";
  const flags = draft.flags ?? "";
  el<HTMLInputElement>("find-flag-i").checked = flags.includes("i");
  el<HTMLInputElement>("find-flag-m").checked = flags.includes("m");
  el<HTMLInputElement>("find-flag-s").checked = flags.includes("s");
}

function formatFindHits(hits: FindHit[], count: number): string {
  if (count === 0) return "0 hits";
  const lines = hits.slice(0, 50).map((h, i) => {
    const groups =
      Object.keys(h.groups).length > 0
        ? ` groups=${JSON.stringify(h.groups)}`
        : "";
    return `${i + 1}. [${h.start},${h.end}) ${JSON.stringify(h.match)}${groups}`;
  });
  if (count > 50) lines.push(`…and ${count - 50} more`);
  return `${count} hit${count === 1 ? "" : "s"}\n${lines.join("\n")}`;
}

function jumpEditorTo(start: number, end: number) {
  const editor = el<HTMLTextAreaElement>("editor");
  editor.focus();
  editor.setSelectionRange(start, end);
  // Approximate scroll so the jumped span is visible.
  const before = editor.value.slice(0, start);
  const line = before.split("\n").length;
  const lineHeight = editor.scrollHeight / Math.max(editor.value.split("\n").length, 1);
  editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
}

async function evoke() {
  const result = await invoke<ShellBufferResult>("evoke_cmd");
  applyState(result.buffer, result.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();
  setStatus(`New untitled Buffer (${result.buffer.id.slice(0, 8)}…)`);
  el<HTMLTextAreaElement>("editor").focus();
}

/** Visual ten-second Demo (WUF-87): new Buffer → paste → Intent → diff → Accept. */
async function runVisualDemo() {
  const pasteText = "hello demo";
  const utterance = "make it uppercase";
  const selection = { start: 0, end: 5 };

  setStatus("Demo: evoke new Buffer…");
  const evoked = await invoke<ShellBufferResult>("evoke_cmd");
  applyState(evoked.buffer, evoked.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();

  setStatus("Demo: paste…");
  const pasted = await invoke<ShellBufferResult>("edit_active_cmd", {
    text: pasteText,
  });
  applyState(pasted.buffer, pasted.tabs);
  const editor = el<HTMLTextAreaElement>("editor");
  editor.focus();
  editor.setSelectionRange(selection.start, selection.end);

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
  applyState(state.buffer, state.tabs);
  clearPreviewPanel();
  setIntentActions({ undo: true });
  setStatus(
    `Demo done: hotkey→paste→Intent→diff→Accept (${state.buffer?.text ?? ""})`,
  );
}

async function activateTab(id: string) {
  if (id === activeId) return;
  const result = await invoke<ShellBufferResult>("activate_tab_cmd", { id });
  applyState(result.buffer, result.tabs);
  clearPreviewPanel();
  clearSuggestionsBar();
  clearFindHits();
  setStatus(`Switched to ${result.tabs.find((t) => t.active)?.title ?? id}`);
}

async function onEdit() {
  if (applyingRemote || !activeId) return;
  const text = el<HTMLTextAreaElement>("editor").value;
  const result = await invoke<ShellBufferResult>("edit_active_cmd", { text });
  applyState(result.buffer, result.tabs);
}

async function openPath() {
  const path = el<HTMLInputElement>("path-input").value.trim();
  if (!path) {
    setStatus("Enter a Path to open");
    return;
  }
  try {
    const result = await invoke<ShellBufferResult>("open_path_cmd", { path });
    applyState(result.buffer, result.tabs);
    clearPreviewPanel();
    clearSuggestionsBar();
    clearFindHits();
    setStatus(`Opened ${path}`);
  } catch (err) {
    setStatus(String(err));
  }
}

async function save() {
  const pathInput = el<HTMLInputElement>("path-input");
  const tabs = await invoke<ShellTabsResult>("list_tabs_cmd");
  const active = tabs.tabs.find((t) => t.active);
  const action = chooseSaveAction(active, pathInput.value);
  try {
    let result: ShellTabsResult;
    if (action === "need_path") {
      setStatus("Enter a Path to save (untitled Buffer needs save-as)");
      return;
    }
    if (action === "save") {
      result = await invoke<ShellTabsResult>("save_active_cmd");
      setStatus(`Saved ${active!.path}`);
    } else {
      result = await invoke<ShellTabsResult>("save_active_as_cmd", {
        path: action.saveAs,
      });
      setStatus(`Saved as ${action.saveAs}`);
    }
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    applyState(state.buffer, result.tabs);
  } catch (err) {
    setStatus(String(err));
  }
}

async function closeActive() {
  if (!activeId) {
    setStatus("No Buffer to close");
    return;
  }
  const id = activeId;
  try {
    const result = await invoke<ShellCloseResult>("request_close_cmd", { id });
    if (!result.close.ok) {
      const message =
        result.close.reason === "confirm_discard_untitled"
          ? "Discard unsaved untitled Buffer?"
          : "Discard unsaved changes?";
      if (!window.confirm(message)) {
        applyState(
          (await invoke<ShellStateResult>("get_shell_state_cmd")).buffer,
          result.tabs,
        );
        setStatus("Close cancelled");
        return;
      }
      const confirmed = await invoke<ShellCloseResult>("confirm_close_cmd", {
        id,
      });
      const state = await invoke<ShellStateResult>("get_shell_state_cmd");
      applyState(state.buffer, confirmed.tabs);
      clearPreviewPanel();
      clearSuggestionsBar();
      clearFindHits();
      setStatus("Closed after confirm");
      return;
    }
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    applyState(state.buffer, result.tabs);
    clearPreviewPanel();
    clearSuggestionsBar();
    clearFindHits();
    setStatus(result.close.asked ? "Closed" : "Closed (clean, no prompt)");
  } catch (err) {
    setStatus(String(err));
  }
}

async function onHotkeyEvoke(payload: ShellBufferResult) {
  applyState(payload.buffer, payload.tabs);
  clearPreviewPanel();
  setStatus(
    `Hotkey ${GLOBAL_HOTKEY_ACCELERATOR}: new untitled (${payload.buffer.id.slice(0, 8)}…)`,
  );
  el<HTMLTextAreaElement>("editor").focus();
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
    applyState(result.buffer, result.tabs);

    const list = el<HTMLElement>("explanation-anchors");
    for (const btn of list.querySelectorAll("button")) {
      btn.classList.toggle(
        "invalid",
        (btn as HTMLButtonElement).dataset.anchorId === anchor.id &&
          !result.resolve.ok,
      );
    }

    if (result.resolve.ok) {
      jumpEditorTo(result.resolve.start, result.resolve.end);
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
  applyState(buffer, tabs);

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
    diffEl.textContent = formatPatchDiff(buffer.text, preview.patches);
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

  // RegexDraft fills FindBar only — never Accepts into Buffer.
  const draft = preview.draft;
  await invoke<ApplyDraftIpcResult>("apply_draft_cmd", { draft });
  fillFindBarFromDraft(draft);
  clearFindHits();
  diffEl.hidden = false;
  diffEl.textContent = `RegexDraft filled FindBar: /${draft.pattern}/${draft.flags ?? ""}${
    draft.replacement !== undefined ? ` → ${JSON.stringify(draft.replacement)}` : ""
  }\nBuffer unchanged — use Find / Preview replace / Replace Accept, or Save as Action.`;
  setIntentActions({ accept: false, reject: true });
  setSaveAsActionEnabled(canOfferSaveAsAction("regex_draft"));
  setStatus(
    "RegexDraft → FindBar (no Buffer write) — Save as Action to pin for reuse",
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
    applyState(state.buffer, state.tabs);

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
    diffEl.textContent = formatPatchDiff(
      state.buffer?.text ?? "",
      pendingPatches,
    );
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
    applyState(result.buffer, result.tabs);
    setFindReplaceAccept(false);
    const hitsEl = el<HTMLElement>("find-hits");
    hitsEl.hidden = false;
    hitsEl.textContent = formatFindHits(result.hits, result.count);
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
    applyState(result.buffer, result.tabs);
    const hitsEl = el<HTMLElement>("find-hits");
    hitsEl.hidden = false;
    if (!result.preview.ok) {
      setFindReplaceAccept(false);
      hitsEl.textContent = `Replace preview failed: ${result.preview.reason}`;
      setStatus(`Replace preview: ${result.preview.reason}`);
      return;
    }
    setFindReplaceAccept(true);
    hitsEl.textContent = formatPatchDiff(
      result.buffer.text,
      result.preview.patches,
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
    applyState(result.buffer, result.tabs);
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
    applyState(state.buffer, state.tabs);
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
    applyState(result.buffer, result.tabs);
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

window.addEventListener("DOMContentLoaded", () => {
  el<HTMLButtonElement>("new-tab").addEventListener("click", () => {
    void evoke().catch((err) => setStatus(String(err)));
  });
  el<HTMLButtonElement>("run-demo").addEventListener("click", () => {
    void runVisualDemo().catch((err) => setStatus(String(err)));
  });
  el<HTMLButtonElement>("open-path").addEventListener("click", () => {
    void openPath();
  });
  el<HTMLButtonElement>("save").addEventListener("click", () => {
    void save();
  });
  el<HTMLButtonElement>("close-tab").addEventListener("click", () => {
    void closeActive();
  });
  el<HTMLTextAreaElement>("editor").addEventListener("input", () => {
    void onEdit().catch((err) => setStatus(String(err)));
  });
  el<HTMLTextAreaElement>("editor").addEventListener("paste", (ev) => {
    void onEditorPaste(ev);
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

  el<HTMLButtonElement>("find-go").addEventListener("click", () => {
    void runFind();
  });
  el<HTMLButtonElement>("find-preview-replace").addEventListener("click", () => {
    void previewFindReplace();
  });
  el<HTMLButtonElement>("find-replace-accept").addEventListener("click", () => {
    void acceptFindReplace();
  });
  el<HTMLInputElement>("find-pattern").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
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

  void (async () => {
    try {
      const state = await invoke<{ enabled: boolean }>(
        "get_suggestions_enabled_cmd",
      );
      el<HTMLInputElement>("suggestions-enabled").checked = state.enabled;
    } catch {
      el<HTMLInputElement>("suggestions-enabled").checked = false;
    }
    await evoke();
    await refreshActionList();
    try {
      const accel = await invoke<string>("get_global_hotkey_cmd");
      setStatus(`Ready — global hotkey ${accel}`);
    } catch {
      setStatus(`Ready — global hotkey ${GLOBAL_HOTKEY_ACCELERATOR}`);
    }
  })().catch((err) => setStatus(String(err)));
});
