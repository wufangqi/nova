/**
 * WUF-107 / WUF-120 contract: modeless Find dialog + Intent tab + marks.
 *
 * Seam: `FindDialog` (desktop/src/find-dialog.ts) driven through injectable
 * FindDialogPort (IPC) + FindDialogSurface + FindMarksSurface (no OS pixels).
 *
 * Acceptance:
 * - Tabs: 查找 | 替换 | Intent; Intent NL→regex via local RegexDraft
 * - Pattern shared between find + Intent; marks do not write Buffer
 * - Marks clear on dismiss / clearMarks / buffer edit
 * - RegexDraft fill lands on Intent tab; no Buffer write
 * - Replace Accept still via port → Intent Accept
 * - Find does not host bottom-bar Patch Intent / Action list
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
  type FindMarksSurface,
  type FindTab,
} from "../desktop/src/find-dialog.ts";
import { planFindMarkRects } from "../desktop/src/find-marks-paint.ts";
import { buildRegexDraft } from "../src/regex-draft.js";
import { IntentIpcHost } from "../src/ipc/host.js";

type SurfaceLog = {
  presents: FindDialogFields[];
  tabs: FindTab[];
  dismisses: number;
  focusPatternCalls: number;
  focusIntentCalls: number;
};

type MarksLog = {
  applies: FindHit[][];
  clears: number;
};

function recordingSurface(): FindDialogSurface & { log: SurfaceLog } {
  const log: SurfaceLog = {
    presents: [],
    tabs: [],
    dismisses: 0,
    focusPatternCalls: 0,
    focusIntentCalls: 0,
  };
  return {
    log,
    present(fields, meta) {
      log.presents.push({ ...fields, flags: { ...fields.flags } });
      if (meta?.tab) log.tabs.push(meta.tab);
    },
    dismiss() {
      log.dismisses += 1;
    },
    focusPattern() {
      log.focusPatternCalls += 1;
    },
    focusIntentUtterance() {
      log.focusIntentCalls += 1;
    },
  };
}

function recordingMarks(): FindMarksSurface & { log: MarksLog } {
  const log: MarksLog = { applies: [], clears: 0 };
  return {
    log,
    applyMarks(hits) {
      log.applies.push(hits.map((h) => ({ ...h })));
    },
    clearMarks() {
      log.clears += 1;
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

function makeDialog(
  host: IntentIpcHost,
  surface = recordingSurface(),
  marks = recordingMarks(),
) {
  return {
    dialog: new FindDialog(portFromHost(host), surface, {
      marks,
      draftEngine: { build: buildRegexDraft },
    }),
    surface,
    marks,
  };
}

describe("Find dialog is modeless — Find/replace/flags while editor stays editable", () => {
  it("openDialog presents fields and does not block the editor", async () => {
    const host = new IntentIpcHost();
    const { dialog, surface } = makeDialog(host);

    assert.equal(dialog.isOpen(), false);
    assert.equal(dialog.blocksEditor(), false);

    dialog.openDialog();
    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.blocksEditor(), false);
    assert.equal(surface.log.presents.length, 1);
    assert.deepEqual(surface.log.presents[0], dialog.getFields());
    assert.equal(dialog.getActiveTab(), "find");

    dialog.setFields({
      pattern: "alpha",
      replacement: "beta",
      flags: { i: true, m: false, s: true },
    });
    assert.equal(dialog.getFields().pattern, "alpha");
    assert.equal(dialog.getFields().replacement, "beta");
    assert.equal(dialog.getFields().flags.i, true);
    assert.equal(dialog.getFields().flags.s, true);
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

    const { dialog } = makeDialog(host);
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

describe("Tabs: 查找 | 替换 | Intent", () => {
  it("exposes find / replace / intent tabs and can switch between them", () => {
    const host = new IntentIpcHost();
    const { dialog, surface } = makeDialog(host);
    dialog.openDialog();
    assert.deepEqual(dialog.tabs(), ["find", "replace", "intent"]);

    dialog.setActiveTab("replace");
    assert.equal(dialog.getActiveTab(), "replace");
    assert.equal(surface.log.tabs.at(-1), "replace");

    dialog.setActiveTab("intent");
    assert.equal(dialog.getActiveTab(), "intent");
    assert.equal(surface.log.tabs.at(-1), "intent");
  });

  it("Intent pattern shares the find-tab pattern field", () => {
    const host = new IntentIpcHost();
    const { dialog } = makeDialog(host);
    dialog.openDialog("intent");
    dialog.setUtterance("write a regex for email");
    dialog.setFields({ pattern: "[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}" });
    assert.equal(
      dialog.getFields().pattern,
      dialog.getIntentState().pattern,
    );
    dialog.setActiveTab("find");
    assert.equal(
      dialog.getFields().pattern,
      "[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}",
    );
  });
});

describe("Intent generate / remark marks hits without writing Buffer", () => {
  it("generate from utterance builds RegexDraft, syncs pattern, marks hits", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "a1 b2 a3" },
    });

    const { dialog, marks } = makeDialog(host);
    dialog.openDialog("intent");
    dialog.setUtterance("regex a(\\d)");
    const generated = await dialog.generate();
    assert.equal(generated.ok, true);
    assert.equal(dialog.getFields().pattern, "a(\\d)");
    assert.equal(dialog.getIntentState().marksActive, true);
    assert.ok(dialog.getIntentState().hitCount >= 2);
    assert.ok(marks.log.applies.length >= 1);
    assert.equal(await sliceAll(host, bufferId), "a1 b2 a3");
  });

  it("hand-edited pattern + remark updates marks; still no Buffer write", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "red fox red hen" },
    });

    const { dialog, marks } = makeDialog(host);
    dialog.openDialog("intent");
    dialog.setFields({ pattern: "fox" });
    await dialog.remark();
    assert.equal(dialog.getIntentState().hitCount, 1);
    assert.equal(dialog.getIntentState().marksActive, true);

    dialog.setFields({ pattern: "red" });
    await dialog.remark();
    assert.equal(dialog.getIntentState().hitCount, 2);
    assert.ok(marks.log.applies.length >= 2);
    assert.equal(await sliceAll(host, bufferId), "red fox red hen");
  });

  it("empty pattern does not activate marks", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "anything" },
    });

    const { dialog, marks } = makeDialog(host);
    dialog.openDialog("intent");
    await dialog.remark();
    assert.equal(dialog.getIntentState().marksActive, false);
    assert.equal(dialog.getIntentState().hitCount, 0);
    assert.equal(marks.log.applies.length, 0);
  });
});

describe("Marks clear on dismiss / clearMarks / buffer edit", () => {
  it("clearMarks, closeDialog, and notifyBufferEdited clear marks", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const { dialog, marks, surface } = makeDialog(host);
    dialog.openDialog("intent");
    dialog.setFields({ pattern: "cat" });
    await dialog.remark();
    assert.equal(dialog.getIntentState().marksActive, true);

    dialog.clearMarks();
    assert.equal(dialog.getIntentState().marksActive, false);
    assert.ok(marks.log.clears >= 1);

    await dialog.remark();
    assert.equal(dialog.getIntentState().marksActive, true);
    dialog.closeDialog();
    assert.equal(dialog.getIntentState().marksActive, false);
    assert.ok(surface.log.dismisses >= 1);

    dialog.openDialog("intent");
    dialog.setFields({ pattern: "cat" });
    await dialog.remark();
    dialog.notifyBufferEdited();
    assert.equal(dialog.getIntentState().marksActive, false);
  });
});

describe("RegexDraft opens Find on Intent tab with fields filled", () => {
  it("applyRegexDraft fills fields, selects Intent tab, leaves Buffer unchanged", async () => {
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

    const { dialog, surface } = makeDialog(host);
    await dialog.applyRegexDraft(previewed.result.preview.draft, {
      utterance: "regex a(\\d)",
    });

    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.getActiveTab(), "intent");
    assert.equal(dialog.getFields().pattern, "a(\\d)");
    assert.equal(dialog.getIntentState().utterance, "regex a(\\d)");
    assert.equal(surface.log.presents.length, 1);
    assert.equal(surface.log.tabs.at(-1), "intent");
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

    const { dialog } = makeDialog(host);
    await dialog.applyRegexDraft({
      pattern: "red",
      replacement: "blue",
      flags: "g",
    });
    assert.equal(await sliceAll(host, bufferId), "red fox red hen");

    dialog.setActiveTab("replace");
    const accepted = await dialog.replaceAccept();
    assert.equal(accepted.accept.ok, true);
    assert.equal(await sliceAll(host, bufferId), "blue fox blue hen");
  });
});

describe("Find hosts RegexDraft Intent tab — not bottom-bar Patch Intent / Action list", () => {
  it("allows Intent tab; does not host bottom-bar Patch Intent or Action list", () => {
    const host = new IntentIpcHost();
    const { dialog } = makeDialog(host);
    dialog.openDialog();
    assert.equal(dialog.hasIntentTab(), true);
    assert.equal(dialog.hostsBottomBarPatchIntent(), false);
    assert.equal(dialog.hostsActionList(), false);
    // Legacy alias: bottom-bar Patch Intent / Action list still not hosted.
    assert.equal(dialog.hostsIntentOrAction(), false);
  });

  it("Intent tab can offer Save as Action when a pattern is present", () => {
    const host = new IntentIpcHost();
    const { dialog } = makeDialog(host);
    dialog.openDialog("intent");
    assert.equal(dialog.canSaveAsAction(), false);
    dialog.setFields({ pattern: "\\d+" });
    assert.equal(dialog.canSaveAsAction(), true);
    assert.deepEqual(dialog.getDraftForSave(), {
      pattern: "\\d+",
      replacement: "",
      flags: undefined,
    });
  });
});

describe("Hit ranges are planned for editor paint (US7)", () => {
  it("remark applies hits and planFindMarkRects draws every overlapping range", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const { dialog, marks } = makeDialog(host);
    dialog.openDialog("intent");
    dialog.setFields({ pattern: "cat" });
    await dialog.remark();

    assert.equal(dialog.getIntentState().marksActive, true);
    assert.equal(dialog.getIntentState().hitCount, 2);
    const applied = marks.log.applies.at(-1)!;
    assert.equal(applied.length, 2);

    const rects = planFindMarkRects(applied, {
      start: 0,
      text: "cat dog cat",
    });
    // Every hit overlapping the mounted window becomes at least one paint rect.
    assert.equal(rects.length, 2);
    assert.equal(rects[0]!.absStart, applied[0]!.start);
    assert.equal(rects[0]!.absEnd, applied[0]!.end);
    assert.equal(rects[1]!.absStart, applied[1]!.start);
    assert.equal(rects[1]!.absEnd, applied[1]!.end);
    assert.ok(rects.every((r) => r.widthCss.endsWith("ch")));
  });
});

describe("Large Buffer degrades to mounted visible window (US8)", () => {
  it("uses getVisibleRange when Buffer exceeds threshold and still paints hits", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    // "cat dog cat" — visible window [0, 5) is "cat d" → one "cat" hit.
    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const surface = recordingSurface();
    const marks = recordingMarks();
    const visible = { kind: "range" as const, start: 0, end: 5 };
    const dialog = new FindDialog(portFromHost(host), surface, {
      marks,
      draftEngine: { build: buildRegexDraft },
      largeBufferThreshold: 8,
      getBufferLength: () => 11,
      getVisibleRange: () => visible,
    });

    dialog.openDialog("intent");
    dialog.setFields({ pattern: "cat" });
    await dialog.remark();

    assert.equal(dialog.getIntentState().degraded, true);
    assert.equal(dialog.getIntentState().marksActive, true);
    assert.equal(dialog.getIntentState().hitCount, 1);
    const applied = marks.log.applies.at(-1)!;
    assert.equal(applied.length, 1);

    const rects = planFindMarkRects(applied, {
      start: visible.start,
      text: "cat d",
    });
    assert.equal(rects.length, 1);
    assert.equal(rects[0]!.absStart, 0);
    assert.equal(rects[0]!.absEnd, 3);
  });
});

describe("Empty utterance neither generates nor scans (US34)", () => {
  it("generate with blank utterance refuses and does not call find", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "keep intact" },
    });

    const base = portFromHost(host);
    let findCalls = 0;
    const port: FindDialogPort = {
      ...base,
      async find(params) {
        findCalls += 1;
        return base.find(params);
      },
    };
    const surface = recordingSurface();
    const marks = recordingMarks();
    const dialog = new FindDialog(port, surface, {
      marks,
      draftEngine: { build: buildRegexDraft },
    });

    dialog.openDialog("intent");
    dialog.setUtterance("   ");
    const result = await dialog.generate();
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "empty_utterance");
    assert.equal(findCalls, 0);
    assert.equal(dialog.getIntentState().marksActive, false);
    assert.equal(marks.log.applies.length, 0);
  });
});
