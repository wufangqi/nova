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

fn resolve_host_script() -> Result<PathBuf, String> {
    if let Ok(custom) = std::env::var("NOVA_IPC_HOST") {
        let path = PathBuf::from(custom);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("NOVA_IPC_HOST not a file: {}", path.display()));
    }

    // desktop/src-tauri → repo root
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "cannot resolve nova repo root from src-tauri".to_string())?;

    let candidates = [
        repo_root.join("dist/ipc/cli-host.js"),
        repo_root.join("src/ipc/cli-host.ts"),
    ];
    for path in &candidates {
        if path.is_file() {
            return Ok(path.clone());
        }
    }
    Err(format!(
        "Intent IPC host not found under {}. Run `npm run build` in the nova repo root first.",
        repo_root.display()
    ))
}

fn node_bin() -> &'static str {
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

fn node_command_for(host: &Path) -> Result<(String, Vec<String>), String> {
    let host_str = host
        .to_str()
        .ok_or_else(|| "host path is not valid UTF-8".to_string())?
        .to_string();
    if host.extension().and_then(|e| e.to_str()) == Some("ts") {
        // Dev fallback: tsx runs TypeScript without a prior build.
        Ok((npx_bin().into(), vec!["tsx".into(), host_str]))
    } else {
        Ok((node_bin().into(), vec![host_str]))
    }
}

impl IntentBridge {
    pub fn spawn() -> Result<Self, String> {
        let host = resolve_host_script()?;
        let (program, args) = node_command_for(&host)?;
        let mut child = Command::new(&program)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
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

pub fn get_buffer(bridge: &SharedBridge, id: String) -> Result<Value, String> {
    let mut guard = bridge
        .lock()
        .map_err(|_| "Intent IPC bridge lock poisoned".to_string())?;
    let response = guard.call(json!({
        "method": "get_buffer",
        "params": { "id": id }
    }))?;
    unwrap_ipc(response)
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
