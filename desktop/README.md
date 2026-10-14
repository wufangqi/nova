# Nova desktop (Tauri)

WUF-81/82 — Windows-first Tauri shell: IntentService IPC + EditorShell multi-Buffer UI.

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

IPC host: Node process running `dist/ipc/cli-host.js` (or `src/ipc/cli-host.ts` via tsx in dev). Override with `NOVA_IPC_HOST`.

## Commands

| Frontend `invoke`       | Host method         | Backend                         |
| ----------------------- | ------------------- | ------------------------------- |
| `create_buffer_cmd`     | `create_buffer`     | `IntentService.createBuffer`    |
| `get_buffer_cmd`        | `get_buffer`        | `IntentService.getBuffer`       |
| `accept_cmd`            | `accept`            | `IntentService.accept`          |
| `evoke_cmd`             | `evoke`             | `EditorShell.evokeNewUntitled`  |
| `list_tabs_cmd`         | `list_tabs`         | `EditorShell.listTabs`          |
| `activate_tab_cmd`      | `activate_tab`      | `EditorShell.activateTab`       |
| `edit_active_cmd`       | `edit_active`       | `EditorShell.editActive`        |
| `open_path_cmd`         | `open_path`         | `EditorShell.openPath`          |
| `save_active_cmd`       | `save_active`       | `EditorShell.saveActive`        |
| `save_active_as_cmd`    | `save_active_as`    | `EditorShell.saveActiveAs`      |
| `request_close_cmd`     | `request_close`     | `EditorShell.requestClose`      |
| `confirm_close_cmd`     | `confirm_close`     | `EditorShell.confirmClose`      |
| `get_shell_state_cmd`   | `get_shell_state`   | active Buffer + tabs            |
