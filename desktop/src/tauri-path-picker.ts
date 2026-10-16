/**
 * Desktop PathPicker backed by Tauri native open/save dialogs.
 */
import { open, save } from "@tauri-apps/plugin-dialog";
import type { PathPicker } from "./path-picker.ts";

export function createTauriPathPicker(): PathPicker {
  return {
    async open() {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Open",
      });
      if (selected == null) return null;
      return Array.isArray(selected) ? (selected[0] ?? null) : selected;
    },
    async saveAs(defaultPath?: string) {
      const selected = await save({
        title: "Save As",
        defaultPath,
      });
      return selected ?? null;
    },
  };
}
