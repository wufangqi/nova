//! Thin IPC bridge: Tauri commands ↔ Node IntentIpcHost (JSON-lines).
//! Accept writes always go through IntentService.accept in the host process.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

pub struct IntentBridge {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
}

pub type SharedBridge = Mutex<IntentBridge>;

fn push_if_file(out: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_file() {
        out.push(path);
    }
}

/// Resolve `cli-host.js` for packaged installs (resources) and local dev (repo dist/).
fn resolve_host_script(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("NOVA_IPC_HOST") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("NOVA_IPC_HOST not a file: {}", path.display()));
    }

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = resource_dir {
        push_if_file(&mut candidates, dir.join("nova-dist/ipc/cli-host.js"));
        push_if_file(&mut candidates, dir.join("ipc/cli-host.js"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_if_file(
                &mut candidates,
                exe_dir.join("resources/nova-dist/ipc/cli-host.js"),
            );
            push_if_file(&mut candidates, exe_dir.join("nova-dist/ipc/cli-host.js"));
        }
    }

    // desktop/src-tauri → repo root (dev / `tauri dev`)
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.parent().and_then(|p| p.parent()) {
        push_if_file(&mut candidates, repo_root.join("dist/ipc/cli-host.js"));
        push_if_file(&mut candidates, repo_root.join("src/ipc/cli-host.ts"));
        push_if_file(
            &mut candidates,
            manifest_dir.join("resources/nova-dist/ipc/cli-host.js"),
        );
    }

    if let Some(path) = candidates.into_iter().next() {
        return Ok(path);
    }

    Err(
        "Intent IPC host not found. For installers, rebuild with `npm run desktop:build`. For dev, run `npm run build` at the nova repo root."
            .into(),
    )
}

fn node_bin_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn npx_bin() -> &'static str {
    if cfg!(windows) {
        "npx.cmd"
    } else {
        "npx"
    }
}

fn resolve_node_program(resource_dir: Option<&Path>) -> String {
    let name = node_bin_name();
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(dir) = resource_dir {
        push_if_file(&mut candidates, dir.join("bin").join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            push_if_file(&mut candidates, exe_dir.join("resources/bin").join(name));
            push_if_file(&mut candidates, exe_dir.join("bin").join(name));
        }
    }
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    push_if_file(
        &mut candidates,
        manifest_dir.join("resources/bin").join(name),
    );

    if let Some(path) = candidates.into_iter().next() {
        return path.to_string_lossy().into_owned();
    }
    name.to_string()
}

fn node_command_for(
    host: &Path,
    resource_dir: Option<&Path>,
) -> Result<(String, Vec<String>), String> {
    let host_str = host
        .to_str()
        .ok_or_else(|| "host path is not valid UTF-8".to_string())?
        .to_string();
    if host.extension().and_then(|e| e.to_str()) == Some("ts") {
        // Dev fallback: tsx runs TypeScript without a prior build.
        Ok((npx_bin().into(), vec!["tsx".into(), host_str]))
    } else {
        Ok((resolve_node_program(resource_dir), vec![host_str]))
    }
}

