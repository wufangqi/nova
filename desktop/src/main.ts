import { invoke } from "@tauri-apps/api/core";

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

let applyingRemote = false;
let activeId: string | null = null;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function setStatus(message: string) {
  el<HTMLElement>("status").textContent = message;
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
  if (active?.path) pathInput.value = active.path;
  else if (!active) pathInput.value = "";
}

async function evoke() {
  const result = await invoke<ShellBufferResult>("evoke_cmd");
  applyState(result.buffer, result.tabs);
  setStatus(`New untitled Buffer (${result.buffer.id.slice(0, 8)}…)`);
  el<HTMLTextAreaElement>("editor").focus();
}

async function activateTab(id: string) {
  if (id === activeId) return;
  const result = await invoke<ShellBufferResult>("activate_tab_cmd", { id });
  applyState(result.buffer, result.tabs);
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
    setStatus(`Opened ${path}`);
  } catch (err) {
    setStatus(String(err));
  }
}

async function save() {
  const pathInput = el<HTMLInputElement>("path-input");
  const path = pathInput.value.trim();
  const tabs = await invoke<ShellTabsResult>("list_tabs_cmd");
  const active = tabs.tabs.find((t) => t.active);
  try {
    let result: ShellTabsResult;
    if (!active || active.untitled || (path && path !== active.path)) {
      if (!path) {
        setStatus("Enter a Path to save (untitled Buffer needs save-as)");
        return;
      }
      result = await invoke<ShellTabsResult>("save_active_as_cmd", { path });
      setStatus(`Saved as ${path}`);
    } else {
      result = await invoke<ShellTabsResult>("save_active_cmd");
      setStatus(`Saved ${active.path}`);
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
      setStatus("Closed after confirm");
      return;
    }
    const state = await invoke<ShellStateResult>("get_shell_state_cmd");
    applyState(state.buffer, result.tabs);
    setStatus(result.close.asked ? "Closed" : "Closed (clean, no prompt)");
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

  void evoke().catch((err) => setStatus(String(err)));
});
