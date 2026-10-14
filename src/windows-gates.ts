/**
 * Windows-first capability floors for M2 (ADR-0004 / WUF-79).
 * Runnable on any Node host; Windows is the gated release target.
 * Floors cover cold start, hotkey evoke, and large-file Scope sampling.
 */
import { EditorShell } from "./editor-shell.js";
import { IntentService } from "./intent-service.js";
import { LocalModelGateway } from "./model-gateway.js";

/** Logical size used for the large-file floor (~2 MiB of ASCII). */
export const LARGE_FILE_CHARS = 2 * 1024 * 1024;

/** Soft ceilings — contract floors, not UI frame budgets. */
export const COLD_START_MAX_MS = 500;
export const HOTKEY_EVOKE_MAX_MS = 50;
export const LARGE_FILE_MAX_MS = 3000;

export interface GateResult {
  name: "cold_start" | "hotkey_evoke" | "large_file";
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
  assertLarge(buf.text.length >= LARGE_FILE_CHARS - 16);

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
    sampleEnd < buf.text.length;

  return {
    name: "large_file",
    ok,
    elapsedMs,
    detail: ok
      ? `chars=${LARGE_FILE_CHARS}; edit+parse ${elapsedMs.toFixed(1)}ms ≤ ${LARGE_FILE_MAX_MS}ms; scope sampled 0…${sampleEnd}`
      : `large file floor failed (chars=${buf.text.length}, elapsed=${elapsedMs.toFixed(1)}ms, sampled=${sampled}, end=${sampleEnd})`,
  };
}

function assertLarge(cond: boolean): void {
  if (!cond) throw new Error("large-file fixture too small");
}

/** Run Windows M2 floors; safe to invoke from CI on any platform. */
export function runWindowsGates(): WindowsGatesReport {
  const gates: GateResult[] = [
    coldStartGate(),
    hotkeyEvokeGate(),
    largeFileGate(),
  ];
  return {
    ok: gates.every((g) => g.ok),
    gates,
    usedWorkspaceNoun: false,
    usedProjectNoun: false,
  };
}
