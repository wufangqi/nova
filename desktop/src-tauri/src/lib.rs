mod intent_bridge;

use intent_bridge::{
    accept, activate_tab, apply_draft, confirm_close, create_buffer, edit_active, evoke, find,
    get_buffer, get_draft, get_shell_state, get_suggestions_enabled, list_tabs, open_path,
    preview_intent, preview_replace, reject_preview, replace_accept, request_close,
    resolve_explanation_anchor, save_active, save_active_as, select_suggestion, set_cloud_enabled,
    set_suggestions_enabled, suggestions_for_paste, undo, IntentBridge, SharedBridge,
};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Must match `GLOBAL_HOTKEY_ACCELERATOR` in nova `src/global-hotkey.ts`.
const GLOBAL_HOTKEY_ACCELERATOR: &str = "Ctrl+Alt+N";

/// Must match `HOTKEY_EVOKE_EVENT` in nova `src/global-hotkey.ts`.
const HOTKEY_EVOKE_EVENT: &str = "hotkey-evoke";

#[tauri::command]
fn create_buffer_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    text: Option<String>,
) -> Result<Value, String> {
    create_buffer(&bridge, text)
}

#[tauri::command]
fn get_buffer_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    id: String,
) -> Result<Value, String> {
    get_buffer(&bridge, id)
}

#[tauri::command]
fn accept_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    patches: Value,
) -> Result<Value, String> {
    accept(&bridge, patches)
}

#[tauri::command]
fn evoke_cmd(bridge: tauri::State<'_, SharedBridge>) -> Result<Value, String> {
    evoke(&bridge)
}

#[tauri::command]
fn list_tabs_cmd(bridge: tauri::State<'_, SharedBridge>) -> Result<Value, String> {
    list_tabs(&bridge)
}

#[tauri::command]
fn activate_tab_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    id: String,
) -> Result<Value, String> {
    activate_tab(&bridge, id)
}

#[tauri::command]
fn edit_active_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    text: String,
) -> Result<Value, String> {
    edit_active(&bridge, text)
}

#[tauri::command]
fn open_path_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    path: String,
) -> Result<Value, String> {
    open_path(&bridge, path)
}

#[tauri::command]
fn save_active_cmd(bridge: tauri::State<'_, SharedBridge>) -> Result<Value, String> {
    save_active(&bridge)
}

#[tauri::command]
fn save_active_as_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    path: String,
) -> Result<Value, String> {
    save_active_as(&bridge, path)
}

#[tauri::command]
fn request_close_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    id: String,
) -> Result<Value, String> {
    request_close(&bridge, id)
}

#[tauri::command]
fn confirm_close_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    id: String,
) -> Result<Value, String> {
    confirm_close(&bridge, id)
}

#[tauri::command]
fn get_shell_state_cmd(bridge: tauri::State<'_, SharedBridge>) -> Result<Value, String> {
    get_shell_state(&bridge)
}

#[tauri::command]
fn get_global_hotkey_cmd() -> String {
    GLOBAL_HOTKEY_ACCELERATOR.to_string()
}

#[tauri::command]
fn preview_intent_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    utterance: String,
    selection: Option<Value>,
    visible_window: Option<Value>,
) -> Result<Value, String> {
    preview_intent(&bridge, utterance, selection, visible_window)
}

#[tauri::command]
fn reject_preview_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    preview_id: String,
) -> Result<Value, String> {
    reject_preview(&bridge, preview_id)
}

#[tauri::command]
fn undo_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    undo_group_id: String,
) -> Result<Value, String> {
    undo(&bridge, undo_group_id)
}

#[tauri::command]
fn set_cloud_enabled_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    enabled: bool,
) -> Result<Value, String> {
    set_cloud_enabled(&bridge, enabled)
}

#[tauri::command]
fn resolve_explanation_anchor_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    anchor: Value,
) -> Result<Value, String> {
    resolve_explanation_anchor(&bridge, anchor)
}

#[tauri::command]
fn get_suggestions_enabled_cmd(
    bridge: tauri::State<'_, SharedBridge>,
) -> Result<Value, String> {
    get_suggestions_enabled(&bridge)
}

#[tauri::command]
fn set_suggestions_enabled_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    enabled: bool,
) -> Result<Value, String> {
    set_suggestions_enabled(&bridge, enabled)
}

#[tauri::command]
fn suggestions_for_paste_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    clipboard_text: String,
) -> Result<Value, String> {
    suggestions_for_paste(&bridge, clipboard_text)
}

#[tauri::command]
fn select_suggestion_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    suggestion: Value,
    selection: Option<Value>,
) -> Result<Value, String> {
    select_suggestion(&bridge, suggestion, selection)
}

#[tauri::command]
fn find_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    params: Option<Value>,
) -> Result<Value, String> {
    find(&bridge, params.unwrap_or(Value::Object(Default::default())))
}

#[tauri::command]
fn preview_replace_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    params: Option<Value>,
) -> Result<Value, String> {
    preview_replace(&bridge, params.unwrap_or(Value::Object(Default::default())))
}

#[tauri::command]
fn replace_accept_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    params: Option<Value>,
) -> Result<Value, String> {
    replace_accept(&bridge, params.unwrap_or(Value::Object(Default::default())))
}

#[tauri::command]
fn apply_draft_cmd(
    bridge: tauri::State<'_, SharedBridge>,
    draft: Value,
) -> Result<Value, String> {
    apply_draft(&bridge, draft)
}

#[tauri::command]
fn get_draft_cmd(bridge: tauri::State<'_, SharedBridge>) -> Result<Value, String> {
    get_draft(&bridge)
}

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn evoke_from_hotkey(app: &tauri::AppHandle) {
    focus_main_window(app);
    let bridge = app.state::<SharedBridge>();
    match evoke(&bridge) {
        Ok(result) => {
            let _ = app.emit(HOTKEY_EVOKE_EVENT, result);
        }
        Err(err) => {
            let _ = app.emit("hotkey-evoke-error", err);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let bridge = IntentBridge::spawn(resource_dir).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;
            app.manage(Mutex::new(bridge));

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts([GLOBAL_HOTKEY_ACCELERATOR])
                        .map_err(|e| {
                            std::io::Error::new(
                                std::io::ErrorKind::Other,
                                format!(
                                    "invalid global hotkey {GLOBAL_HOTKEY_ACCELERATOR}: {e}"
                                ),
                            )
                        })?
                        .with_handler(move |app, shortcut, event| {
                            if event.state != ShortcutState::Pressed {
                                return;
                            }
                            if !shortcut.matches(Modifiers::CONTROL | Modifiers::ALT, Code::KeyN)
                            {
                                return;
                            }
                            evoke_from_hotkey(app);
                        })
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_buffer_cmd,
            get_buffer_cmd,
            accept_cmd,
            evoke_cmd,
            list_tabs_cmd,
            activate_tab_cmd,
            edit_active_cmd,
            open_path_cmd,
            save_active_cmd,
            save_active_as_cmd,
            request_close_cmd,
            confirm_close_cmd,
            get_shell_state_cmd,
            get_global_hotkey_cmd,
            preview_intent_cmd,
            reject_preview_cmd,
            undo_cmd,
            set_cloud_enabled_cmd,
            resolve_explanation_anchor_cmd,
            get_suggestions_enabled_cmd,
            set_suggestions_enabled_cmd,
            suggestions_for_paste_cmd,
            select_suggestion_cmd,
            find_cmd,
            preview_replace_cmd,
            replace_accept_cmd,
            apply_draft_cmd,
            get_draft_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
