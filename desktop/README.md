# Nova desktop (Tauri)

WUF-81…87 — Windows-first Tauri shell: IntentService IPC + EditorShell multi-Buffer UI + OS global hotkey + Intent preview + visual ten-second Demo.

## Prerequisites (Windows)

- Node.js 20+
- Rust stable (`rustup`)
- WebView2 (bundled bootstrapper configured in `tauri.conf.json`)

Linux/macOS are best-effort only (ADR-0004).

## Dev (Windows)

From the **nova repo root**:

```bash
npm install
npm run build
npm --prefix desktop install
npm run desktop:dev
```

Editor smoke in the window:

1. App opens with one Untitled tab — type to edit (title shows `*`)
2. **New** → second tab; click tabs to switch
3. Enter a Path → **Open** / **Save** (untitled uses save-as)
4. **Close** on clean untitled → no prompt; dirty → confirm discard
5. **Ctrl+Alt+N** (global) → app focuses, new untitled Buffer, prior tabs kept
6. Type Intent (e.g. `uppercase`) → **Preview** → see diff + Cost → **Accept** / **Reject**; **Undo** after Accept
7. Toggle **Cloud path** → Preview shows Outbound banner
8. **Demo** → one-click visual ten-second path (new Buffer → paste `hello demo` → Intent → diff → Accept). Without a local model, AI fails with guidance and the editor stays usable.

Scriptable (no GUI): from repo root, `npm run demo:visual-ten-second` drives the same IPC methods.

### Cold start / evoke smoke (Windows)

```bash
npm run build
npm --prefix desktop install
# Optional CDP: set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
npm run desktop:dev
# Cold start: window appears with Ready + global hotkey Ctrl+Alt+N
# Evoke: Ctrl+Alt+N (or Demo) → new untitled; prior tabs kept
# Demo: toolbar Demo → hello demo → HELLO demo + Undo
```

Release / package smoke (optional): `npm run desktop:build` then launch the built `Nova` MSI/NSIS or `desktop/src-tauri/target/release/desktop.exe`.

IPC host: Node process running `dist/ipc/cli-host.js` (or `src/ipc/cli-host.ts` via tsx in dev). Override with `NOVA_IPC_HOST`. Set `NOVA_CLOUD_ENABLED=1` to start with cloud Outbound on.

## Commands

| Frontend `invoke`         | Host method           | Backend                              |
| ------------------------- | --------------------- | ------------------------------------ |
| `create_buffer_cmd`       | `create_buffer`       | `IntentService.createBuffer`         |
| `get_buffer_cmd`          | `get_buffer`          | `IntentService.getBuffer`            |
| `accept_cmd`              | `accept`              | `IntentService.accept`               |
| `evoke_cmd`               | `evoke`               | `EditorShell.evokeNewUntitled`       |
| `list_tabs_cmd`           | `list_tabs`           | `EditorShell.listTabs`               |
| `activate_tab_cmd`        | `activate_tab`        | `EditorShell.activateTab`            |
| `edit_active_cmd`         | `edit_active`         | `EditorShell.editActive`             |
| `open_path_cmd`           | `open_path`           | `EditorShell.openPath`               |
| `save_active_cmd`         | `save_active`         | `EditorShell.saveActive`             |
| `save_active_as_cmd`      | `save_active_as`      | `EditorShell.saveActiveAs`           |
| `request_close_cmd`       | `request_close`       | `EditorShell.requestClose`           |
| `confirm_close_cmd`       | `confirm_close`       | `EditorShell.confirmClose`           |
| `get_shell_state_cmd`     | `get_shell_state`     | active Buffer + tabs                 |
| `get_global_hotkey_cmd`   | —                     | returns `Ctrl+Alt+N`                 |
| `preview_intent_cmd`      | `preview_intent`      | `IntentService.parse` + `preview`    |
| `reject_preview_cmd`      | `reject_preview`      | `IntentService.reject`               |
| `undo_cmd`                | `undo`                | `IntentService.undo`                 |
| `set_cloud_enabled_cmd`   | `set_cloud_enabled`   | `IntentService.setCloudEnabled`      |

OS hotkey: Tauri `tauri-plugin-global-shortcut` registers `Ctrl+Alt+N` at setup; on press it focuses the main window, runs `evoke`, and emits `hotkey-evoke` for the UI.
