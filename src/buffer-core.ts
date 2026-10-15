/**
 * JS facade over the Rust Buffer core (napi-rs).
 * Logical text, revision, and Accept UndoGroups live in the core.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LineWindow {
  text: string;
  startOffset: number;
}

export interface CoreTextEdit {
  start: number;
  end: number;
  replacement: string;
  before?: string | null;
  after?: string | null;
}

export interface CorePatch {
  baseRevision: number;
  edits: CoreTextEdit[];
}

export type ApplyAcceptResult =
  | { ok: true; rev: number; undoGroupId: string }
  | { ok: false; reason: "reloc_failed" | "stale" | "invalid" };

export interface UndoResult {
  ok: boolean;
}

export interface FindQuery {
  pattern: string;
  /** Flag chars: `i` / `m` / `s`. */
  flags?: string | null;
  start?: number | null;
  end?: number | null;
  maxMatches?: number | null;
}

export interface FindCapture {
  index: number;
  text: string;
}

export interface FindHitCore {
  start: number;
  end: number;
  matchText: string;
  /** 0-based line index. */
  line: number;
  /** 0-based character column. */
  column: number;
  captures: FindCapture[];
}

export interface FindProgress {
  status: "running" | "done" | "cancelled" | "error" | string;
  hits: FindHitCore[];
  count: number;
  error?: string | null;
}

type Binding = {
  createUntitled(): string;
  createBuffer(text: string): string;
  setText(bufferId: string, text: string): number;
  replaceRange(
    bufferId: string,
    start: number,
    end: number,
    replacement: string,
  ): number;
  bumpRev(bufferId: string): number;
  openPath(path: string): string;
  save(bufferId: string, path?: string | null): void;
  len(bufferId: string): number;
  rev(bufferId: string): number;
  lineCount(bufferId: string): number;
  slice(bufferId: string, start: number, end: number): string;
  lineWindow(
    bufferId: string,
    lineStart: number,
    lineCount: number,
  ): LineWindow;
  dropBuffer(bufferId: string): void;
  applyAccept(
    bufferId: string,
    patches: Array<{
      baseRevision: number;
      edits: CoreTextEdit[];
    }>,
  ): {
    ok: boolean;
    reason?: string | null;
    rev?: number | null;
    undoGroupId?: string | null;
  };
  undo(bufferId: string, undoGroupId: string): UndoResult;
  findStart(bufferId: string, query: FindQuery): string;
  findPoll(jobId: string): FindProgress;
  findCancel(jobId: string): void;
};

const require = createRequire(import.meta.url);

const ADDON_NAMES = [
  "nova-buffer-core.win32-x64-msvc.node",
  "nova-buffer-core.win32-arm64-msvc.node",
  "nova-buffer-core.darwin-x64.node",
  "nova-buffer-core.darwin-arm64.node",
  "nova-buffer-core.linux-x64-gnu.node",
  "nova-buffer-core.linux-arm64-gnu.node",
  "nova-buffer-core.node",
] as const;

function resolveAddonInDir(nativeDir: string): string | null {
  for (const name of ADDON_NAMES) {
    const path = join(nativeDir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/** Search dirs: env override, repo/dev (`../native`), packaged beside dist (`../native` from nova-dist). */
export function nativeAddonSearchDirs(fromModuleDir?: string): string[] {
  const here =
    fromModuleDir ?? dirname(fileURLToPath(import.meta.url));
  const dirs: string[] = [];
  const envDir = process.env.NOVA_BUFFER_CORE_DIR;
  if (envDir) dirs.push(envDir);
  // dist/buffer-core.js → ../native/buffer-core
  // resources/nova-dist/buffer-core.js → ../native/buffer-core (installer layout)
  dirs.push(join(here, "..", "native", "buffer-core"));
  dirs.push(join(here, "native", "buffer-core"));
  return dirs;
}

/** Absolute path to the loaded `.node` addon, or throw with search dirs listed. */
export function resolveNativeAddonPath(fromModuleDir?: string): string {
  const dirs = nativeAddonSearchDirs(fromModuleDir);
  for (const dir of dirs) {
    const hit = resolveAddonInDir(dir);
    if (hit) return hit;
  }
  throw new Error(
    `nova-buffer-core native addon not found; searched: ${dirs.join(", ")}; run \`npm run build:native\` from the repo root`,
  );
}

function loadBinding(): Binding {
  return require(resolveNativeAddonPath()) as Binding;
}

const binding = loadBinding();

export const createUntitled = binding.createUntitled.bind(binding);
export const createBuffer = binding.createBuffer.bind(binding);
export const setText = binding.setText.bind(binding);
export const replaceRange = binding.replaceRange.bind(binding);
export const bumpRev = binding.bumpRev.bind(binding);
export const openPath = binding.openPath.bind(binding);
export const save = binding.save.bind(binding);
export const len = binding.len.bind(binding);
export const rev = binding.rev.bind(binding);
export const lineCount = binding.lineCount.bind(binding);
export const slice = binding.slice.bind(binding);
export const lineWindow = binding.lineWindow.bind(binding);
export const dropBuffer = binding.dropBuffer.bind(binding);

export function applyAccept(
  bufferId: string,
  patches: CorePatch[],
): ApplyAcceptResult {
  const raw = binding.applyAccept(bufferId, patches);
  if (!raw.ok) {
    const reason = raw.reason;
    if (reason === "reloc_failed" || reason === "stale" || reason === "invalid") {
      return { ok: false, reason };
    }
    return { ok: false, reason: "invalid" };
  }
  return {
    ok: true,
    rev: raw.rev!,
    undoGroupId: raw.undoGroupId!,
  };
}

export function undo(bufferId: string, undoGroupId: string): UndoResult {
  return binding.undo(bufferId, undoGroupId);
}

export function findStart(bufferId: string, query: FindQuery): string {
  return binding.findStart(bufferId, query);
}

export function findPoll(jobId: string): FindProgress {
  return binding.findPoll(jobId);
}

export function findCancel(jobId: string): void {
  binding.findCancel(jobId);
}

/** Poll until Find reaches a terminal status (`done` | `cancelled` | `error`). */
export function findAwait(
  jobId: string,
  maxPolls = 1_000_000,
): FindProgress {
  for (let i = 0; i < maxPolls; i++) {
    const progress = findPoll(jobId);
    if (progress.status !== "running") return progress;
  }
  throw new Error(`find job ${jobId} still running after ${maxPolls} polls`);
}
