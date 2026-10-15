/**
 * WUF-93 contract: desktop Action panel (save from RegexDraft + list re-run / rename / delete).
 *
 * Seam under test: `ActionPanel` (desktop/src/action-panel.ts) driven through a port
 * backed by the real `IntentIpcHost`. That is the same thin IPC surface the desktop
 * shell calls via Tauri commands, so the contract covers the UI flow without asserting
 * widget trees: save → list → preview_run → Accept/reject, rename/delete, and the
 * plain-language failure paths (no preview, wrong preview kind, empty Selection,
 * zero matches, soft cap).
 *
 * Buffer writes stay on the existing write seam: the panel never mutates Buffer text,
 * it only forwards the returned Patch preview to accept / reject.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  ActionPanel,
  type ActionPanelPort,
  type ActionView,
} from "../desktop/src/action-panel.ts";
import { MemoryActionStore } from "../src/action-service.js";
import { IntentIpcHost } from "../src/ipc/host.js";
import type { Patch, SavedAction } from "../src/types.js";

function view(action: SavedAction): ActionView {
  return {
    id: action.id,
    displayName: action.displayName,
    pattern: action.draft.pattern,
    replacement: action.draft.replacement,
    flags: action.draft.flags,
    createdAt: action.createdAt,
  };
}

/** Port the desktop shell implements over Tauri invoke; here over the real IPC host. */
function portFromHost(host: IntentIpcHost): ActionPanelPort {
  return {
    async listActions() {
      const res = await host.handle({ method: "list_actions", params: {} });
      if (!res.ok) throw new Error(res.error);
      return res.result.actions.map(view);
    },
    async saveFromRegexDraft({ previewId }) {
      const res = await host.handle({
        method: "save_from_regex_draft",
        params: { previewId },
      });
      if (!res.ok) throw new Error(res.error);
      return res.result.ok
        ? { ok: true, action: view(res.result.action) }
        : { ok: false, reason: res.result.reason };
    },
    async renameAction({ id, displayName }) {
      const res = await host.handle({
        method: "rename_action",
        params: { id, displayName },
      });
      if (!res.ok) throw new Error(res.error);
      return res.result.ok
        ? { ok: true }
        : { ok: false, reason: res.result.reason };
    },
    async deleteAction({ id }) {
      const res = await host.handle({ method: "delete_action", params: { id } });
      if (!res.ok) throw new Error(res.error);
      return res.result.ok
        ? { ok: true }
        : { ok: false, reason: res.result.reason };
    },
    async previewRun({ actionId, selection }) {
      const res = await host.handle({
        method: "preview_run",
        params: { actionId, selection },
      });
      if (!res.ok) throw new Error(res.error);
      const run = res.result.run;
      return run.ok
        ? {
            ok: true,
            run: {
              previewId: run.previewId,
              patches: run.patches,
              cost: run.cost,
            },
          }
        : { ok: false, reason: run.reason, guidance: run.guidance };
    },
  };
}

function hostWithStore(store: MemoryActionStore, softCap?: number): IntentIpcHost {
  return new IntentIpcHost({
    modelAvailable: true,
    actionStore: store,
    actionSoftCap: softCap,
  });
}

function seedReplaceAction(
  store: MemoryActionStore,
  draft: { pattern: string; replacement: string; flags?: string },
  displayName = "paint red → blue",
): SavedAction {
  const action: SavedAction = {
    id: randomUUID(),
    displayName,
    draft: {
      pattern: draft.pattern,
      replacement: draft.replacement,
      flags: draft.flags ?? "g",
    },
    createdAt: new Date().toISOString(),
  };
  store.saveAll([action]);
  return action;
}

async function evokeWithText(host: IntentIpcHost, text: string): Promise<string> {
  const evoked = await host.handle({ method: "evoke", params: {} });
  assert.equal(evoked.ok, true);
  if (!evoked.ok) throw new Error("evoke failed");
  await host.handle({ method: "edit_active", params: { text } });
  return evoked.result.buffer.id;
}

async function preview(host: IntentIpcHost, utterance: string) {
  const res = await host.handle({
    method: "preview_intent",
    params: { utterance },
  });
  assert.equal(res.ok, true);
  if (!res.ok) throw new Error("preview_intent failed");
  return res.result.preview;
}

describe("desktop Action panel — save from RegexDraft preview", () => {
  it("saves the outstanding RegexDraft and it shows up in the list", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "a1 b2 a3");
    const panel = new ActionPanel(portFromHost(host));

    assert.deepEqual(await panel.refresh(), []);

    const draft = await preview(host, "regex a(\\d)");
    assert.equal(draft.kind, "regex_draft");
    if (draft.kind !== "regex_draft") return;

    const saved = await panel.save(draft.previewId);
    assert.equal(saved.ok, true);
    assert.match(saved.message, /saved action/i);

    const listed = panel.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.displayName, "regex a(\\d)");
    assert.equal(listed[0]!.pattern, "a(\\d)");
  });

  it("refuses a non-RegexDraft preview in plain language", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "hello world");
    const panel = new ActionPanel(portFromHost(host));

    const patches = await preview(host, "uppercase");
    assert.equal(patches.kind, "patches");

    const saved = await panel.save(patches.previewId);
    assert.equal(saved.ok, false);
    assert.match(saved.message, /RegexDraft/);
    assert.equal(panel.list().length, 0);
  });

  it("asks for a RegexDraft preview when none is outstanding", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "a1");
    const panel = new ActionPanel(portFromHost(host));

    const saved = await panel.save(null);
    assert.equal(saved.ok, false);
    assert.match(saved.message, /Intent/);
    // Distinct from the wrong-kind message — recovery steps differ.
    assert.doesNotMatch(saved.message, /Only a RegexDraft preview/);
  });

  it("reports the soft cap without a raw reason code", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store, 1);
    await evokeWithText(host, "a1 b2");
    const panel = new ActionPanel(portFromHost(host));

    const first = await preview(host, "regex first");
    const second = await preview(host, "regex second");
    assert.equal(first.kind, "regex_draft");
    assert.equal(second.kind, "regex_draft");
    if (first.kind !== "regex_draft" || second.kind !== "regex_draft") return;

    assert.equal((await panel.save(first.previewId)).ok, true);
    const overflow = await panel.save(second.previewId);
    assert.equal(overflow.ok, false);
    assert.match(overflow.message, /limit/i);
    assert.doesNotMatch(overflow.message, /cap_exceeded/);
    assert.equal(panel.list().length, 1);
  });
});

