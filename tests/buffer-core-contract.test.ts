/**
 * WUF-96 contract: Rust Buffer core via napi/FFI.
 * Seam under test: createUntitled / openPath / slice / lineWindow / len / rev / save.
 * No DOM. Does not require JS to hold full Buffer text.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  createUntitled,
  dropBuffer,
  len,
  lineWindow,
  openPath,
  rev,
  save,
  slice,
} from "../src/buffer-core.js";

const tempRoot = mkdtempSync(join(tmpdir(), "nova-buffer-core-"));
const ids: string[] = [];

function track(id: string): string {
  ids.push(id);
  return id;
}

after(() => {
  for (const id of ids) {
    try {
      dropBuffer(id);
    } catch {
      /* already dropped */
    }
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("Buffer core — untitled + open UTF-8 Path", () => {
  it("creates an untitled Buffer with len 0 and rev 0", () => {
    const id = track(createUntitled());
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0);
    assert.equal(len(id), 0);
    assert.equal(rev(id), 0);
  });

  it("opens a UTF-8 Path without returning full text to the caller", () => {
    const path = join(tempRoot, "sample.txt");
    const body = "alpha\nbeta\ngamma\n";
    writeFileSync(path, body, "utf8");

    const id = track(openPath(path));
    assert.equal(len(id), body.length);
    assert.equal(rev(id), 0);
    // Contract: openPath returns an id, not the file body.
    assert.notEqual(id, body);
  });
});

describe("Buffer core — slice / lineWindow / len / rev", () => {
  it("slice and lineWindow return windows; JS never needs the full text", () => {
    const path = join(tempRoot, "windowed.txt");
    // Keep a large-enough body that slicing a window is meaningful.
    const lines = Array.from({ length: 200 }, (_, i) => `line-${i}-payload`);
    const body = `${lines.join("\n")}\n`;
    writeFileSync(path, body, "utf8");

    const id = track(openPath(path));
    assert.equal(len(id), body.length);
    assert.equal(rev(id), 0);

    const mid = slice(id, 10, 25);
    assert.equal(mid, body.slice(10, 25));
    assert.ok(mid.length < body.length);

    const window = lineWindow(id, 5, 3);
    assert.equal(window.startOffset, body.split("\n").slice(0, 5).join("\n").length + 1);
    assert.equal(window.text, "line-5-payload\nline-6-payload\nline-7-payload\n");
    assert.ok(window.text.length < body.length);

    // Prove we did not pull the whole Buffer into JS via the core API surface
    // used by this contract (only id + windows).
    assert.notEqual(mid, body);
    assert.notEqual(window.text, body);
  });
});

describe("Buffer core — UTF-8 save round-trip", () => {
  it("saves a Buffer opened from Path to another Path with UTF-8 fidelity", () => {
    const src = join(tempRoot, "round-trip-src.txt");
    const dst = join(tempRoot, "out", "round-trip-dst.txt");
    // BMP-only text so JS UTF-16 length matches Rust Unicode scalar length.
    const body = "你好，Nova\nline two\ntrail ✓\n";
    const charLen = [...body].length;
    writeFileSync(src, body, "utf8");

    const id = track(openPath(src));
    assert.equal(slice(id, 0, 2), "你好");
    assert.equal(len(id), charLen);

    save(id, dst);
    const written = readFileSync(dst, "utf8");
    assert.equal(written, body);

    const reopened = track(openPath(dst));
    assert.equal(len(reopened), charLen);
    assert.equal(slice(reopened, 0, charLen), body);
  });

  it("saves an untitled Buffer when an explicit Path is given", () => {
    const id = track(createUntitled());
    const dst = join(tempRoot, "untitled-empty.txt");
    save(id, dst);
    assert.equal(readFileSync(dst, "utf8"), "");
  });
});
