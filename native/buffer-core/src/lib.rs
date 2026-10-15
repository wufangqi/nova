use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use ropey::Rope;
use uuid::Uuid;

struct BufferEntry {
  rope: Rope,
  rev: u32,
  path: Option<PathBuf>,
}

struct Store {
  buffers: HashMap<String, BufferEntry>,
}

impl Store {
  fn new() -> Self {
    Self {
      buffers: HashMap::new(),
    }
  }
}

static STORE: Lazy<Mutex<Store>> = Lazy::new(|| Mutex::new(Store::new()));

fn with_buffer<T, F>(id: &str, f: F) -> Result<T>
where
  F: FnOnce(&BufferEntry) -> Result<T>,
{
  let store = STORE.lock();
  let entry = store
    .buffers
    .get(id)
    .ok_or_else(|| Error::from_reason(format!("unknown buffer id: {id}")))?;
  f(entry)
}

fn with_buffer_mut<T, F>(id: &str, f: F) -> Result<T>
where
  F: FnOnce(&mut BufferEntry) -> Result<T>,
{
  let mut store = STORE.lock();
  let entry = store
    .buffers
    .get_mut(id)
    .ok_or_else(|| Error::from_reason(format!("unknown buffer id: {id}")))?;
  f(entry)
}

fn insert_buffer(entry: BufferEntry) -> String {
  let id = Uuid::new_v4().to_string();
  STORE.lock().buffers.insert(id.clone(), entry);
  id
}

/// Create an untitled (empty) Buffer. Revision starts at 0.
#[napi]
pub fn create_untitled() -> String {
  insert_buffer(BufferEntry {
    rope: Rope::new(),
    rev: 0,
    path: None,
  })
}

/// Open a UTF-8 Path into a new Buffer. Revision starts at 0.
#[napi]
pub fn open_path(path: String) -> Result<String> {
  let bytes = fs::read(&path).map_err(|e| {
    Error::from_reason(format!("failed to read path `{path}`: {e}"))
  })?;
  let text = String::from_utf8(bytes).map_err(|e| {
    Error::from_reason(format!("path `{path}` is not valid UTF-8: {e}"))
  })?;
  Ok(insert_buffer(BufferEntry {
    rope: Rope::from_str(&text),
    rev: 0,
    path: Some(PathBuf::from(path)),
  }))
}

/// Save Buffer to Path as UTF-8. Optional path overrides / sets the Buffer path.
#[napi]
pub fn save(buffer_id: String, path: Option<String>) -> Result<()> {
  with_buffer_mut(&buffer_id, |entry| {
    let target = match path {
      Some(p) => {
        let pb = PathBuf::from(&p);
        entry.path = Some(pb.clone());
        pb
      }
      None => entry.path.clone().ok_or_else(|| {
        Error::from_reason("save requires a path for untitled buffers")
      })?,
    };
    let text = entry.rope.to_string();
    if let Some(parent) = target.parent() {
      if !parent.as_os_str().is_empty() {
        fs::create_dir_all(parent).map_err(|e| {
          Error::from_reason(format!(
            "failed to create parent dirs for `{}`: {e}",
            target.display()
          ))
        })?;
      }
    }
    fs::write(&target, text.as_bytes()).map_err(|e| {
      Error::from_reason(format!("failed to write `{}`: {e}", target.display()))
    })?;
    Ok(())
  })
}

/// Character length of the Buffer (Unicode scalar values).
#[napi]
pub fn len(buffer_id: String) -> Result<u32> {
  with_buffer(&buffer_id, |entry| Ok(entry.rope.len_chars() as u32))
}

/// Current revision of the Buffer.
#[napi]
pub fn rev(buffer_id: String) -> Result<u32> {
  with_buffer(&buffer_id, |entry| Ok(entry.rev))
}

/// Slice by character offsets `[start, end)`. Does not require JS to hold full text.
#[napi]
pub fn slice(buffer_id: String, start: u32, end: u32) -> Result<String> {
  with_buffer(&buffer_id, |entry| {
    let len = entry.rope.len_chars();
    let start = start as usize;
    let end = end as usize;
    if start > end || end > len {
      return Err(Error::from_reason(format!(
        "slice out of range: start={start} end={end} len={len}"
      )));
    }
    Ok(entry.rope.slice(start..end).to_string())
  })
}

#[napi(object)]
pub struct LineWindow {
  pub text: String,
  pub start_offset: u32,
}

/// Return up to `line_count` lines starting at 0-based `line_start`, plus the
/// character offset of the first returned line.
#[napi]
pub fn line_window(
  buffer_id: String,
  line_start: u32,
  line_count: u32,
) -> Result<LineWindow> {
  with_buffer(&buffer_id, |entry| {
    let line_start = line_start as usize;
    let line_count = line_count as usize;
    let total_lines = entry.rope.len_lines();
    if line_start > total_lines {
      return Err(Error::from_reason(format!(
        "line_start out of range: {line_start} (lines={total_lines})"
      )));
    }
    if line_count == 0 || line_start == total_lines {
      let start_offset = if line_start >= total_lines {
        entry.rope.len_chars() as u32
      } else {
        entry.rope.line_to_char(line_start) as u32
      };
      return Ok(LineWindow {
        text: String::new(),
        start_offset,
      });
    }
    let line_end = (line_start + line_count).min(total_lines);
    let start_offset = entry.rope.line_to_char(line_start);
    let end_offset = if line_end >= total_lines {
      entry.rope.len_chars()
    } else {
      entry.rope.line_to_char(line_end)
    };
    Ok(LineWindow {
      text: entry.rope.slice(start_offset..end_offset).to_string(),
      start_offset: start_offset as u32,
    })
  })
}

/// Drop a Buffer from the core store (test / lifecycle helper).
#[napi]
pub fn drop_buffer(buffer_id: String) -> Result<()> {
  let mut store = STORE.lock();
  if store.buffers.remove(&buffer_id).is_none() {
    return Err(Error::from_reason(format!(
      "unknown buffer id: {buffer_id}"
    )));
  }
  Ok(())
}
