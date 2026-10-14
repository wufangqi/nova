/**
 * Global hotkey port for the desktop shell (WUF-83).
 *
 * Domain side: press always evokes a new untitled Buffer and keeps open tabs.
 * OS side (Tauri): register GLOBAL_HOTKEY_ACCELERATOR, focus the window, run
 * the same evoke path, emit HOTKEY_EVOKE_EVENT so the UI refreshes.
 */
import type { EditorShell } from "./editor-shell.js";
import type { BufferSnapshot } from "./types.js";

/** Windows-first accelerator registered by the Tauri global-shortcut plugin. */
export const GLOBAL_HOTKEY_ACCELERATOR = "Ctrl+Alt+N";

/** Desktop event payload: ShellBufferResult after a successful hotkey evoke. */
export const HOTKEY_EVOKE_EVENT = "hotkey-evoke";

/** What the OS hotkey port must do on press (domain). */
export function onGlobalHotkeyPressed(shell: EditorShell): BufferSnapshot {
  return shell.handleHotkeyEvoke();
}
