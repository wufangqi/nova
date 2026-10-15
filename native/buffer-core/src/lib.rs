use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use ropey::Rope;
use uuid::Uuid;

struct UndoEntry {
  id: String,
  rope_before: Rope,
  rev_before: u32,
  rev_after: u32,
}

struct BufferEntry {
  rope: Rope,
  rev: u32,
  path: Option<PathBuf>,
  undo: Vec<UndoEntry>,
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

fn new_entry(rope: Rope, path: Option<PathBuf>) -> BufferEntry {
  BufferEntry {
    rope,
    rev: 0,
    path,
    undo: Vec::new(),
  }
}

/// Create an untitled (empty) Buffer. Revision starts at 0.
#[napi]
pub fn create_untitled() -> String {
  insert_buffer(new_entry(Rope::new(), None))
}

/// Create a Buffer with initial text. Revision starts at 0.
#[napi]
pub fn create_buffer(text: String) -> String {
  insert_buffer(new_entry(Rope::from_str(&text), None))
}

/// Replace entire Buffer text and bump revision (human edit path).
#[napi]
pub fn set_text(buffer_id: String, text: String) -> Result<u32> {
  with_buffer_mut(&buffer_id, |entry| {
    entry.rope = Rope::from_str(&text);
    entry.rev = entry.rev.saturating_add(1);
    Ok(entry.rev)
  })
}

/// Bump revision without changing text (metadata-only changes on the JS side).
#[napi]
pub fn bump_rev(buffer_id: String) -> Result<u32> {
  with_buffer_mut(&buffer_id, |entry| {
    entry.rev = entry.rev.saturating_add(1);
    Ok(entry.rev)
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
  Ok(insert_buffer(new_entry(
    Rope::from_str(&text),
    Some(PathBuf::from(path)),
  )))
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

#[napi(object)]
pub struct CoreTextEdit {
  pub start: u32,
  pub end: u32,
  pub replacement: String,
  pub before: Option<String>,
  pub after: Option<String>,
}

#[napi(object)]
pub struct CorePatch {
  pub base_revision: u32,
  pub edits: Vec<CoreTextEdit>,
}

#[napi(object)]
pub struct ApplyAcceptResult {
  pub ok: bool,
  pub reason: Option<String>,
  pub rev: Option<u32>,
  pub undo_group_id: Option<String>,
}

#[derive(Clone)]
struct RelocatedEdit {
  start: usize,
  end: usize,
  replacement: String,
}

/// Relocate a single edit onto current text (parity with IntentService TS).
fn relocate_edit(
  text: &str,
  edit: &CoreTextEdit,
  base_revision: u32,
  current_revision: u32,
) -> Option<RelocatedEdit> {
  let start = edit.start as usize;
  let end = edit.end as usize;
  if end < start {
    return None;
  }

  if base_revision == current_revision {
    if end > text.chars().count() {
      return None;
    }
    return Some(RelocatedEdit {
      start,
      end,
      replacement: edit.replacement.clone(),
    });
  }

  let before = edit.before.as_deref().unwrap_or("");
  let after = edit.after.as_deref().unwrap_or("");
  let expected_len = end - start;

  if before.is_empty() && after.is_empty() {
    return None;
  }

  // Char-index search (Unicode scalar), matching ropey / IntentService offsets.
  let chars: Vec<char> = text.chars().collect();
  let mut candidates: Vec<usize> = Vec::new();

  if before.is_empty() {
    let after_chars: Vec<char> = after.chars().collect();
    let mut from = 0usize;
    while from <= chars.len() {
      let idx = find_subslice(&chars, &after_chars, from);
      let Some(idx) = idx else { break };
      if idx >= expected_len {
        candidates.push(idx - expected_len);
      }
      from = idx + 1;
    }
  } else {
    let before_chars: Vec<char> = before.chars().collect();
    let after_chars: Vec<char> = after.chars().collect();
    let mut from = 0usize;
    while from <= chars.len() {
      let idx = find_subslice(&chars, &before_chars, from);
      let Some(idx) = idx else { break };
      let start_cand = idx + before_chars.len();
      let end_cand = start_cand + expected_len;
      if end_cand <= chars.len() {
        let trail = &chars[end_cand..end_cand + after_chars.len().min(chars.len() - end_cand)];
        if trail == after_chars.as_slice() {
          candidates.push(start_cand);
        }
      }
      from = idx + 1;
    }
  }

  if candidates.len() != 1 {
    return None;
  }
  let start = candidates[0];
  Some(RelocatedEdit {
    start,
    end: start + expected_len,
    replacement: edit.replacement.clone(),
  })
}

fn find_subslice(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
  if needle.is_empty() {
    return Some(from.min(hay.len()));
  }
  if from > hay.len() {
    return None;
  }
  hay[from..]
    .windows(needle.len())
    .position(|w| w == needle)
    .map(|p| from + p)
}

fn apply_edits_to_rope(rope: &mut Rope, edits: &[RelocatedEdit]) {
  let mut ordered = edits.to_vec();
  ordered.sort_by(|a, b| b.start.cmp(&a.start));
  for e in ordered {
    if e.start != e.end {
      rope.remove(e.start..e.end);
    }
    if !e.replacement.is_empty() {
      rope.insert(e.start, &e.replacement);
    }
  }
}

/// Apply an Accept batch as one UndoGroup. Revision comes from the core.
#[napi]
pub fn apply_accept(
  buffer_id: String,
  patches: Vec<CorePatch>,
) -> Result<ApplyAcceptResult> {
  if patches.is_empty() {
    return Ok(ApplyAcceptResult {
      ok: false,
      reason: Some("invalid".into()),
      rev: None,
      undo_group_id: None,
    });
  }

  with_buffer_mut(&buffer_id, |entry| {
    let text = entry.rope.to_string();
    let current_rev = entry.rev;
    let mut relocated: Vec<RelocatedEdit> = Vec::new();

    for patch in &patches {
      if patch.edits.is_empty() {
        return Ok(ApplyAcceptResult {
          ok: false,
          reason: Some("invalid".into()),
          rev: None,
          undo_group_id: None,
        });
      }
      for edit in &patch.edits {
        match relocate_edit(&text, edit, patch.base_revision, current_rev) {
          Some(r) => relocated.push(r),
          None => {
            return Ok(ApplyAcceptResult {
              ok: false,
              reason: Some("reloc_failed".into()),
              rev: None,
              undo_group_id: None,
            });
          }
        }
      }
    }

    let mut sorted = relocated.clone();
    sorted.sort_by(|a, b| a.start.cmp(&b.start));
    for i in 1..sorted.len() {
      if sorted[i].start < sorted[i - 1].end {
        return Ok(ApplyAcceptResult {
          ok: false,
          reason: Some("invalid".into()),
          rev: None,
          undo_group_id: None,
        });
      }
    }

    let rope_before = entry.rope.clone();
    let rev_before = entry.rev;
    apply_edits_to_rope(&mut entry.rope, &relocated);
    entry.rev = entry.rev.saturating_add(1);

    let undo_group_id = Uuid::new_v4().to_string();
    entry.undo.push(UndoEntry {
      id: undo_group_id.clone(),
      rope_before,
      rev_before,
      rev_after: entry.rev,
    });

    Ok(ApplyAcceptResult {
      ok: true,
      reason: None,
      rev: Some(entry.rev),
      undo_group_id: Some(undo_group_id),
    })
  })
}

#[napi(object)]
pub struct UndoResult {
  pub ok: bool,
}

/// Undo one Accept UndoGroup if it is still at Buffer tip.
#[napi]
pub fn undo(buffer_id: String, undo_group_id: String) -> Result<UndoResult> {
  with_buffer_mut(&buffer_id, |entry| {
    let idx = entry
      .undo
      .iter()
      .position(|u| u.id == undo_group_id)
      .ok_or_else(|| Error::from_reason(format!("unknown UndoGroup: {undo_group_id}")))?;

    let group = &entry.undo[idx];
    if entry.rev != group.rev_after {
      return Err(Error::from_reason("UndoGroup is not at Buffer tip"));
    }

    let group = entry.undo.remove(idx);
    entry.rope = group.rope_before;
    entry.rev = group.rev_before;
    Ok(UndoResult { ok: true })
  })
}
