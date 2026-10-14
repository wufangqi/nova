import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { IntentService } from "./intent-service.js";
import type { BufferId, BufferSnapshot } from "./types.js";

export interface TabInfo {
  bufferId: BufferId;
  title: string;
  path: string | null;
  untitled: boolean;
  dirty: boolean;
  active: boolean;
}

export type CloseOk = { ok: true; closed: true; asked: boolean };
export type CloseAsk = {
  ok: false;
  reason: "confirm_discard_untitled" | "confirm_discard_dirty";
  bufferId: BufferId;
};
export type CloseResult = CloseOk | CloseAsk;

interface TabState {
  bufferId: BufferId;
  path: string | null;
  /** Last persisted text (empty string for new untitled). */
  savedText: string;
}

/**
 * Notepad-like shell: open Buffers as tabs, hotkey evoke, Path open/save, close prompts.
 * No Workspace / Project / Session noun — just a list of open Buffers.
 */
export class EditorShell {
  private readonly intent: IntentService;
  private readonly tabs = new Map<BufferId, TabState>();
  private readonly order: BufferId[] = [];
  private activeId: BufferId | null = null;

  constructor(intent?: IntentService) {
    this.intent = intent ?? new IntentService();
  }

  get activeBufferId(): BufferId | null {
    return this.activeId;
  }

  /** Global hotkey handler: always spawn a new untitled Buffer; keep existing tabs. */
  evokeNewUntitled(): BufferSnapshot {
    const buf = this.intent.createBuffer("");
    this.tabs.set(buf.id, {
      bufferId: buf.id,
      path: null,
      savedText: "",
    });
    this.order.push(buf.id);
    this.activeId = buf.id;
    return buf;
  }

  /** Alias used by hotkey ports / CLI bindings. */
  handleHotkeyEvoke(): BufferSnapshot {
    return this.evokeNewUntitled();
  }

  listTabs(): TabInfo[] {
    return this.order.map((id) => this.tabInfo(id));
  }

  getTab(bufferId: BufferId): TabInfo {
    this.requireTab(bufferId);
    return this.tabInfo(bufferId);
  }

  getActiveBuffer(): BufferSnapshot {
    if (!this.activeId) throw new Error("no active Buffer");
    return this.intent.getBuffer(this.activeId);
  }

  activateTab(bufferId: BufferId): void {
    this.requireTab(bufferId);
    this.activeId = bufferId;
  }

  editActive(text: string): BufferSnapshot {
    if (!this.activeId) throw new Error("no active Buffer");
    return this.intent.editBuffer(this.activeId, text);
  }

  editBuffer(bufferId: BufferId, text: string): BufferSnapshot {
    this.requireTab(bufferId);
    return this.intent.editBuffer(bufferId, text);
  }

  async openPath(path: string): Promise<BufferSnapshot> {
    const text = await readFile(path, "utf8");
    const buf = this.intent.createBuffer(text);
    this.tabs.set(buf.id, {
      bufferId: buf.id,
      path,
      savedText: text,
    });
    this.order.push(buf.id);
    this.activeId = buf.id;
    return buf;
  }

  async saveActive(): Promise<void> {
    if (!this.activeId) throw new Error("no active Buffer");
    const tab = this.requireTab(this.activeId);
    if (!tab.path) {
      throw new Error("untitled Buffer has no Path; use saveActiveAs");
    }
    const text = this.intent.getBuffer(this.activeId).text;
    await writeFile(tab.path, text, "utf8");
    tab.savedText = text;
  }

  async saveActiveAs(path: string): Promise<void> {
    if (!this.activeId) throw new Error("no active Buffer");
    const tab = this.requireTab(this.activeId);
    const text = this.intent.getBuffer(this.activeId).text;
    await writeFile(path, text, "utf8");
    tab.path = path;
    tab.savedText = text;
  }

  /**
   * Request close. Clean untitled → closes immediately.
   * Dirty untitled (or dirty path-bound) → returns confirm reason; call confirmClose.
   */
  requestClose(bufferId: BufferId): CloseResult {
    const tab = this.requireTab(bufferId);
    const dirty = this.isDirty(bufferId);
    if (!dirty) {
      this.dropTab(bufferId);
      return { ok: true, closed: true, asked: false };
    }
    if (tab.path === null) {
      return {
        ok: false,
        reason: "confirm_discard_untitled",
        bufferId,
      };
    }
    return {
      ok: false,
      reason: "confirm_discard_dirty",
      bufferId,
    };
  }

  /** User confirmed discard of a dirty Buffer. */
  confirmClose(bufferId: BufferId): CloseOk {
    this.requireTab(bufferId);
    this.dropTab(bufferId);
    return { ok: true, closed: true, asked: true };
  }

  private isDirty(bufferId: BufferId): boolean {
    const tab = this.requireTab(bufferId);
    const text = this.intent.getBuffer(bufferId).text;
    return text !== tab.savedText;
  }

  private dropTab(bufferId: BufferId): void {
    this.tabs.delete(bufferId);
    const idx = this.order.indexOf(bufferId);
    if (idx >= 0) this.order.splice(idx, 1);
    if (this.activeId === bufferId) {
      this.activeId =
        this.order[Math.min(idx, this.order.length - 1)] ?? null;
    }
  }

  private requireTab(bufferId: BufferId): TabState {
    const tab = this.tabs.get(bufferId);
    if (!tab) throw new Error(`unknown tab Buffer: ${bufferId}`);
    return tab;
  }

  private tabInfo(bufferId: BufferId): TabInfo {
    const tab = this.requireTab(bufferId);
    const dirty = this.isDirty(bufferId);
    const untitled = tab.path === null;
    const title = untitled
      ? "Untitled"
      : basename(tab.path!);
    return {
      bufferId,
      title: dirty ? `${title}*` : title,
      path: tab.path,
      untitled,
      dirty,
      active: this.activeId === bufferId,
    };
  }
}
