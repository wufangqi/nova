/**
 * Action catalog contracts (WUF-89 save/list/persist; WUF-90 rename/delete/cap).
 * Seam: ActionService (+ injectable store) over IntentService previews.
 * No UI; no preview_run (later tickets).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ActionService,
  FileActionStore,
  MemoryActionStore,
} from "../src/action-service.js";
import { IntentService } from "../src/intent-service.js";
import { bufferBody } from './helpers/buffer-text.js';

describe("save from RegexDraft preview", () => {
  it("saves a valid regex_draft preview with default display name = utterance", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("a1 b2");
    const utterance = "regex a(\\d)";

    const preview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance }),
    );
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.action.displayName, utterance);
    assert.equal(saved.action.draft.pattern, preview.draft.pattern);
    assert.equal(saved.action.draft.replacement, preview.draft.replacement);
    assert.ok(saved.action.id.length > 0);
    assert.ok(saved.action.createdAt.length > 0);
  });

  it("list returns install-global catalog including the just-saved Action", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("x");

    const preview = intent.preview(
      intent.parse({
        bufferId: buf.id,
        utterance: "regex foo",
      }),
    );
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const listed = actions.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.id, saved.action.id);
    assert.equal(listed[0]!.displayName, "regex foo");
  });
});

describe("persistence across store reload", () => {
  it("Action remains after reloading a FileActionStore (restart equivalent)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nova-action-"));
    try {
      const intent = new IntentService({ modelAvailable: true });
      const store = new FileActionStore(dir);
      const actions = new ActionService(intent, store);
      const buf = intent.createBuffer("keep");

      const preview = intent.preview(
        intent.parse({
          bufferId: buf.id,
          utterance: "write a regex for digits",
        }),
      );
      assert.equal(preview.kind, "regex_draft");
      if (preview.kind !== "regex_draft") return;

      const saved = actions.saveFromRegexDraft({
        previewId: preview.previewId,
      });
      assert.equal(saved.ok, true);
      if (!saved.ok) return;

      // New facade + same store path = app restart.
      const reloaded = new ActionService(intent, new FileActionStore(dir));
      const listed = reloaded.list();
      assert.equal(listed.length, 1);
      assert.equal(listed[0]!.id, saved.action.id);
      assert.equal(listed[0]!.displayName, "write a regex for digits");
      assert.equal(listed[0]!.draft.pattern, saved.action.draft.pattern);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("save eligibility failures are distinguishable", () => {
  it("refuses patches preview with not_regex_draft", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("hello world");

    const preview = intent.preview(
      intent.parse({
        bufferId: buf.id,
        utterance: "make it uppercase",
        selection: { start: 0, end: bufferBody(intent, buf.id).length },
      }),
    );
    assert.equal(preview.kind, "patches");
    if (preview.kind !== "patches") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, false);
    if (saved.ok) return;
    assert.equal(saved.reason, "not_regex_draft");
    assert.equal(actions.list().length, 0);
  });

  it("refuses Explanation preview with not_regex_draft", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("some log line");

    const preview = intent.preview(
      intent.parse({
        bufferId: buf.id,
        utterance: "explain this",
        selection: { start: 0, end: bufferBody(intent, buf.id).length },
      }),
    );
    assert.equal(preview.kind, "explanation");
    if (preview.kind !== "explanation") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, false);
    if (saved.ok) return;
    assert.equal(saved.reason, "not_regex_draft");
    assert.equal(actions.list().length, 0);
  });

  it("refuses rejected / unknown preview with stale_preview", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("a1");

    const preview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex a1" }),
    );
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    intent.reject(preview.previewId);

    const afterReject = actions.saveFromRegexDraft({
      previewId: preview.previewId,
    });
    assert.equal(afterReject.ok, false);
    if (afterReject.ok) return;
    assert.equal(afterReject.reason, "stale_preview");

    const unknown = actions.saveFromRegexDraft({
      previewId: "not-a-real-preview",
    });
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.reason, "stale_preview");
    assert.equal(actions.list().length, 0);
  });
});

describe("rename changes display name only", () => {
  it("updates displayName and leaves compiled RegexDraft untouched", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("a1");

    const preview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex a(\\d)" }),
    );
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const draftBefore = {
      pattern: saved.action.draft.pattern,
      replacement: saved.action.draft.replacement,
      flags: saved.action.draft.flags,
    };

    const renamed = actions.rename(saved.action.id, "short label");
    assert.equal(renamed.ok, true);

    const listed = actions.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.displayName, "short label");
    assert.deepEqual(listed[0]!.draft, draftBefore);
    assert.equal(listed[0]!.id, saved.action.id);
    assert.equal(listed[0]!.createdAt, saved.action.createdAt);
  });

  it("fails with not_found for unknown id", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());

    const renamed = actions.rename("missing-action-id", "nope");
    assert.equal(renamed.ok, false);
    if (renamed.ok) return;
    assert.equal(renamed.reason, "not_found");
  });
});

describe("delete removes from catalog", () => {
  it("list no longer includes a deleted Action", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("x");

    const preview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex foo" }),
    );
    assert.equal(preview.kind, "regex_draft");
    if (preview.kind !== "regex_draft") return;

    const saved = actions.saveFromRegexDraft({ previewId: preview.previewId });
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const deleted = actions.delete(saved.action.id);
    assert.equal(deleted.ok, true);
    assert.equal(actions.list().length, 0);
  });

  it("fails with not_found for unknown id (distinguishable)", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());

    const deleted = actions.delete("no-such-action");
    assert.equal(deleted.ok, false);
    if (deleted.ok) return;
    assert.equal(deleted.reason, "not_found");
  });
});

describe("soft cap on save", () => {
  it("refuses save past soft cap with cap_exceeded", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore(), {
      softCap: 2,
    });
    const buf = intent.createBuffer("a1 b2 c3");

    for (let i = 0; i < 2; i++) {
      const preview = intent.preview(
        intent.parse({
          bufferId: buf.id,
          utterance: `regex item${i}`,
        }),
      );
      assert.equal(preview.kind, "regex_draft");
      if (preview.kind !== "regex_draft") return;
      const saved = actions.saveFromRegexDraft({
        previewId: preview.previewId,
      });
      assert.equal(saved.ok, true);
    }

    const overflowPreview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex overflow" }),
    );
    assert.equal(overflowPreview.kind, "regex_draft");
    if (overflowPreview.kind !== "regex_draft") return;

    const overflow = actions.saveFromRegexDraft({
      previewId: overflowPreview.previewId,
    });
    assert.equal(overflow.ok, false);
    if (overflow.ok) return;
    assert.equal(overflow.reason, "cap_exceeded");
    assert.equal(actions.list().length, 2);
  });
});

describe("duplicate display names are allowed", () => {
  it("two Actions may share the same displayName", () => {
    const intent = new IntentService({ modelAvailable: true });
    const actions = new ActionService(intent, new MemoryActionStore());
    const buf = intent.createBuffer("a1 b2");
    const sameName = "shared label";

    const firstPreview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex a(\\d)" }),
    );
    assert.equal(firstPreview.kind, "regex_draft");
    if (firstPreview.kind !== "regex_draft") return;
    const first = actions.saveFromRegexDraft({
      previewId: firstPreview.previewId,
      displayName: sameName,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const secondPreview = intent.preview(
      intent.parse({ bufferId: buf.id, utterance: "regex b(\\d)" }),
    );
    assert.equal(secondPreview.kind, "regex_draft");
    if (secondPreview.kind !== "regex_draft") return;
    const second = actions.saveFromRegexDraft({
      previewId: secondPreview.previewId,
      displayName: sameName,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;

    assert.notEqual(first.action.id, second.action.id);
    const listed = actions.list();
    assert.equal(listed.length, 2);
    assert.equal(listed.filter((a) => a.displayName === sameName).length, 2);
  });
});