impl IntentBridge {
    pub fn spawn(resource_dir: Option<PathBuf>) -> Result<Self, String> {
        let resource = resource_dir.as_deref();
        let host = resolve_host_script(resource)?;
        let (program, args) = node_command_for(&host, resource)?;
        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        // Help Node treat shipped JS as ESM via nova-dist/package.json.
        if let Some(dist_root) = host
            .parent()
            .and_then(|ipc| ipc.parent())
            .filter(|p| p.join("package.json").is_file())
        {
            cmd.current_dir(dist_root);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("failed to spawn Intent IPC host ({program}): {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Intent IPC host stdin missing".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Intent IPC host stdout missing".to_string())?;

        Ok(Self {
            _child: child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    pub fn call(&mut self, request: Value) -> Result<Value, String> {
        let line = serde_json::to_string(&request)
            .map_err(|e| format!("serialize IPC request: {e}"))?;
        writeln!(self.stdin, "{line}")
            .map_err(|e| format!("write IPC request: {e}"))?;
        self.stdin
            .flush()
            .map_err(|e| format!("flush IPC request: {e}"))?;

        let mut response_line = String::new();
        self.stdout
            .read_line(&mut response_line)
            .map_err(|e| format!("read IPC response: {e}"))?;
        if response_line.trim().is_empty() {
            return Err("Intent IPC host closed stdout".into());
        }
        serde_json::from_str(response_line.trim())
            .map_err(|e| format!("parse IPC response: {e} ({})", response_line.trim()))
    }
}

pub fn create_buffer(bridge: &SharedBridge, text: Option<String>) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "create_buffer",
        "params": { "text": text.unwrap_or_default() }
    }))?;
    unwrap_ipc(response)
}

pub fn get_buffer(
    bridge: &SharedBridge,
    id: String,
    include_text: Option<bool>,
) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let mut params = json!({ "id": id });
    if let Some(include) = include_text {
        params["includeText"] = json!(include);
    }
    let response = guard.call(json!({
        "method": "get_buffer",
        "params": params
    }))?;
    unwrap_ipc(response)
}

/// WUF-98 — thin forwards for core-equivalent slice / line window / len / rev.
pub fn slice(
    bridge: &SharedBridge,
    id: String,
    start: u64,
    end: u64,
) -> Result<Value, String> {
    call_params(
        bridge,
        "slice",
        json!({ "id": id, "start": start, "end": end }),
    )
}

pub fn line_window(
    bridge: &SharedBridge,
    id: String,
    line_start: u64,
    line_count: u64,
) -> Result<Value, String> {
    call_params(
        bridge,
        "line_window",
        json!({
            "id": id,
            "lineStart": line_start,
            "lineCount": line_count
        }),
    )
}

pub fn buffer_len(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    call_params(bridge, "buffer_len", json!({ "id": id }))
}

pub fn buffer_rev(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    call_params(bridge, "buffer_rev", json!({ "id": id }))
}

pub fn accept(bridge: &SharedBridge, patches: Value) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "accept",
        "params": { "patches": patches }
    }))?;
    unwrap_ipc(response)
}

pub fn evoke(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "evoke")
}

pub fn list_tabs(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "list_tabs")
}

pub fn activate_tab(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "activate_tab",
        "params": { "id": id }
    }))?;
    unwrap_ipc(response)
}

pub fn edit_active(bridge: &SharedBridge, text: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "edit_active",
        "params": { "text": text }
    }))?;
    unwrap_ipc(response)
}

pub fn open_path(bridge: &SharedBridge, path: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "open_path",
        "params": { "path": path }
    }))?;
    unwrap_ipc(response)
}

pub fn save_active(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "save_active")
}

pub fn save_active_as(bridge: &SharedBridge, path: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "save_active_as",
        "params": { "path": path }
    }))?;
    unwrap_ipc(response)
}

pub fn request_close(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "request_close",
        "params": { "id": id }
    }))?;
    unwrap_ipc(response)
}

pub fn confirm_close(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "confirm_close",
        "params": { "id": id }
    }))?;
    unwrap_ipc(response)
}

pub fn get_shell_state(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "get_shell_state")
}

pub fn preview_intent(
    bridge: &SharedBridge,
    utterance: String,
    selection: Option<Value>,
    visible_window: Option<Value>,
) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let mut params = json!({ "utterance": utterance });
    if let Some(sel) = selection {
        params["selection"] = sel;
    }
    if let Some(win) = visible_window {
        params["visibleWindow"] = win;
    }
    let response = guard.call(json!({
        "method": "preview_intent",
        "params": params
    }))?;
    unwrap_ipc(response)
}

pub fn reject_preview(bridge: &SharedBridge, preview_id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "reject_preview",
        "params": { "previewId": preview_id }
    }))?;
    unwrap_ipc(response)
}

