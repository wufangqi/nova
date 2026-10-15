/**
 * WUF-92 contract: Action facade thin-wrapped via IPC host.
 * Seam: IntentIpcHost Action methods
 *   (save_from_regex_draft / list_actions / rename_action / delete_action / preview_run).
 * Buffer writes only through existing accept / reject — no second write API.
 * Host forwards to ActionService; tests inject MemoryActionStore.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  ActionService,
  MemoryActionStore,
} from "../src/action-service.js";
import { IntentIpcHost } from "../src/ipc/host.js";
import type { SavedAction } from "../src/types.js";

function hostWithStore(
  store: MemoryActionStore,
  softCap?: number,
): IntentIpcHost {
  return new IntentIpcHost({
    modelAvailable: true,
    actionStore: store,
    actionSoftCap: softCap,
  });
}

function seedReplaceAction(
  store: MemoryActionStore,
  draft: { pattern: string; replacement: string; flags?: string },
  displayName = "seeded-action",
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

async function evokeWithText(
  host: IntentIpcHost,
  text: string,
): Promise<string> {
  const evoked = await host.handle({ method: "evoke", params: {} });
  assert.equal(evoked.ok, true);
  if (!evoked.ok) throw new Error("evoke failed");
  await host.handle({ method: "edit_active", params: { text } });
  return evoked.result.buffer.id;
}

async function previewRegexDraft(
  host: IntentIpcHost,
  utterance: string,
): Promise<string> {
  const previewed = await host.handle({
    method: "preview_intent",
    params: { utterance },
  });
  assert.equal(previewed.ok, true);
  if (!previewed.ok) throw new Error("preview_intent failed");
  assert.equal(previewed.result.preview.kind, "regex_draft");
  if (previewed.result.preview.kind !== "regex_draft") {
    throw new Error("expected regex_draft");
  }
  return previewed.result.preview.previewId;
}

describe("IPC Action methods mirror the facade", () => {
  it("exposes save / list / rename / delete / preview_run (no second write API)", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "a1 b2");
    const previewId = await previewRegexDraft(host, "regex a(\\d)");

    const saved = await host.handle({
      method: "save_from_regex_draft",
      params: { previewId },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.result.ok, true);
    if (!saved.result.ok) return;
    const actionId = saved.result.action.id;

    const listed = await host.handle({
      method: "list_actions",
      params: {},
    });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.result.actions.length, 1);
    assert.equal(listed.result.actions[0]!.id, actionId);

    const renamed = await host.handle({
      method: "rename_action",
      params: { id: actionId, displayName: "short" },
    });
    assert.equal(renamed.ok, true);
    if (!renamed.ok) return;
    assert.equal(renamed.result.ok, true);

    const afterRename = await host.handle({
      method: "list_actions",
      params: {},
    });
    assert.equal(afterRename.ok, true);
    if (!afterRename.ok) return;
    assert.equal(afterRename.result.actions[0]!.displayName, "short");

    const deleted = await host.handle({
      method: "delete_action",
      params: { id: actionId },
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.equal(deleted.result.ok, true);

    const afterDelete = await host.handle({
      method: "list_actions",
      params: {},
    });
    assert.equal(afterDelete.ok, true);
    if (!afterDelete.ok) return;
    assert.equal(afterDelete.result.actions.length, 0);
  });
});

describe("IPC save → list → preview_run → accept loop", () => {
  it("runs the sticky path through IPC (Accept stays the only write)", async () => {
    const store = new MemoryActionStore();
    // Intent RegexDraft today has no replacement; seed a replace Action for the run→Accept leg
    // (same fixture style as WUF-91), then prove save/list on the same IPC host.
    const seeded = seedReplaceAction(
      store,
      { pattern: "red", replacement: "blue", flags: "g" },
      "paint red→blue",
    );
    const host = hostWithStore(store);
    const bufferId = await evokeWithText(host, "red fox red hen");

    const previewId = await previewRegexDraft(host, "regex a(\\d)");
    const saved = await host.handle({
      method: "save_from_regex_draft",
      params: { previewId, displayName: "digits" },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.result.ok, true);

    const listed = await host.handle({ method: "list_actions", params: {} });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.ok(listed.result.actions.some((a) => a.id === seeded.id));
    assert.ok(listed.result.actions.some((a) => a.displayName === "digits"));

    const run = await host.handle({
      method: "preview_run",
      params: {
        actionId: seeded.id,
        bufferId,
        selection: { start: 0, end: 8 },
      },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.result.run.ok, true);
    if (!run.result.run.ok) return;
    assert.equal(run.result.run.cost.hasOutbound, false);
    assert.equal(run.result.buffer.text, "red fox red hen");
    assert.equal(run.result.run.patches[0]!.provenance.source, "action");

    const accepted = await host.handle({
      method: "accept",
      params: { patches: run.result.run.patches },
    });
    assert.equal(accepted.ok, true);
    if (!accepted.ok) return;
    assert.equal(accepted.result.accept.ok, true);
    assert.equal(accepted.result.buffers[0]!.text, undefined);
    const sliced = await host.handle({
      method: "slice",
      params: {
        id: accepted.result.buffers[0]!.id,
        start: 0,
        end: 16,
      },
    });
    assert.equal(sliced.ok, true);
    if (!sliced.ok) return;
    assert.equal(sliced.result.text, "blue fox red hen");
  });
});

describe("IPC rename / delete / soft cap / empty Selection match facade", () => {
  it("rename and delete reasons match ActionService", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    await evokeWithText(host, "x");
    const previewId = await previewRegexDraft(host, "regex foo");
    const saved = await host.handle({
      method: "save_from_regex_draft",
      params: { previewId },
    });
    assert.equal(saved.ok, true);
    if (!saved.ok || !saved.result.ok) return;
    const id = saved.result.action.id;

    const renamed = await host.handle({
      method: "rename_action",
      params: { id, displayName: "label" },
    });
    assert.equal(renamed.ok, true);
    if (!renamed.ok) return;
    assert.equal(renamed.result.ok, true);

    const missingRename = await host.handle({
      method: "rename_action",
      params: { id: "missing", displayName: "x" },
    });
    assert.equal(missingRename.ok, true);
    if (!missingRename.ok) return;
    assert.equal(missingRename.result.ok, false);
    if (missingRename.result.ok) return;
    assert.equal(missingRename.result.reason, "not_found");

    const deleted = await host.handle({
      method: "delete_action",
      params: { id },
    });
    assert.equal(deleted.ok, true);
    if (!deleted.ok) return;
    assert.equal(deleted.result.ok, true);

    const missingDelete = await host.handle({
      method: "delete_action",
      params: { id },
    });
    assert.equal(missingDelete.ok, true);
    if (!missingDelete.ok) return;
    assert.equal(missingDelete.result.ok, false);
    if (missingDelete.result.ok) return;
    assert.equal(missingDelete.result.reason, "not_found");
  });

  it("soft cap exceeded on save via IPC", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store, 1);
    await evokeWithText(host, "a1 b2");

    const firstId = await previewRegexDraft(host, "regex first");
    const first = await host.handle({
      method: "save_from_regex_draft",
      params: { previewId: firstId },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.result.ok, true);

    const secondId = await previewRegexDraft(host, "regex second");
    const overflow = await host.handle({
      method: "save_from_regex_draft",
      params: { previewId: secondId },
    });
    assert.equal(overflow.ok, true);
    if (!overflow.ok) return;
    assert.equal(overflow.result.ok, false);
    if (overflow.result.ok) return;
    assert.equal(overflow.result.reason, "cap_exceeded");

    const listed = await host.handle({ method: "list_actions", params: {} });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    assert.equal(listed.result.actions.length, 1);
  });

  it("empty Selection on preview_run fails like the facade", async () => {
    const store = new MemoryActionStore();
    const seeded = seedReplaceAction(store, {
      pattern: "red",
      replacement: "blue",
    });
    const host = hostWithStore(store);
    const bufferId = await evokeWithText(host, "red fox");

    const run = await host.handle({
      method: "preview_run",
      params: {
        actionId: seeded.id,
        bufferId,
        selection: { start: 2, end: 2 },
      },
    });
    assert.equal(run.ok, true);
    if (!run.ok) return;
    assert.equal(run.result.run.ok, false);
    if (run.result.run.ok) return;
    assert.equal(run.result.run.reason, "empty_selection");
    assert.equal(run.result.buffer.text, "red fox");
  });
});

describe("IPC host has no Action semantics (pure forward)", () => {
  it("delegates Action methods to ActionService without reimplementing rules", async () => {
    const store = new MemoryActionStore();
    const host = hostWithStore(store);
    assert.ok(host.actions instanceof ActionService);

    let saveCalls = 0;
    let listCalls = 0;
    let renameCalls = 0;
    let deleteCalls = 0;
    let runCalls = 0;

    const originalSave = host.actions.saveFromRegexDraft.bind(host.actions);
    host.actions.saveFromRegexDraft = (input) => {
      saveCalls += 1;
      return originalSave(input);
    };
    const originalList = host.actions.list.bind(host.actions);
    host.actions.list = () => {
      listCalls += 1;
      return originalList();
    };
    const originalRename = host.actions.rename.bind(host.actions);
    host.actions.rename = (id, name) => {
      renameCalls += 1;
      return originalRename(id, name);
    };
    const originalDelete = host.actions.delete.bind(host.actions);
    host.actions.delete = (id) => {
      deleteCalls += 1;
      return originalDelete(id);
    };
    const originalRun = host.actions.previewRun.bind(host.actions);
    host.actions.previewRun = (input) => {
      runCalls += 1;
      return originalRun(input);
    };

    await evokeWithText(host, "a1");
    const previewId = await previewRegexDraft(host, "regex a1");
    await host.handle({
      method: "save_from_regex_draft",
      params: { previewId },
    });
    await host.handle({ method: "list_actions", params: {} });
    const listed = await host.handle({ method: "list_actions", params: {} });
    assert.equal(listed.ok, true);
    if (!listed.ok) return;
    const id = listed.result.actions[0]!.id;
    await host.handle({
      method: "rename_action",
      params: { id, displayName: "n" },
    });
    await host.handle({
      method: "preview_run",
      params: {
        actionId: id,
        selection: { start: 0, end: 1 },
      },
    });
    await host.handle({ method: "delete_action", params: { id } });

    assert.equal(saveCalls, 1);
    assert.ok(listCalls >= 2);
    assert.equal(renameCalls, 1);
    assert.equal(deleteCalls, 1);
    assert.equal(runCalls, 1);
  });
});
