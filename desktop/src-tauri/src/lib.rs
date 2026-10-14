mod intent_bridge;

use intent_bridge::{
    accept, activate_tab, confirm_close, create_buffer, edit_active, evoke, get_buffer,
    get_shell_state, get_suggestions_enabled, list_tabs, open_path, preview_intent,
    reject_preview, request_close, resolve_explanation_anchor, save_active, save_active_as,
    select_suggestion, set_cloud_enabled, set_suggestions_enabled, suggestions_for_paste, undo,
    IntentBridge, SharedBridge,
};
use serde_json::Value;
use std::sync::Mutex;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let bridge = IntentBridge::spawn().map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;
            app.manage(Mutex::new(bridge));
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
            preview_intent_cmd,
            reject_preview_cmd,
            undo_cmd,
            set_cloud_enabled_cmd,
            resolve_explanation_anchor_cmd,
            get_suggestions_enabled_cmd,
            set_suggestions_enabled_cmd,
            suggestions_for_paste_cmd,
            select_suggestion_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
