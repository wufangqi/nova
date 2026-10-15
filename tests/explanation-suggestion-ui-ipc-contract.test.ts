/**
 * WUF-86 contract: Explanation panel (read-only + anchor jump) and
 * clipboard Suggestions (default off → opt-in → select enters preview).
 * Seam: IntentIpcHost thin facade over IntentService + ClipboardSuggestions.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IntentIpcHost } from "../src/ipc/host.js";

describe("IPC Explanation preview does not mutate Buffer", () => {
  it("preview_intent explanation leaves Buffer text/revision unchanged", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const original = "alpha\nERROR: boom\nomega";
    await host.handle({ method: "edit_active", params: { text: original } });

    const before = await host.handle({
      method: "get_buffer",
      params: { id: evoked.result.buffer.id, includeText: true },
    });
    assert.equal(before.ok, true);
    if (!before.ok) return;

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "explain this",
        selection: { start: 0, end: original.length },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "explanation");
    if (previewed.result.preview.kind !== "explanation") return;

    assert.ok(previewed.result.preview.explanation.summary.length > 0);
    assert.ok(previewed.result.preview.explanation.anchors.length >= 1);
    assert.equal(previewed.result.buffer.text, undefined);
    assert.equal(previewed.result.buffer.revision, before.result.revision);

    const rejected = await host.handle({
      method: "reject_preview",
      params: { previewId: previewed.result.preview.previewId },
    });
    assert.equal(rejected.ok, true);

    const after = await host.handle({
      method: "get_buffer",
      params: { id: evoked.result.buffer.id, includeText: true },
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.result.text, original);
    assert.equal(after.result.revision, before.result.revision);
  });
});

describe("IPC Explanation anchors jump or are distinguishable when invalid", () => {
  it("resolve_explanation_anchor returns valid offsets; stale → invalid", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const text = "alpha\nERROR: boom\nomega";
    await host.handle({ method: "edit_active", params: { text } });

    const previewed = await host.handle({
      method: "preview_intent",
      params: {
        utterance: "explain this",
        selection: { start: 0, end: text.length },
      },
    });
    assert.equal(previewed.ok, true);
    if (!previewed.ok) return;
    assert.equal(previewed.result.preview.kind, "explanation");
    if (previewed.result.preview.kind !== "explanation") return;

    const anchor =
      previewed.result.preview.explanation.anchors.find((a) =>
        a.excerpt.includes("ERROR"),
      ) ?? previewed.result.preview.explanation.anchors[0]!;

    const jumped = await host.handle({
      method: "resolve_explanation_anchor",
      params: { anchor },
    });
    assert.equal(jumped.ok, true);
    if (!jumped.ok) return;
    assert.equal(jumped.result.resolve.ok, true);
    if (!jumped.result.resolve.ok) return;
    assert.equal(jumped.result.resolve.status, "valid");
    assert.equal(jumped.result.buffer.text, undefined);
    const excerptSlice = await host.handle({
      method: "slice",
      params: {
        id: evoked.result.buffer.id,
        start: jumped.result.resolve.start,
        end: jumped.result.resolve.end,
      },
    });
    assert.equal(excerptSlice.ok, true);
    if (!excerptSlice.ok) return;
    assert.equal(excerptSlice.result.text, anchor.excerpt);

    // Destroy the anchored span so relocate cannot safely find a unique match.
    await host.handle({
      method: "edit_active",
      params: { text: "alpha\n(gone)\nomega" },
    });

    const stale = await host.handle({
      method: "resolve_explanation_anchor",
      params: { anchor },
    });
    assert.equal(stale.ok, true);
    if (!stale.ok) return;
    assert.equal(stale.result.resolve.ok, false);
    if (stale.result.resolve.ok) return;
    assert.equal(stale.result.resolve.status, "invalid");
    assert.ok(
      stale.result.resolve.reason === "reloc_failed" ||
        stale.result.resolve.reason === "stale" ||
        stale.result.resolve.reason === "unknown",
    );
  });
});

describe("IPC Suggestions default off; can enable / globally disable", () => {
  it("starts disabled; set_suggestions_enabled gates paste tips", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const state = await host.handle({
      method: "get_suggestions_enabled",
      params: {},
    });
    assert.equal(state.ok, true);
    if (!state.ok) return;
    assert.equal(state.result.enabled, false);

    const off = await host.handle({
      method: "suggestions_for_paste",
      params: { clipboardText: "ERROR failed\nWARN slow\n" },
    });
    assert.equal(off.ok, true);
    if (!off.ok) return;
    assert.deepEqual(off.result.suggestions, []);

    const enabled = await host.handle({
      method: "set_suggestions_enabled",
      params: { enabled: true },
    });
    assert.equal(enabled.ok, true);
    if (!enabled.ok) return;
    assert.equal(enabled.result.enabled, true);

    const tips = await host.handle({
      method: "suggestions_for_paste",
      params: {
        clipboardText: "  hello   world  \n\n\nERROR boom\nfoo@example.com\n",
      },
    });
    assert.equal(tips.ok, true);
    if (!tips.ok) return;
    assert.ok(tips.result.suggestions.length >= 1);
    assert.ok(tips.result.suggestions.length <= 3);

    const disabled = await host.handle({
      method: "set_suggestions_enabled",
      params: { enabled: false },
    });
    assert.equal(disabled.ok, true);
    if (!disabled.ok) return;
    assert.equal(disabled.result.enabled, false);

    const silenced = await host.handle({
      method: "suggestions_for_paste",
      params: { clipboardText: "ERROR x" },
    });
    assert.equal(silenced.ok, true);
    if (!silenced.ok) return;
    assert.deepEqual(silenced.result.suggestions, []);
  });
});

describe("IPC selecting a Suggestion enters preview without writing Buffer", () => {
  it("select_suggestion returns preview and leaves Buffer unchanged", async () => {
    const host = new IntentIpcHost();
    const evoked = await host.handle({ method: "evoke", params: {} });
    assert.equal(evoked.ok, true);
    if (!evoked.ok) return;

    const original = "paste me first\nERROR boom";
    await host.handle({ method: "edit_active", params: { text: original } });

    await host.handle({
      method: "set_suggestions_enabled",
      params: { enabled: true },
    });

    const tips = await host.handle({
      method: "suggestions_for_paste",
      params: { clipboardText: original },
    });
    assert.equal(tips.ok, true);
    if (!tips.ok) return;
    assert.ok(tips.result.suggestions.length >= 1);
    const chosen = tips.result.suggestions[0]!;

    const selected = await host.handle({
      method: "select_suggestion",
      params: {
        suggestion: chosen,
        selection: { start: 0, end: original.length },
      },
    });
    assert.equal(selected.ok, true);
    if (!selected.ok) return;

    assert.ok(
      selected.result.preview.kind === "patches" ||
        selected.result.preview.kind === "explanation" ||
        selected.result.preview.kind === "regex_draft" ||
        selected.result.preview.kind === "error",
    );
    assert.equal(selected.result.buffer.text, undefined);

    const after = await host.handle({
      method: "get_buffer",
      params: { id: evoked.result.buffer.id, includeText: true },
    });
    assert.equal(after.ok, true);
    if (!after.ok) return;
    assert.equal(after.result.text, original);
  });
});
