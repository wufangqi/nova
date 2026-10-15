/**
 * WUF-78 contract: clipboard Suggestions default off; opt-in paste hints;
 * selecting one enters Intent/preview — never mutates Buffer directly.
 * Seam: ClipboardSuggestions (+ IntentService.parse/preview).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ClipboardSuggestions, MAX_SUGGESTIONS } from "../src/suggestions.js";
import { IntentService } from "../src/intent-service.js";
import { bufferBody } from './helpers/buffer-text.js';

describe("Suggestions default off", () => {
  it("is disabled on construction and returns no items on paste", () => {
    const svc = new IntentService({ modelAvailable: true });
    const tips = new ClipboardSuggestions(svc);

    assert.equal(tips.isEnabled(), false);

    const items = tips.suggestionsForPaste(
      "ERROR failed\nWARN slow\ninfo ok\n",
    );
    assert.deepEqual(items, []);
  });
});

describe("enabled paste yields at most a few Suggestions", () => {
  it("returns a non-empty list capped at MAX_SUGGESTIONS", () => {
    const svc = new IntentService({ modelAvailable: true });
    const tips = new ClipboardSuggestions(svc);
    tips.setEnabled(true);

    assert.equal(tips.isEnabled(), true);

    const messy =
      "  hello   world  \n\n\nERROR boom\nfoo@example.com\n";
    const items = tips.suggestionsForPaste(messy);

    assert.ok(items.length >= 1);
    assert.ok(items.length <= MAX_SUGGESTIONS);
    assert.equal(MAX_SUGGESTIONS, 3);

    for (const s of items) {
      assert.ok(s.id.length > 0);
      assert.ok(s.label.length > 0);
      assert.ok(s.utterance.length > 0);
    }
  });
});

describe("selecting a Suggestion enters Intent/preview without writing Buffer", () => {
  it("select runs parse+preview and leaves Buffer text unchanged", () => {
    const svc = new IntentService({ modelAvailable: true });
    const original = "paste me first";
    const buf = svc.createBuffer(original);
    const tips = new ClipboardSuggestions(svc);
    tips.setEnabled(true);

    const items = tips.suggestionsForPaste(original);
    assert.ok(items.length >= 1);
    const chosen = items[0]!;

    const preview = tips.select(chosen, buf.id);
    assert.notEqual(preview.kind, undefined);
    // Preview may be patches / explanation / regex_draft / error — but never a silent write.
    assert.ok(
      preview.kind === "patches" ||
        preview.kind === "explanation" ||
        preview.kind === "regex_draft" ||
        preview.kind === "error",
    );

    assert.equal(bufferBody(svc, buf.id), original);
  });

  it("Accept remains the only write path after selecting a Suggestion", () => {
    const svc = new IntentService({ modelAvailable: true });
    const original = "a1 b2 a3";
    const buf = svc.createBuffer(original);
    const tips = new ClipboardSuggestions(svc);
    tips.setEnabled(true);

    // Prefer a transform-style utterance if present; else take first.
    const items = tips.suggestionsForPaste(original);
    const transformish =
      items.find((s) => /filter|clean|trim|normalize|error/i.test(s.utterance)) ??
      items[0]!;

    const preview = tips.select(transformish, buf.id, {
      start: 0,
      end: original.length,
    });
    assert.equal(bufferBody(svc, buf.id), original);

    if (preview.kind === "patches") {
      const accepted = svc.accept(preview.patches);
      assert.equal(accepted.ok, true);
      assert.notEqual(bufferBody(svc, buf.id), original);
    } else {
      // Non-patch preview still must not have mutated; reject is a no-op write.
      if (preview.kind !== "error") {
        svc.reject(preview.previewId);
      }
      assert.equal(bufferBody(svc, buf.id), original);
    }
  });
});

describe("global disable silences Suggestions", () => {
  it("disable clears further paste Suggestions", () => {
    const svc = new IntentService({ modelAvailable: true });
    const tips = new ClipboardSuggestions(svc);
    tips.setEnabled(true);
    assert.ok(tips.suggestionsForPaste("ERROR x").length > 0);

    tips.disable();
    assert.equal(tips.isEnabled(), false);
    assert.deepEqual(tips.suggestionsForPaste("ERROR x"), []);

    // setEnabled(false) is equivalent
    tips.setEnabled(true);
    tips.setEnabled(false);
    assert.deepEqual(tips.suggestionsForPaste("hello"), []);
  });
});
