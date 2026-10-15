/**
 * JS facade over the Rust Buffer core (napi-rs).
 * Expand-phase: IntentService may still hold TS full text in parallel;
 * callers that need slice/window semantics should use this module.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface LineWindow {
  text: string;
  startOffset: number;
}

type Binding = {
  createUntitled(): string;
  openPath(path: string): string;
  save(bufferId: string, path?: string | null): void;
  len(bufferId: string): number;
  rev(bufferId: string): number;
  slice(bufferId: string, start: number, end: number): string;
  lineWindow(
    bufferId: string,
    lineStart: number,
    lineCount: number,
  ): LineWindow;
  dropBuffer(bufferId: string): void;
};

const require = createRequire(import.meta.url);

function resolveAddon(nativeDir: string): string {
  const candidates = [
    join(nativeDir, "nova-buffer-core.win32-x64-msvc.node"),
    join(nativeDir, "nova-buffer-core.win32-arm64-msvc.node"),
    join(nativeDir, "nova-buffer-core.darwin-x64.node"),
    join(nativeDir, "nova-buffer-core.darwin-arm64.node"),
    join(nativeDir, "nova-buffer-core.linux-x64-gnu.node"),
    join(nativeDir, "nova-buffer-core.linux-arm64-gnu.node"),
    join(nativeDir, "nova-buffer-core.node"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    "nova-buffer-core native addon not found; run `npm run build:native` from the repo root",
  );
}

function loadBinding(): Binding {
  const here = dirname(fileURLToPath(import.meta.url));
  const nativeDir = join(here, "..", "native", "buffer-core");
  return require(resolveAddon(nativeDir)) as Binding;
}

const binding = loadBinding();

export const createUntitled = binding.createUntitled.bind(binding);
export const openPath = binding.openPath.bind(binding);
export const save = binding.save.bind(binding);
export const len = binding.len.bind(binding);
export const rev = binding.rev.bind(binding);
export const slice = binding.slice.bind(binding);
export const lineWindow = binding.lineWindow.bind(binding);
export const dropBuffer = binding.dropBuffer.bind(binding);
