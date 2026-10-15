/**
 * WUF-93: desktop Action UI helpers (menus/buttons only).
 * Seam: pure message / eligibility helpers used by the shell —
 * Action semantics stay in IPC → ActionService.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canOfferSaveAsAction,
  messageForMutateFail,
  messageForPreviewRunFail,
  messageForSaveFail,
  messageForSaveOk,
} from "../desktop/src/action-ui.ts";

describe("Save as Action is offered only for RegexDraft previews", () => {
  it("offers save for regex_draft, refuses other kinds", () => {
    assert.equal(canOfferSaveAsAction("regex_draft"), true);
    assert.equal(canOfferSaveAsAction("patches"), false);
    assert.equal(canOfferSaveAsAction("explanation"), false);
    assert.equal(canOfferSaveAsAction("error"), false);
    assert.equal(canOfferSaveAsAction(null), false);
  });
});

describe("Save / mutate / preview_run failures are plain language", () => {
  it("maps save failure reasons to actionable copy (no raw reason codes)", () => {
    assert.match(messageForSaveFail("not_regex_draft"), /RegexDraft/);
    assert.match(messageForSaveFail("cap_exceeded"), /limit/i);
    assert.doesNotMatch(messageForSaveFail("cap_exceeded"), /cap_exceeded/);
    assert.match(messageForSaveFail("stale_preview"), /expired|Intent/i);
  });

  it("maps rename/delete not_found to plain language", () => {
    assert.match(messageForMutateFail("not_found"), /not found/i);
  });

  it("surfaces preview_run guidance (empty Selection vs zero matches distinct)", () => {
    const empty = messageForPreviewRunFail({
      reason: "empty_selection",
      guidance: "unused",
    });
    const zero = messageForPreviewRunFail({
      reason: "zero_matches",
      guidance: "unused",
    });
    assert.match(empty, /Selection is empty/);
    assert.match(zero, /No matches/);
    assert.notEqual(empty, zero);
  });

  it("confirms successful save with the Action display name", () => {
    assert.match(messageForSaveOk("uppercase digits"), /Saved Action/i);
    assert.match(messageForSaveOk("uppercase digits"), /uppercase digits/);
  });
});
