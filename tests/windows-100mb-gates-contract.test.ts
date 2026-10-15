/**
 * WUF-102: Windows 100MB open→editable + typing/scroll budgets + native package layout.
 */
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import { resolveNativeAddonPath } from "../src/buffer-core.js";
import {
  OPEN_100MB_EDITABLE_MAX_MS,
  SCROLL_100MB_MAX_MS,
  TYPING_100MB_MAX_MS,
  assertPackagedNativeLayout,
  ensure100MbFixture,
  evaluateTyping100MbGate,
  runWindowsGates,
} from "../src/windows-gates.js";

describe("WUF-102 budget constants are non-vacuous", () => {
  it("sets finite positive ms ceilings", () => {
    assert.ok(OPEN_100MB_EDITABLE_MAX_MS > 0);
    assert.ok(OPEN_100MB_EDITABLE_MAX_MS < 120_000);
    assert.ok(TYPING_100MB_MAX_MS > 0);
    assert.ok(TYPING_100MB_MAX_MS < 5_000);
    assert.ok(SCROLL_100MB_MAX_MS > 0);
    assert.ok(SCROLL_100MB_MAX_MS < 5_000);
  });
});

describe("WUF-102 100MB fixture + packaged native layout", () => {
  it("builds or reuses a ~100MB UTF-8 fixture", async () => {
    const path = await ensure100MbFixture();
    assert.ok(path.length > 0);
  });

  it("resolves native addon the way installer resources nest it", () => {
    const addon = resolveNativeAddonPath();
    const resources = mkdtempSync(join(tmpdir(), "nova-pack-"));
    const novaDist = join(resources, "nova-dist");
    const nativeDir = join(resources, "native", "buffer-core");
    mkdirSync(novaDist, { recursive: true });
    mkdirSync(nativeDir, { recursive: true });
    // Copy only enough for path resolution — reuse real addon bytes.
    copyFileSync(addon, join(nativeDir, basename(addon)));
    writeFileSync(join(novaDist, "buffer-core.js"), "// stub\n");
    assert.equal(assertPackagedNativeLayout(resources), true);
  });
});

describe("WUF-102 typing_100mb is not vacuous", () => {
  it("fails when mid-buffer was not written even if timing is fine", () => {
    const noWrite = evaluateTyping100MbGate(1, "LINE-");
    assert.equal(noWrite.ok, false);
    assert.match(noWrite.detail, /did not write|want "typed"/);
  });

  it("passes when mid reads back typed within budget", () => {
    const ok = evaluateTyping100MbGate(1, "typed");
    assert.equal(ok.ok, true);
    assert.match(ok.detail, /typed/);
  });

  it("fails when typed is present but budget is exceeded", () => {
    const slow = evaluateTyping100MbGate(TYPING_100MB_MAX_MS + 1, "typed");
    assert.equal(slow.ok, false);
    assert.match(slow.detail, /budget exceeded/);
  });
});

describe("WUF-102 gates:windows suite", () => {
  it("passes open/typing/scroll/native alongside legacy floors", async () => {
    const report = await runWindowsGates();
    assert.equal(report.ok, true, JSON.stringify(report.gates, null, 2));
    for (const name of [
      "open_100mb_editable",
      "typing_100mb",
      "scroll_100mb",
      "native_addon_load",
      "cold_start",
      "hotkey_evoke",
    ] as const) {
      const g = report.gates.find((x) => x.name === name);
      assert.ok(g, `missing gate ${name}`);
      assert.equal(g!.ok, true, g!.detail);
    }
    const typing = report.gates.find((g) => g.name === "typing_100mb")!;
    assert.match(typing.detail, /"typed"/);
  });
});
