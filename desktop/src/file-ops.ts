/**
 * Open / Save / Save As orchestration over an injectable PathPicker.
 * Cancel (picker returns null) never calls the Buffer port.
 */
import type { PathPicker } from "./path-picker.ts";
import { chooseSaveAction, type PathToolbarTab } from "./path-toolbar.ts";

export type FileOpsTab = PathToolbarTab;

/** Thin port the desktop shell implements over Tauri / IPC. */
export type FileOpsPort = {
  getActiveTab(): Promise<FileOpsTab | undefined>;
  openPath(path: string): Promise<void>;
  saveActive(): Promise<void>;
  saveActiveAs(path: string): Promise<void>;
};

export type FileOpsOutcome =
  | { kind: "cancelled" }
  | { kind: "no_active" }
  | { kind: "opened"; path: string }
  | { kind: "saved"; path: string }
  | { kind: "saved_as"; path: string };

export async function openWithPicker(
  picker: PathPicker,
  port: FileOpsPort,
): Promise<FileOpsOutcome> {
  const path = await picker.open();
  if (path == null) return { kind: "cancelled" };
  await port.openPath(path);
  return { kind: "opened", path };
}

export async function saveAsWithPicker(
  picker: PathPicker,
  port: FileOpsPort,
): Promise<FileOpsOutcome> {
  const active = await port.getActiveTab();
  if (!active) return { kind: "no_active" };
  const path = await picker.saveAs(active.path ?? undefined);
  if (path == null) return { kind: "cancelled" };
  await port.saveActiveAs(path);
  return { kind: "saved_as", path };
}

/**
 * Save: Path-bound Buffer writes back; untitled (or unbound) runs Save As.
 */
export async function saveWithPicker(
  picker: PathPicker,
  port: FileOpsPort,
): Promise<FileOpsOutcome> {
  const active = await port.getActiveTab();
  if (!active) return { kind: "no_active" };
  if (chooseSaveAction(active) === "save") {
    await port.saveActive();
    return { kind: "saved", path: active.path! };
  }
  return saveAsWithPicker(picker, port);
}
