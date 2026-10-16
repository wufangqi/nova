/**
 * WUF-107 contract: FindBar as modeless dialog + RegexDraft open/focus.
 *
 * Seam: `FindDialog` (desktop/src/find-dialog.ts) driven through an injectable
 * FindDialogPort (IPC) + FindDialogSurface (no real OS dialog pixels).
 *
 * Acceptance:
 * - Find/replace/flags usable while dialog is open (modeless — editor not blocked)
 * - RegexDraft fill opens/focuses dialog with fields set; no Buffer write
 * - Replace Accept still goes through port → Intent Accept; never silent Buffer write
 * - Intent/Action stay on the main surface (FindDialog does not host them)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FindDialog,
  type FindDialogFields,
  type FindDialogPort,
  type FindDialogSurface,
  type FindDraft,
  type FindHit,
} from "../desktop/src/find-dialog.ts";
import { IntentIpcHost } from "../src/ipc/host.js";

type SurfaceLog = {
  presents: FindDialogFields[];
  dismisses: number;
  focusPatternCalls: number;
};

function recordingSurface(): FindDialogSurface & { log: SurfaceLog } {
  const log: SurfaceLog = {
    presents: [],
    dismisses: 0,
    focusPatternCalls: 0,
  };
  return {
    log,
    present(fields) {
      log.presents.push({ ...fields, flags: { ...fields.flags } });
    },
    dismiss() {
      log.dismisses += 1;
    },
    focusPattern() {
      log.focusPatternCalls += 1;
    },
  };
}

async function sliceAll(host: IntentIpcHost, id: string): Promise<string> {
  const len = await host.handle({ method: "buffer_len", params: { id } });
  assert.equal(len.ok, true);
  if (!len.ok) return "";
  const n = len.result.len;
  if (n === 0) return "";
  const sliced = await host.handle({
    method: "slice",
    params: { id, start: 0, end: n },
  });
  assert.equal(sliced.ok, true);
  if (!sliced.ok) return "";
  return sliced.result.text;
}

function portFromHost(host: IntentIpcHost): FindDialogPort {
  return {
    async find(params) {
      const res = await host.handle({ method: "find", params });
      if (!res.ok) throw new Error(res.error);
      return { hits: res.result.hits as FindHit[], count: res.result.count };
    },
    async previewReplace(params) {
      const res = await host.handle({ method: "preview_replace", params });
      if (!res.ok) throw new Error(res.error);
      return { preview: res.result.preview };
    },
    async replaceAccept(params) {
      const res = await host.handle({ method: "replace_accept", params });
      if (!res.ok) throw new Error(res.error);
      return { accept: res.result.accept };
    },
    async applyDraft(draft: FindDraft) {
      const res = await host.handle({ method: "apply_draft", params: { draft } });
      if (!res.ok) throw new Error(res.error);
    },
  };
}

describe("Find dialog is modeless — Find/replace/flags while editor stays editable", () => {
  it("openDialog presents fields and does not block the editor", async () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);

    assert.equal(dialog.isOpen(), false);
    assert.equal(dialog.blocksEditor(), false);

    dialog.openDialog();
    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.blocksEditor(), false);
    assert.equal(surface.log.presents.length, 1);
    assert.deepEqual(surface.log.presents[0], dialog.getFields());

    dialog.setFields({
      pattern: "alpha",
      replacement: "beta",
      flags: { i: true, m: false, s: true },
    });
    assert.equal(dialog.getFields().pattern, "alpha");
    assert.equal(dialog.getFields().replacement, "beta");
    assert.equal(dialog.getFields().flags.i, true);
    assert.equal(dialog.getFields().flags.s, true);
    // Modeless: still not blocking after field edits.
    assert.equal(dialog.blocksEditor(), false);
  });

  it("find / previewReplace work through the open dialog without writing Buffer", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog();
    dialog.setFields({
      pattern: "cat",
      replacement: "owl",
      flags: {},
    });

    const found = await dialog.find();
    assert.equal(found.count, 2);
    assert.equal(await sliceAll(host, bufferId), "cat dog cat");

    const previewed = await dialog.previewReplace();
    assert.equal(previewed.preview.ok, true);
    if (!previewed.preview.ok) return;
    assert.equal(previewed.preview.patches[0]!.provenance.source, "findbar");
    assert.equal(await sliceAll(host, bufferId), "cat dog cat");
    assert.equal(dialog.blocksEditor(), false);
  });
});

describe("RegexDraft opens/focuses Find dialog with fields filled", () => {
  it("applyRegexDraft fills fields, presents + focuses, leaves Buffer unchanged", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "a1 b2 a3" },
    });

    const previewed = await host.handle({
      method: "preview_intent",
      params: { utterance: "regex a(\\d)" },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "regex_draft");
    if (previewed.result.preview.kind !== "regex_draft") return;

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    await dialog.applyRegexDraft(previewed.result.preview.draft);

    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.getFields().pattern, "a(\\d)");
    assert.equal(surface.log.presents.length, 1);
    assert.equal(surface.log.focusPatternCalls, 1);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");

    const found = await dialog.find();
    assert.equal(found.count, 2);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");
  });
});

describe("Replace Accept stays on Patch preview seam — no silent Buffer write", () => {
  it("applyRegexDraft alone does not write; replaceAccept writes via Accept", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "red fox red hen" },
    });

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    await dialog.applyRegexDraft({
      pattern: "red",
      replacement: "blue",
      flags: "g",
    });
    assert.equal(await sliceAll(host, bufferId), "red fox red hen");

    const accepted = await dialog.replaceAccept();
    assert.equal(accepted.accept.ok, true);
    assert.equal(await sliceAll(host, bufferId), "blue fox blue hen");
  });
});

describe("Intent/Action stay on main surface", () => {
  it("FindDialog does not host Intent or Action panels", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog();
    assert.equal(dialog.hostsIntentOrAction(), false);
  });
});