describe("desktop Action panel — re-run on Selection through the write seam", () => {
  it("previews on the current Selection and Accept writes via IntentService", async () => {
    const store = new MemoryActionStore();
    const seeded = seedReplaceAction(store, {
      pattern: "red",
      replacement: "blue",
    });
    const host = hostWithStore(store);
    const bufferId = await evokeWithText(host, "red fox red hen");
    const panel = new ActionPanel(portFromHost(host));
    await panel.refresh();

    const run = await panel.run(seeded.id, { start: 0, end: 8 });
    assert.equal(run.ok, true);
    assert.ok(run.run);
    assert.equal(run.run.cost.hasOutbound, false);
    assert.equal(run.run.patches[0]!.provenance?.source, "action");

    // Preview must not have written.
    const before = await host.handle({
      method: "get_buffer",
      params: { id: bufferId, includeText: true },
    });
    assert.equal(before.ok, true);
    if (!before.ok) return;
    assert.equal(before.result.text, "red fox red hen");

    const accepted = await host.handle({
      method: "accept",
      params: { patches: run.run.patches as unknown as Patch[] },
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.result.accept.ok, true);
    assert.equal(accepted.result.buffers[0]!.text, undefined);
    const sliced = await host.handle({
      method: "slice",
      params: { id: bufferId, start: 0, end: 16 },
    });
    assert.equal(sliced.ok, true);
    if (!sliced.ok) return;
    assert.equal(sliced.result.text, "blue fox red hen");
  });

  it("reject keeps the Buffer unchanged", async () => {
    const store = new MemoryActionStore();
    const seeded = seedReplaceAction(store, {
      pattern: "red",
      replacement: "blue",
    });
    const host = hostWithStore(store);
    const bufferId = await evokeWithText(host, "red fox");
    const panel = new ActionPanel(portFromHost(host));

    const run = await panel.run(seeded.id, { start: 0, end: 7 });
    assert.equal(run.ok, true);
    if (!run.ok || !run.run) return;

    const rejected = await host.handle({
      method: "reject_preview",
      params: { previewId: run.run.previewId },
    });
    assert.equal(rejected.ok, true);

    const after = await host.handle({
      method: "get_buffer",
      params: { id: bufferId, includeText: true },
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.result.text, "red fox");
  });

  it("empty Selection and zero matches give distinct visible reasons", async () => {
    const store = new MemoryActionStore();
    const seeded = seedReplaceAction(store, {
      pattern: "red",
      replacement: "blue",
    });
    const host = hostWithStore(store);
    await evokeWithText(host, "red fox");
    const panel = new ActionPanel(portFromHost(host));

    const empty = await panel.run(seeded.id, null);
    assert.equal(empty.ok, false);
    assert.match(empty.message, /Selection is empty/);

    const zero = await panel.run(seeded.id, { start: 4, end: 7 });
    assert.equal(zero.ok, false);
    assert.match(zero.message, /No matches/);
    assert.notEqual(empty.message, zero.message);
  });

  it("find-only Action refuses text Accept in plain language", async () => {
    const store = new MemoryActionStore();
    const findOnly: SavedAction = {
      id: randomUUID(),
      displayName: "find red",
      // A pattern-only Action (no replacement) must not offer a rewrite.
      draft: { pattern: "red", replacement: undefined, flags: "g" },
      createdAt: new Date().toISOString(),
    };
    store.saveAll([findOnly]);
    const host = hostWithStore(store);
    await evokeWithText(host, "red fox");
    const panel = new ActionPanel(portFromHost(host));
    await panel.refresh();

    const run = await panel.run(findOnly.id, { start: 0, end: 3 });
    assert.equal(run.ok, false);
    assert.match(run.message, /find-only/);
  });
});

describe("desktop Action panel — rename and delete", () => {
  it("renames the display name, deletes, and surfaces unknown ids", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "a1 b2");
    const panel = new ActionPanel(portFromHost(host));

    const draft = await preview(host, "regex a(\\d)");
    assert.equal(draft.kind, "regex_draft");
    if (draft.kind !== "regex_draft") return;
    assert.equal((await panel.save(draft.previewId)).ok, true);
    const id = panel.list()[0]!.id;
    const compiled = panel.list()[0]!.pattern;

    const renamed = await panel.rename(id, "digits");
    assert.equal(renamed.ok, true);
    assert.equal(panel.list()[0]!.displayName, "digits");
    // Compiled regex stays immutable — rename is display-only.
    assert.equal(panel.list()[0]!.pattern, compiled);

    const missingRename = await panel.rename("missing", "x");
    assert.equal(missingRename.ok, false);
    assert.match(missingRename.message, /not found/i);

    const deleted = await panel.remove(id);
    assert.equal(deleted.ok, true);
    assert.equal(panel.list().length, 0);

    const missingDelete = await panel.remove(id);
    assert.equal(missingDelete.ok, false);
    assert.match(missingDelete.message, /not found/i);
  });
});