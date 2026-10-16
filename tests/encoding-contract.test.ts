/**
 * WUF-73 contract: Encoding/EOL metadata + mojibake repair via Patch Accept.
 * Seams: Buffer metadata on IntentService; Path round-trip via EditorShell;
 * MojibakeRepair proposals; Accept only mutates Encoding/EOL/BOM when explicit.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EditorShell } from "../src/editor-shell.js";
import { IntentService } from "../src/intent-service.js";
import { MojibakeRepair } from "../src/mojibake-repair.js";
import { encodeText } from "../src/encoding.js";
import type { Patch } from "../src/types.js";
import { bufferBody } from './helpers/buffer-text.js';

function textPatch(
  bufferId: string,
  baseRevision: number,
  edits: Patch["edits"],
): Patch {
  return {
    bufferId,
    baseRevision,
    edits,
    provenance: { source: "ai", label: "model-stub" },
  };
}

describe("Buffer Encoding/EOL + Path round-trip", () => {
  it("Buffer carries Encoding/EOL; open/save round-trips bytes via metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf73-"));
    const path = join(dir, "gbk-crlf.txt");
    const logical = "你好世界\r\n第二行";
    const bytes = encodeText(logical, "gbk", "crlf");
    await writeFile(path, bytes);

    const shell = new EditorShell();
    const opened = await shell.openPath(path);
    // Non-UTF-8 seeds core via decode, but snapshot still omits text.
    assert.equal(opened.text, undefined);
    const intent = shell.intentService();
    const body = intent.slice(opened.id, 0, intent.len(opened.id));
    assert.equal(body.replace(/\r\n/g, "\n"), "你好世界\n第二行");
    assert.equal(opened.encoding, "gbk");
    assert.equal(opened.eol, "crlf");
    assert.equal(opened.bom, false);

    await shell.saveActive();
    const roundTrip = await readFile(path);
    assert.deepEqual(Buffer.from(roundTrip), Buffer.from(bytes));
  });

  it("utf-8 BOM is preserved on open/save via Encoding metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nova-wuf73-"));
    const path = join(dir, "bom.txt");
    const logical = "hello\n";
    const bytes = encodeText(logical, "utf-8", "lf", { bom: true });
    await writeFile(path, bytes);

    const shell = new EditorShell();
    const opened = await shell.openPath(path);
    assert.equal(opened.text, undefined);
    const intent = shell.intentService();
    assert.equal(
      intent.slice(opened.id, 0, intent.len(opened.id)),
      "hello\n",
    );
    assert.equal(opened.encoding, "utf-8");
    assert.equal(opened.bom, true);
    assert.equal(opened.eol, "lf");

    await shell.saveActive();
    assert.deepEqual(await readFile(path), Buffer.from(bytes));
  });
});

describe("mojibake repair proposal", () => {
  it("proposes Encoding reinterpretation plus a text Patch", () => {
    const intent = new IntentService();
    // GBK bytes for 你好, wrongly decoded as windows-1252 → mojibake in Buffer.
    const gbkBytes = encodeText("你好", "gbk", "lf");
    const mojibake = new TextDecoder("windows-1252").decode(gbkBytes);
    const buf = intent.createBuffer(mojibake, {
      encoding: "windows-1252",
      eol: "lf",
      bom: false,
    });

    const repair = new MojibakeRepair(intent);
    const proposal = repair.preview({
      bufferId: buf.id,
      assumedEncoding: "gbk",
    });

    assert.equal(proposal.proposedEncoding, "gbk");
    assert.equal(proposal.proposedBom, false);
    assert.equal(proposal.patches.length, 1);
    assert.equal(proposal.repairedText, "你好");
    assert.equal(proposal.patches[0]!.provenance.source, "encoding");
    assert.ok(proposal.patches[0]!.metadata?.encoding === "gbk");
  });
});

describe("Accept after mojibake preview", () => {
  it("makes logical text and Encoding consistent", () => {
    const intent = new IntentService();
    const gbkBytes = encodeText("你好", "gbk", "lf");
    const mojibake = new TextDecoder("windows-1252").decode(gbkBytes);
    const buf = intent.createBuffer(mojibake, {
      encoding: "windows-1252",
      eol: "lf",
      bom: false,
    });

    const repair = new MojibakeRepair(intent);
    const result = repair.previewAccept({
      bufferId: buf.id,
      assumedEncoding: "gbk",
    });
    assert.equal(result.ok, true);

    const after = intent.getBuffer(buf.id);
    assert.equal(bufferBody(intent, after.id), "你好");
    assert.equal(after.encoding, "gbk");
    assert.equal(after.bom, false);
    assert.equal(after.eol, "lf");
  });
});

describe("Accept does not silently change BOM/EOL", () => {
  it("leaves Encoding/EOL/BOM unchanged for ordinary text Patches", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("hello world", {
      encoding: "utf-8",
      eol: "crlf",
      bom: true,
    });

    const result = intent.accept([
      textPatch(buf.id, buf.revision, [
        { start: 6, end: 11, replacement: "nova", before: " ", after: "" },
      ]),
    ]);
    assert.equal(result.ok, true);

    const after = intent.getBuffer(buf.id);
    assert.equal(bufferBody(intent, after.id), "hello nova");
    assert.equal(after.encoding, "utf-8");
    assert.equal(after.eol, "crlf");
    assert.equal(after.bom, true);
  });

  it("applies Encoding/EOL/BOM only when Patch metadata is explicit", () => {
    const intent = new IntentService();
    const buf = intent.createBuffer("a\nb", {
      encoding: "utf-8",
      eol: "lf",
      bom: false,
    });

    const result = intent.accept([
      {
        bufferId: buf.id,
        baseRevision: buf.revision,
        edits: [
          { start: 0, end: 3, replacement: "a\r\nb", before: "", after: "" },
        ],
        provenance: { source: "user", label: "explicit-eol" },
        metadata: { encoding: "utf-8", eol: "crlf", bom: true },
      },
    ]);
    assert.equal(result.ok, true);

    const after = intent.getBuffer(buf.id);
    assert.equal(bufferBody(intent, after.id), "a\r\nb");
    assert.equal(after.encoding, "utf-8");
    assert.equal(after.eol, "crlf");
    assert.equal(after.bom, true);
  });
});
