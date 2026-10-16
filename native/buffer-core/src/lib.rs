use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::{Regex, RegexBuilder};
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

/// Replace a character range `[start, end)` and bump revision (human edit path).
/// Not an Accept UndoGroup — typing / paste go through this seam.
#[napi]
pub fn replace_range(
  buffer_id: String,
  start: u32,
  end: u32,
  replacement: String,
) -> Result<u32> {
  with_buffer_mut(&buffer_id, |entry| {
    let len = entry.rope.len_chars();
    let start = start as usize;
    let end = end as usize;
    if start > end || end > len {
      return Err(Error::from_reason(format!(
        "replace_range out of range: start={start} end={end} len={len}"
      )));
    }
    if start != end {
      entry.rope.remove(start..end);
    }
    if !replacement.is_empty() {
      entry.rope.insert(start, &replacement);
    }
    entry.rev = entry.rev.saturating_add(1);
    Ok(entry.rev)
  })
}

/// Number of lines in the Buffer (ropey line count; trailing `\n` adds an empty line).
#[napi]
pub fn line_count(buffer_id: String) -> Result<u32> {
  with_buffer(&buffer_id, |entry| Ok(entry.rope.len_lines() as u32))
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

// --- Find (WUF-100): Rust `regex`, poll-driven cancellable jobs ---

/// Matches processed per `find_poll` step (keeps cancel responsive).
const FIND_POLL_BATCH: usize = 256;

#[napi(object)]
pub struct FindQuery {
  pub pattern: String,
  /// Flag chars: `i` (case), `m` (multiline), `s` (dotall).
  pub flags: Option<String>,
  /// Inclusive char start of Scope; default 0.
  pub start: Option<u32>,
  /// Exclusive char end of Scope; default Buffer len.
  pub end: Option<u32>,
  /// Soft cap on matches returned (scan stops early when reached).
  pub max_matches: Option<u32>,
}

#[napi(object)]
#[derive(Clone)]
pub struct FindCapture {
  pub index: u32,
  pub text: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct FindHitCore {
  pub start: u32,
  pub end: u32,
  pub match_text: String,
  /// 0-based line index in the Buffer.
  pub line: u32,
  /// 0-based character column within the line.
  pub column: u32,
  pub captures: Vec<FindCapture>,
}

#[napi(object)]
pub struct FindProgress {
  /// `running` | `done` | `cancelled` | `error`
  pub status: String,
  pub hits: Vec<FindHitCore>,
  pub count: u32,
  pub error: Option<String>,
}

enum FindJobKind {
  Ready {
    haystack: String,
    span_start: usize,
    line_starts: Vec<usize>,
    re: Regex,
    /// Byte offset into haystack for the next search.
    byte_cursor: usize,
    hits: Vec<FindHitCore>,
    max_matches: usize,
    cancel: bool,
  },
  Done {
    hits: Vec<FindHitCore>,
  },
  Cancelled {
    hits: Vec<FindHitCore>,
  },
  Error {
    message: String,
  },
}

static FIND_JOBS: Lazy<Mutex<HashMap<String, FindJobKind>>> =
  Lazy::new(|| Mutex::new(HashMap::new()));

fn byte_to_char(s: &str, byte: usize) -> usize {
  s[..byte].chars().count()
}

fn build_regex(pattern: &str, flags: Option<&str>) -> std::result::Result<Regex, String> {
  let flags = flags.unwrap_or("");
  let mut builder = RegexBuilder::new(pattern);
  builder.case_insensitive(flags.contains('i'));
  builder.multi_line(flags.contains('m'));
  builder.dot_matches_new_line(flags.contains('s'));
  builder.build().map_err(|e| e.to_string())
}

fn line_column(line_starts: &[usize], abs_start: usize) -> (usize, usize) {
  let line = match line_starts.binary_search(&abs_start) {
    Ok(i) => i,
    Err(i) => i.saturating_sub(1),
  };
  let column = abs_start.saturating_sub(line_starts.get(line).copied().unwrap_or(0));
  (line, column)
}

fn progress_from_job(job: &FindJobKind) -> FindProgress {
  match job {
    FindJobKind::Ready { hits, .. } => FindProgress {
      status: "running".into(),
      hits: hits.clone(),
      count: hits.len() as u32,
      error: None,
    },
    FindJobKind::Done { hits } => FindProgress {
      status: "done".into(),
      hits: hits.clone(),
      count: hits.len() as u32,
      error: None,
    },
    FindJobKind::Cancelled { hits } => FindProgress {
      status: "cancelled".into(),
      hits: hits.clone(),
      count: hits.len() as u32,
      error: None,
    },
    FindJobKind::Error { message } => FindProgress {
      status: "error".into(),
      hits: Vec::new(),
      count: 0,
      error: Some(message.clone()),
    },
  }
}

/// Start a cancellable Find job on Buffer text (Rust `regex` crate).
/// Work advances on `find_poll` so `find_cancel` is deterministic between steps.
#[napi]
pub fn find_start(buffer_id: String, query: FindQuery) -> Result<String> {
  let prepared = with_buffer(&buffer_id, |entry| {
    let len = entry.rope.len_chars();
    let start = query.start.unwrap_or(0) as usize;
    let end = query.end.unwrap_or(len as u32) as usize;
    if start > end || end > len {
      return Err(Error::from_reason(format!(
        "find scope out of range: start={start} end={end} len={len}"
      )));
    }
    let haystack = entry.rope.slice(start..end).to_string();
    let mut line_starts: Vec<usize> = Vec::with_capacity(entry.rope.len_lines());
    for i in 0..entry.rope.len_lines() {
      line_starts.push(entry.rope.line_to_char(i));
    }
    Ok((haystack, start, line_starts))
  });

  let job_id = Uuid::new_v4().to_string();
  let job = match prepared {
    Ok((haystack, span_start, line_starts)) => match build_regex(&query.pattern, query.flags.as_deref())
    {
      Ok(re) => FindJobKind::Ready {
        haystack,
        span_start,
        line_starts,
        re,
        byte_cursor: 0,
        hits: Vec::new(),
        max_matches: query.max_matches.unwrap_or(u32::MAX) as usize,
        cancel: false,
      },
      Err(message) => FindJobKind::Error { message },
    },
    Err(e) => FindJobKind::Error {
      message: e.reason,
    },
  };

  FIND_JOBS.lock().insert(job_id.clone(), job);
  Ok(job_id)
}

/// Advance Find by one batch. Terminal: `done` | `cancelled` | `error`.
#[napi]
pub fn find_poll(job_id: String) -> Result<FindProgress> {
  let mut jobs = FIND_JOBS.lock();
  let job = jobs
    .get_mut(&job_id)
    .ok_or_else(|| Error::from_reason(format!("unknown find job: {job_id}")))?;

  if let FindJobKind::Ready {
    haystack,
    span_start,
    line_starts,
    re,
    byte_cursor,
    hits,
    max_matches,
    cancel,
  } = job
  {
    if *cancel {
      let hits = std::mem::take(hits);
      *job = FindJobKind::Cancelled { hits };
      return Ok(progress_from_job(job));
    }

    let mut batch = 0usize;
    loop {
      if *cancel {
        let hits = std::mem::take(hits);
        *job = FindJobKind::Cancelled { hits };
        return Ok(progress_from_job(job));
      }
      if hits.len() >= *max_matches {
        let hits = std::mem::take(hits);
        *job = FindJobKind::Done { hits };
        return Ok(progress_from_job(job));
      }
      if batch >= FIND_POLL_BATCH {
        break;
      }

      let Some(caps) = re.captures_at(haystack, *byte_cursor) else {
        let hits = std::mem::take(hits);
        *job = FindJobKind::Done { hits };
        return Ok(progress_from_job(job));
      };
      let m = match caps.get(0) {
        Some(m) => m,
        None => {
          let hits = std::mem::take(hits);
          *job = FindJobKind::Done { hits };
          return Ok(progress_from_job(job));
        }
      };

      let local_start = byte_to_char(haystack, m.start());
      let local_end = byte_to_char(haystack, m.end());
      let abs_start = *span_start + local_start;
      let abs_end = *span_start + local_end;
      let (line, column) = line_column(line_starts, abs_start);

      let mut captures = Vec::new();
      for i in 1..caps.len() {
        if let Some(g) = caps.get(i) {
          captures.push(FindCapture {
            index: i as u32,
            text: g.as_str().to_string(),
          });
        }
      }

      hits.push(FindHitCore {
        start: abs_start as u32,
        end: abs_end as u32,
        match_text: m.as_str().to_string(),
        line: line as u32,
        column: column as u32,
        captures,
      });
      batch += 1;

      // Advance past this match (empty-match safe).
      let next = if m.end() > m.start() {
        m.end()
      } else if m.start() < haystack.len() {
        let mut n = m.start() + 1;
        while n < haystack.len() && !haystack.is_char_boundary(n) {
          n += 1;
        }
        n
      } else {
        let hits = std::mem::take(hits);
        *job = FindJobKind::Done { hits };
        return Ok(progress_from_job(job));
      };
      *byte_cursor = next;
    }

    return Ok(progress_from_job(job));
  }

  Ok(progress_from_job(job))
}

/// Request cancellation. Distinct from zero matches (`done` + count 0).
#[napi]
pub fn find_cancel(job_id: String) -> Result<()> {
  let mut jobs = FIND_JOBS.lock();
  let job = jobs
    .get_mut(&job_id)
    .ok_or_else(|| Error::from_reason(format!("unknown find job: {job_id}")))?;
  if let FindJobKind::Ready { cancel, .. } = job {
    *cancel = true;
  }
  Ok(())
}