pub fn undo(bridge: &SharedBridge, undo_group_id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "undo",
        "params": { "undoGroupId": undo_group_id }
    }))?;
    unwrap_ipc(response)
}

pub fn set_cloud_enabled(bridge: &SharedBridge, enabled: bool) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "set_cloud_enabled",
        "params": { "enabled": enabled }
    }))?;
    unwrap_ipc(response)
}

pub fn resolve_explanation_anchor(
    bridge: &SharedBridge,
    anchor: Value,
) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "resolve_explanation_anchor",
        "params": { "anchor": anchor }
    }))?;
    unwrap_ipc(response)
}

pub fn get_suggestions_enabled(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "get_suggestions_enabled")
}

pub fn set_suggestions_enabled(bridge: &SharedBridge, enabled: bool) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "set_suggestions_enabled",
        "params": { "enabled": enabled }
    }))?;
    unwrap_ipc(response)
}

pub fn suggestions_for_paste(
    bridge: &SharedBridge,
    clipboard_text: String,
) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "suggestions_for_paste",
        "params": { "clipboardText": clipboard_text }
    }))?;
    unwrap_ipc(response)
}

pub fn select_suggestion(
    bridge: &SharedBridge,
    suggestion: Value,
    selection: Option<Value>,
) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let mut params = json!({ "suggestion": suggestion });
    if let Some(sel) = selection {
        params["selection"] = sel;
    }
    let response = guard.call(json!({
        "method": "select_suggestion",
        "params": params
    }))?;
    unwrap_ipc(response)
}


pub fn find(bridge: &SharedBridge, params: Value) -> Result<Value, String> {
    call_params(bridge, "find", params)
}

pub fn preview_replace(bridge: &SharedBridge, params: Value) -> Result<Value, String> {
    call_params(bridge, "preview_replace", params)
}

pub fn replace_accept(bridge: &SharedBridge, params: Value) -> Result<Value, String> {
    call_params(bridge, "replace_accept", params)
}

pub fn apply_draft(bridge: &SharedBridge, draft: Value) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "apply_draft",
        "params": { "draft": draft }
    }))?;
    unwrap_ipc(response)
}

pub fn get_draft(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "get_draft")
}

/// WUF-92 — Action facade pass-through (no host-owned Action semantics).
pub fn save_from_regex_draft(
    bridge: &SharedBridge,
    preview_id: String,
    display_name: Option<String>,
) -> Result<Value, String> {
    let mut params = json!({ "previewId": preview_id });
    if let Some(name) = display_name {
        params["displayName"] = json!(name);
    }
    call_params(bridge, "save_from_regex_draft", params)
}

pub fn list_actions(bridge: &SharedBridge) -> Result<Value, String> {
    call_empty(bridge, "list_actions")
}

pub fn rename_action(
    bridge: &SharedBridge,
    id: String,
    display_name: String,
) -> Result<Value, String> {
    call_params(
        bridge,
        "rename_action",
        json!({ "id": id, "displayName": display_name }),
    )
}

pub fn delete_action(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    call_params(bridge, "delete_action", json!({ "id": id }))
}

pub fn preview_run(bridge: &SharedBridge, params: Value) -> Result<Value, String> {
    call_params(bridge, "preview_run", params)
}

fn call_empty(bridge: &SharedBridge, method: &str) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": method,
        "params": {}
    }))?;
    unwrap_ipc(response)
}


fn call_params(bridge: &SharedBridge, method: &str, params: Value) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": method,
        "params": params
    }))?;
    unwrap_ipc(response)
}

fn unwrap_ipc(response: Value) -> Result<Value, String> {
    match response.get("ok").and_then(|v| v.as_bool()) {
        Some(true) => response
            .get("result")
            .cloned()
            .ok_or_else(|| "IPC ok response missing result".into()),
        Some(false) => Err(response
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("IPC error")
            .to_string()),
        None => Err(format!("malformed IPC response: {response}")),
    }
}
