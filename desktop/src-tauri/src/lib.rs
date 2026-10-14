mod intent_bridge;

use intent_bridge::{accept, create_buffer, get_buffer, IntentBridge, SharedBridge};
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
            accept_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
