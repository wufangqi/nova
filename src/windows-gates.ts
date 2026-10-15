/**
 * Windows-first capability floors (ADR-0004 / WUF-79 / WUF-102).
 * Runnable on any Node host; Windows is the gated release target.
 * Floors: cold start, hotkey evoke, large-file Scope sample,
 * ~100MB open→editable, typing, scroll, native addon load.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import {
  createUntitled,
  dropBuffer,
  resolveNativeAddonPath,
} from "./buffer-core.js";
import { EditorShell } from "./editor-shell.js";
import { IntentService } from "./intent-service.js";
import { LocalModelGateway } from "./model-gateway.js";

/** Logical size used for the large-file Scope floor (~2 MiB of ASCII). */
export const LARGE_FILE_CHARS = 2 * 1024 * 1024;

/** ~100 MiB fixture for open→editable / typing / scroll gates. */
export const FIXTURE_100MB_BYTES = 100 * 1024 * 1024;

/** Soft ceilings — contract floors, not UI frame budgets. */
export const COLD_START_MAX_MS = 500;
export const HOTKEY_EVOKE_MAX_MS = 50;
export const LARGE_FILE_MAX_MS = 3000;

/**
 * Concrete non-vacuous budgets (WUF-102). Falsifiable on Windows CI:
 * open must finish before a long hang; typing/scroll must stay interactive.
 */
export const OPEN_100MB_EDITABLE_MAX_MS = 30_000;
export const TYPING_100MB_MAX_MS = 250;
export const SCROLL_100MB_MAX_MS = 250;

export type GateName =
  | "cold_start"
  | "hotkey_evoke"
  | "large_file"
  | "open_100mb_editable"
  | "typing_100mb"
  | "scroll_100mb"
  | "native_addon_load";

export interface GateResult {
  name: GateName;
  ok: boolean;
  elapsedMs: number;
  detail: string;
}

export interface WindowsGatesReport {
  ok: boolean;
  gates: GateResult[];
  usedWorkspaceNoun: false;
  usedProjectNoun: false;
}

function coldStartGate(): GateResult {
  const t0 = performance.now();
  const intent = new IntentService({
    modelAvailable: true,
    modelGateway: new LocalModelGateway(),
  });
  const shell = new EditorShell(intent);
  shell.handleHotkeyEvoke();
  shell.editActive("cold");
  const elapsedMs = performance.now() - t0;
  const ok = elapsedMs <= COLD_START_MAX_MS;
  return {
    name: "cold_start",
    ok,
    elapsedMs,
    detail: ok
      ? `construct+evoke+edit ${elapsedMs.toFixed(1)}ms ≤ ${COLD_START_MAX_MS}ms`
      : `cold start ${elapsedMs.toFixed(1)}ms exceeded ${COLD_START_MAX_MS}ms`,
  };
}

function hotkeyEvokeGate(): GateResult {
  const intent = new IntentService();
  const shell = new EditorShell(intent);
  shell.evokeNewUntitled();
  const t0 = performance.now();
  shell.handleHotkeyEvoke();
  const elapsedMs = performance.now() - t0;
  const tabs = shell.listTabs().length;
  const ok = elapsedMs <= HOTKEY_EVOKE_MAX_MS && tabs === 2;
  return {
    name: "hotkey_evoke",
    ok,
    elapsedMs,
    detail: ok
      ? `evoke ${elapsedMs.toFixed(1)}ms ≤ ${HOTKEY_EVOKE_MAX_MS}ms; tabs=${tabs}`
      : `hotkey evoke failed or slow (${elapsedMs.toFixed(1)}ms, tabs=${tabs})`,
  };
}

