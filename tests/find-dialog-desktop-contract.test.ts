/**
 * WUF-107 / WUF-120 / WUF-121 contract: Find workbench (tabs, geometry, Intent).
 *
 * Seam: `FindDialog` (desktop/src/find-dialog.ts) driven through an injectable
 * FindDialogPort (IPC) + FindDialogSurface (no real OS dialog pixels).
 *
 * Acceptance:
 * - Find/replace/flags usable while dialog is open (modeless — editor not blocked)
 * - RegexDraft fill opens Intent tab with fields set; no Buffer write
 * - Replace Accept still goes through port → Intent Accept; never silent Buffer write
 * - Workbench hosts Intent/Actions (migrated off shell bottom bar)
 * - Center / drag / clamp / session memory; no install-level geometry key
 * - Marks activate from pattern hits; clear on dismiss / buffer edit
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
  type PresentOpts,
  type WorkbenchGeometry,
  type WorkbenchTab,
} from "../desktop/src/find-dialog.ts";
import { IntentIpcHost } from "../src/ipc/host.js";

type SurfaceLog = {
  presents: Array<{ fields: FindDialogFields; opts: PresentOpts }>;
  dismisses: number;
  focusPatternCalls: number;
  focusIntentCalls: number;
  tabs: WorkbenchTab[];
  geometries: WorkbenchGeometry[];
  measuredTabs: WorkbenchTab[];
};

/** Find panel is shorter; Intent (+ Actions) is taller — used to catch wrong-size centering. */
const FIND_SIZE = { widthPx: 400, heightPx: 300 };
const INTENT_SIZE = { widthPx: 400, heightPx: 500 };

function recordingSurface(
  opts: {
    /** When true, measureSize returns FIND vs INTENT heights by tab. */
    tabSizes?: boolean;
  } = {},
): FindDialogSurface & { log: SurfaceLog } {
  const log: SurfaceLog = {
    presents: [],
    dismisses: 0,
    focusPatternCalls: 0,
    focusIntentCalls: 0,
    tabs: [],
    geometries: [],
    measuredTabs: [],
  };
  return {
    log,
    present(fields, presentOpts) {
      log.presents.push({
        fields: { ...fields, flags: { ...fields.flags } },
        opts: {
          tab: presentOpts.tab,
          geometry: { ...presentOpts.geometry },
        },
      });
    },
    dismiss() {
      log.dismisses += 1;
    },
    focusPattern() {
      log.focusPatternCalls += 1;
    },
    focusIntent() {
      log.focusIntentCalls += 1;
    },
    setTab(tab) {
      log.tabs.push(tab);
    },
    setGeometry(geometry) {
      log.geometries.push({ ...geometry });
    },
    measureSize(tab) {
      if (!opts.tabSizes) return FIND_SIZE;
      log.measuredTabs.push(tab);
      return tab === "intent" ? INTENT_SIZE : FIND_SIZE;
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

const CLIENT = { widthPx: 1000, heightPx: 800 };
const SIZE = FIND_SIZE;

describe("Find dialog is modeless — Find/replace/flags while editor stays editable", () => {
  it("openDialog presents fields and does not block the editor", async () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);

    assert.equal(dialog.isOpen(), false);
    assert.equal(dialog.blocksEditor(), false);

    dialog.openDialog({ client: CLIENT, size: SIZE });
    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.blocksEditor(), false);
    assert.ok(surface.log.presents.length >= 1);
    assert.deepEqual(surface.log.presents.at(-1)!.fields, dialog.getFields());

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

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE });
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

describe("RegexDraft opens Intent tab with fields filled", () => {
  it("applyRegexDraft fills fields, presents Intent tab, leaves Buffer unchanged", async () => {
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
    assert.equal(dialog.getTab(), "intent");
    assert.equal(dialog.getFields().pattern, "a(\\d)");
    assert.ok(surface.log.presents.length >= 1);
    assert.equal(surface.log.presents.at(-1)!.opts.tab, "intent");
    assert.equal(surface.log.focusIntentCalls, 1);
    // Regression: void focusIntent must not fall through to focusPattern via `??`.
    assert.equal(surface.log.focusPatternCalls, 0);
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

describe("Workbench hosts Intent/Actions", () => {
  it("FindDialog hosts Intent or Action panels (shell bottom bar removed)", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE });
    assert.equal(dialog.hostsIntentOrAction(), true);
  });

  it("tabs switch among find / replace / intent", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE, tab: "find" });
    assert.equal(dialog.getTab(), "find");
    dialog.setTab("replace");
    assert.equal(dialog.getTab(), "replace");
    dialog.setTab("intent");
    assert.equal(dialog.getTab(), "intent");
  });

  it("Intent tab Preview→Accept writes Buffer (not an empty shell)", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "hello world" },
    });

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE, tab: "intent" });
    assert.equal(dialog.getTab(), "intent");
    assert.equal(dialog.hostsIntentOrAction(), true);

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "uppercase",
        selection: { start: 0, end: 5 },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "patches");
    if (previewed.result.preview.kind !== "patches") return;
    assert.equal(await sliceAll(host, bufferId), "hello world");

    const accepted = await host.handle({
      method: "accept",
      params: { patches: previewed.result.preview.patches },
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.result.accept.ok, true);
    assert.equal(await sliceAll(host, bufferId), "HELLO world");
    // Workbench still hosts Intent after Accept — panel is not a dead shell.
    assert.equal(dialog.isOpen(), true);
    assert.equal(dialog.getTab(), "intent");
    assert.equal(dialog.hostsIntentOrAction(), true);
  });
});

