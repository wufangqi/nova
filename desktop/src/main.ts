import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
      explanation: { summary: string };
      cost: Cost;
      outbound?: Outbound[];
    }
  | {
      kind: "regex_draft";
      previewId: string;
      draft: { pattern: string };
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

type AcceptIpcResult = {
  accept: { ok: true; undoGroupId: string } | { ok: false; reason: string };
  buffers: BufferSnapshot[];
};

let applyingRemote = false;
let activeId: string | null = null;
let pendingPreviewId: string | null = null;
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

function clearPreviewPanel() {
  pendingPreviewId = null;
  pendingPatches = null;
  el<HTMLElement>("intent-meta").hidden = true;
  el<HTMLElement>("intent-meta").textContent = "";
  el<HTMLElement>("outbound-banner").hidden = true;
  el<HTMLElement>("outbound-banner").textContent = "";
  el<HTMLElement>("patch-diff").hidden = true;
  el<HTMLElement>("patch-diff").textContent = "";
  setIntentActions({ accept: false, reject: false });
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

async function evoke() {
  const result = await invoke<ShellBufferResult>("evoke_cmd");
  applyState(result.buffer, result.tabs);
  clearPreviewPanel();
  setStatus(`New untitled Buffer (${result.buffer.id.slice(0, 8)}…)`);
  el<HTMLTextAreaElement>("editor").focus();
}

async function activateTab(id: string) {
  if (id === activeId) return;
  const result = await invoke<ShellBufferResult>("activate_tab_cmd", { id });
  applyState(result.buffer, result.tabs);
  clearPreviewPanel();
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
      setStatus("Closed after confirm");
      return;
    }
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    applyState(state.buffer, result.tabs);
    clearPreviewPanel();
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

    clearPreviewPanel();
    applyState(result.buffer, result.tabs);

    if (result.preview.kind === "error") {
      setStatus(`${result.preview.reason}: ${result.preview.guidance}`);
      return;
    }

    showCostAndOutbound(result.preview);
    pendingPreviewId = result.preview.previewId;

    const diffEl = el<HTMLElement>("patch-diff");
    if (result.preview.kind === "patches") {
      pendingPatches = result.preview.patches;
      diffEl.hidden = false;
      diffEl.textContent = formatPatchDiff(
        result.buffer.text,
        result.preview.patches,
      );
      setIntentActions({ accept: true, reject: true });
      setStatus(
        `Preview ready (${result.intent.scopeLabel}) — Accept or Reject`,
      );
      return;
    }

    if (result.preview.kind === "explanation") {
      diffEl.hidden = false;
      diffEl.textContent = result.preview.explanation.summary;
      setIntentActions({ accept: false, reject: true });
      setStatus("Explanation preview (read-only — Reject to dismiss)");
      return;
    }

    diffEl.hidden = false;
    diffEl.textContent = `RegexDraft: /${result.preview.draft.pattern}/`;
    setIntentActions({ accept: false, reject: true });
    setStatus("RegexDraft preview (fills FindBar later — Reject to dismiss)");
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

window.addEventListener("DOMContentLoaded", () => {
  el<HTMLButtonElement>("new-tab").addEventListener("click", () => {
    void evoke().catch((err) => setStatus(String(err)));
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
  el<HTMLInputElement>("cloud-enabled").addEventListener("change", () => {
    void onCloudToggle();
  });
  el<HTMLInputElement>("intent-input").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void runPreview();
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

  void evoke()
    .then(async () => {
      try {
        const accel = await invoke<string>("get_global_hotkey_cmd");
        setStatus(`Ready — global hotkey ${accel}`);
      } catch {
        setStatus(`Ready — global hotkey ${GLOBAL_HOTKEY_ACCELERATOR}`);
      }
    })
    .catch((err) => setStatus(String(err)));
});