function largeFileGate(): GateResult {
  const intent = new IntentService({
    modelAvailable: true,
    modelGateway: new LocalModelGateway(),
    visibleSampleChars: 4096,
  });
  const shell = new EditorShell(intent);
  shell.handleHotkeyEvoke();

  const t0 = performance.now();
  // Large logical Buffer; Intent must sample Scope, not swallow whole file.
  const chunk = "LINE error ok\n".repeat(
    Math.ceil(LARGE_FILE_CHARS / "LINE error ok\n".length),
  );
  const text = chunk.slice(0, LARGE_FILE_CHARS);
  shell.editActive(text);
  const buf = shell.getActiveBuffer();
  // Measure length via core — do not re-materialize the large body from a snapshot.
  const chars = intent.len(buf.id);
  assertLarge(chars >= LARGE_FILE_CHARS - 16);

  const parsed = intent.parse({
    bufferId: buf.id,
    utterance: "uppercase",
  });
  const elapsedMs = performance.now() - t0;

  const sampled =
    parsed.scope.kind === "visible" && parsed.scope.sampled === true;
  const sampleEnd =
    parsed.scope.kind === "visible" ? parsed.scope.end : -1;
  const ok =
    elapsedMs <= LARGE_FILE_MAX_MS &&
    sampled &&
    sampleEnd === 4096 &&
    sampleEnd < chars;

  return {
    name: "large_file",
    ok,
    elapsedMs,
    detail: ok
      ? `chars=${LARGE_FILE_CHARS}; edit+parse ${elapsedMs.toFixed(1)}ms ≤ ${LARGE_FILE_MAX_MS}ms; scope sampled 0…${sampleEnd}`
      : `large file floor failed (chars=${chars}, elapsed=${elapsedMs.toFixed(1)}ms, sampled=${sampled}, end=${sampleEnd})`,
  };
}

function assertLarge(cond: boolean): void {
  if (!cond) throw new Error("large-file fixture too small");
}

/** Deterministic ~100MB UTF-8 fixture (cached under os.tmpdir). */
export async function ensure100MbFixture(): Promise<string> {
  const override = process.env.NOVA_100MB_FIXTURE;
  if (override && existsSync(override)) {
    const st = statSync(override);
    if (st.size >= FIXTURE_100MB_BYTES - 1024) return override;
  }

  const dir = join(tmpdir(), "nova-wuf102-fixtures");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "fixture-100mb.txt");
  if (existsSync(path)) {
    const st = statSync(path);
    if (st.size >= FIXTURE_100MB_BYTES - 1024) return path;
  }

  // 64-byte lines → predictable size without a giant in-memory string.
  const line = "LINE-0123456789abcdef0123456789abcdef0123456789ab\n";
  const lineBytes = Buffer.byteLength(line, "utf8");
  const lines = Math.ceil(FIXTURE_100MB_BYTES / lineBytes);
  const stream = createWriteStream(path);
  for (let i = 0; i < lines; i++) {
    if (!stream.write(line)) {
      await once(stream, "drain");
    }
  }
  stream.end();
  await once(stream, "finish");
  return path;
}

async function run100MbGates(
  fixturePath: string,
): Promise<[GateResult, GateResult, GateResult]> {
  const intent = new IntentService();
  const shell = new EditorShell(intent);

  const tOpen = performance.now();
  const opened = await shell.openPath(fixturePath);
  // Editable = span edit succeeds without materializing the body in JS.
  shell.editActiveRange(0, 0, "X");
  const openMs = performance.now() - tOpen;
  const chars = intent.len(opened.id);
  const head = intent.slice(opened.id, 0, 1);
  const openOk =
    openMs <= OPEN_100MB_EDITABLE_MAX_MS &&
    chars >= FIXTURE_100MB_BYTES - 1024 &&
    head === "X";
  const openGate: GateResult = {
    name: "open_100mb_editable",
    ok: openOk,
    elapsedMs: openMs,
    detail: openOk
      ? `open+edit ${openMs.toFixed(1)}ms ≤ ${OPEN_100MB_EDITABLE_MAX_MS}ms; chars=${chars}; head=X`
      : `100MB open→editable failed (elapsed=${openMs.toFixed(1)}ms, chars=${chars}, head=${JSON.stringify(head)})`,
  };

  const id = opened.id;
  const mid = Math.floor(intent.len(id) / 2);
  const tType = performance.now();
  shell.editActiveRange(mid, mid, "typed");
  const typeMs = performance.now() - tType;
  // Result assertion — timing alone can pass on a no-op; mid must read back "typed".
  const midSlice = intent.slice(id, mid, mid + "typed".length);
  const typingGate = evaluateTyping100MbGate(typeMs, midSlice);

  const lines = intent.lineCount(id);
  const start = Math.max(0, Math.floor(lines / 2) - 20);
  const tScroll = performance.now();
  const win = intent.lineWindow(id, start, 40);
  const scrollMs = performance.now() - tScroll;
  const scrollOk =
    scrollMs <= SCROLL_100MB_MAX_MS &&
    win.text.length > 0 &&
    win.text.length < FIXTURE_100MB_BYTES / 100;
  const scrollGate: GateResult = {
    name: "scroll_100mb",
    ok: scrollOk,
    elapsedMs: scrollMs,
    detail: scrollOk
      ? `lineWindow mid ${scrollMs.toFixed(1)}ms ≤ ${SCROLL_100MB_MAX_MS}ms; windowChars=${win.text.length}`
      : `scroll budget failed (elapsed=${scrollMs.toFixed(1)}ms, windowChars=${win.text.length})`,
  };

  return [openGate, typingGate, scrollGate];
}