describe("Workbench geometry: center, drag, clamp, session memory", () => {
  it("present centers when there is no session memory", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE });
    assert.deepEqual(dialog.getGeometry(), { leftPx: 300, topPx: 250 });
    assert.equal(dialog.getSessionGeometry(), undefined);
    assert.equal(dialog.hasPersistentGeometryKey(), false);
  });

  it("File→Intent… path centers using Intent page size, not Find height", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface({ tabSizes: true });
    const dialog = new FindDialog(portFromHost(host), surface);
    // Caller may still pass Find-sized fallback; measureSize must win after present.
    dialog.openDialog({
      tab: "intent",
      client: CLIENT,
      size: FIND_SIZE,
    });
    assert.deepEqual(surface.log.measuredTabs, ["intent"]);
    // INTENT_SIZE 400×500 → center top = (800-500)/2 = 150 (not Find's 250).
    assert.deepEqual(dialog.getGeometry(), { leftPx: 300, topPx: 150 });
  });

  it("RegexDraft path centers using Intent size and never calls focusPattern", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const surface = recordingSurface({ tabSizes: true });
    const dialog = new FindDialog(portFromHost(host), surface);
    await dialog.applyRegexDraft(
      { pattern: "x", replacement: "", flags: "g" },
      { client: CLIENT, size: FIND_SIZE },
    );
    assert.deepEqual(surface.log.measuredTabs, ["intent"]);
    assert.deepEqual(dialog.getGeometry(), { leftPx: 300, topPx: 150 });
    assert.equal(surface.log.focusIntentCalls, 1);
    assert.equal(surface.log.focusPatternCalls, 0);
  });

  it("drag updates geometry, clamps, and remembers for re-present", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE });

    const afterDrag = dialog.dragTitleBar({ dx: 40, dy: -20 }, CLIENT, SIZE);
    assert.deepEqual(afterDrag, { leftPx: 340, topPx: 230 });
    assert.deepEqual(dialog.getSessionGeometry(), afterDrag);

    dialog.closeDialog();
    dialog.openDialog({ client: CLIENT, size: SIZE });
    assert.deepEqual(dialog.getGeometry(), afterDrag);
  });

  it("drag far off-screen is clamped so the title bar stays reachable", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE });
    const clamped = dialog.dragTitleBar({ dx: 50_000, dy: 50_000 }, CLIENT, SIZE);
    assert.ok(clamped.leftPx <= CLIENT.widthPx - 28);
    assert.ok(clamped.topPx <= CLIENT.heightPx - 28);
  });

  it("a fresh FindDialog has no session memory (restart resets to center)", () => {
    const host = new IntentIpcHost();
    const surface = recordingSurface();
    const first = new FindDialog(portFromHost(host), surface);
    first.openDialog({ client: CLIENT, size: SIZE });
    first.dragTitleBar({ dx: 80, dy: 40 }, CLIENT, SIZE);

    const restarted = new FindDialog(portFromHost(host), recordingSurface());
    restarted.openDialog({ client: CLIENT, size: SIZE });
    assert.equal(restarted.getSessionGeometry(), undefined);
    assert.deepEqual(restarted.getGeometry(), { leftPx: 300, topPx: 250 });
    assert.equal(restarted.hasPersistentGeometryKey(), false);
  });
});

describe("Marks: activate from hits; clear on dismiss / buffer edit", () => {
  it("markHits sets marksActive + count; clearMarks and dismiss reset", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    await host.handle({
      method: "edit_active",
      params: { text: "cat dog cat" },
    });

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.openDialog({ client: CLIENT, size: SIZE, tab: "intent" });
    dialog.setFields({ pattern: "cat", replacement: "", flags: {} });

    const marked = await dialog.markHits();
    assert.equal(marked.marksActive, true);
    assert.equal(marked.hitCount, 2);

    dialog.clearMarks();
    assert.equal(dialog.getMarksState().marksActive, false);

    await dialog.markHits();
    assert.equal(dialog.getMarksState().marksActive, true);
    dialog.closeDialog();
    assert.equal(dialog.getMarksState().marksActive, false);
  });

  it("onBufferEdited clears marks without writing Buffer", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;
    const bufferId = evoked.result.buffer.id;
    await host.handle({
      method: "edit_active",
      params: { text: "aa bb aa" },
    });

    const surface = recordingSurface();
    const dialog = new FindDialog(portFromHost(host), surface);
    dialog.setFields({ pattern: "aa", replacement: "", flags: {} });
    await dialog.markHits();
    assert.equal(dialog.getMarksState().hitCount, 2);

    dialog.onBufferEdited();
    assert.equal(dialog.getMarksState().marksActive, false);
    assert.equal(await sliceAll(host, bufferId), "aa bb aa");
  });
});