function nativeAddonLoadGate(): GateResult {
  const t0 = performance.now();
  let detail = "";
  let ok = false;
  try {
    const addonPath = resolveNativeAddonPath();
    const id = createUntitled();
    dropBuffer(id);
    // Packaged layout check: sibling of nova-dist must resolve when env points there.
    ok = existsSync(addonPath);
    detail = ok
      ? `addon=${addonPath}`
      : `addon path missing: ${addonPath}`;
  } catch (err) {
    detail = err instanceof Error ? err.message : String(err);
    ok = false;
  }
  const elapsedMs = performance.now() - t0;
  return {
    name: "native_addon_load",
    ok,
    elapsedMs,
    detail: ok
      ? `load+createUntitled ${elapsedMs.toFixed(1)}ms; ${detail}`
      : `native load failed: ${detail}`,
  };
}

/**
 * Verify installer resource layout can resolve the addon the same way as
 * `resources/nova-dist/buffer-core.js` → `../native/buffer-core`.
 */
export function assertPackagedNativeLayout(resourcesRoot: string): boolean {
  const fakeModuleDir = join(resourcesRoot, "nova-dist");
  const addon = resolveNativeAddonPath(fakeModuleDir);
  return existsSync(addon);
}

/**
 * Typing gate verdict: must be within budget **and** mid-buffer must contain
 * the inserted `"typed"`. Timing-only green on a no-op write is a vacuous pass.
 */
export function evaluateTyping100MbGate(
  typeMs: number,
  midSlice: string,
): GateResult {
  const wrote = midSlice === "typed";
  const withinBudget = typeMs <= TYPING_100MB_MAX_MS;
  const ok = wrote && withinBudget;
  let detail: string;
  if (ok) {
    detail = `replaceRange mid ${typeMs.toFixed(1)}ms ≤ ${TYPING_100MB_MAX_MS}ms; mid=${JSON.stringify(midSlice)}`;
  } else if (!wrote) {
    detail = `typing did not write mid content (got ${JSON.stringify(midSlice)}, want "typed")`;
  } else {
    detail = `typing budget exceeded (${typeMs.toFixed(1)}ms > ${TYPING_100MB_MAX_MS}ms); mid ok`;
  }
  return {
    name: "typing_100mb",
    ok,
    elapsedMs: typeMs,
    detail,
  };
}

/** Run Windows floors; safe to invoke from CI on any platform. */
export async function runWindowsGates(): Promise<WindowsGatesReport> {
  const fixturePath = await ensure100MbFixture();
  const [openGate, typingGate, scrollGate] = await run100MbGates(fixturePath);
  const gates: GateResult[] = [
    coldStartGate(),
    hotkeyEvokeGate(),
    largeFileGate(),
    openGate,
    typingGate,
    scrollGate,
    nativeAddonLoadGate(),
  ];
  return {
    ok: gates.every((g) => g.ok),
    gates,
    usedWorkspaceNoun: false,
    usedProjectNoun: false,
  };
}
