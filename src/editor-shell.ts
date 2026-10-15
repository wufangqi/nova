import { open as fsOpen, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { decodeBytes, encodeText } from "./encoding.js";
import { IntentService } from "./intent-service.js";
import type { BufferId, BufferSnapshot } from "./types.js";

/**
 * Desktop textarea path still needs the whole body in JS until callers move to
 * slice/lineWindow. Call sites here opt in explicitly — never rely on
 * IntentService defaulting to full text.
 */
const SHELL_FULL_TEXT = { includeText: true } as const;

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
  /** Revision at last save / open — dirty when core rev differs (no full-text compare). */
  savedRev: number;
  savedEncoding: string;
  savedEol: BufferSnapshot["eol"];
  savedBom: boolean;
}

/**
 * Notepad-like shell: open Buffers as tabs, hotkey evoke, Path open/save, close prompts.
 * No Workspace / Project / Session noun — just a list of open Buffers.
 * Path IO respects Buffer Encoding / EOL / BOM metadata (WUF-73).
 * UTF-8 without BOM opens via Rust core (no JS body); other encodings decode in JS.
 */
export class EditorShell {
  private readonly intent: IntentService;
  private readonly tabs = new Map<BufferId, TabState>();
  private readonly order: BufferId[] = [];
  private activeId: BufferId | null = null;

  constructor(intent?: IntentService) {
    this.intent = intent ?? new IntentService();
  }

  /** Test / gate access to the IntentService behind this shell. */
  intentService(): IntentService {
    return this.intent;
  }

  get activeBufferId(): BufferId | null {
    return this.activeId;
  }

  /** Global hotkey handler: always spawn a new untitled Buffer; keep existing tabs. */
  evokeNewUntitled(): BufferSnapshot {
    const buf = this.intent.createBuffer("", {}, SHELL_FULL_TEXT);
    this.registerTab(buf, null);
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
    return this.intent.getBuffer(this.activeId, SHELL_FULL_TEXT);
  }

  activateTab(bufferId: BufferId): void {
    this.requireTab(bufferId);
    this.activeId = bufferId;
  }

  editActive(text: string): BufferSnapshot {
    if (!this.activeId) throw new Error("no active Buffer");
    return this.intent.editBuffer(this.activeId, text, SHELL_FULL_TEXT);
  }

  /** Span edit on the active Buffer (virtual-scroll / large-file typing path). */
  editActiveRange(
    start: number,
    end: number,
    replacement: string,
  ): BufferSnapshot {
    if (!this.activeId) throw new Error("no active Buffer");
    return this.intent.editBufferRange(this.activeId, start, end, replacement);
  }

  editBuffer(bufferId: BufferId, text: string): BufferSnapshot {
    this.requireTab(bufferId);
    return this.intent.editBuffer(bufferId, text, SHELL_FULL_TEXT);
  }

  /**
   * Open a Path. UTF-8 without BOM → Rust core (JS never holds the body).
   * BOM / non-UTF-8 → decode in JS then createBuffer (Encoding contract path).
   */
  async openPath(path: string): Promise<BufferSnapshot> {
    if (await shouldOpenViaCore(path)) {
      try {
        const buf = this.intent.openPath(path);
        this.registerTab(buf, path);
        return buf;
      } catch {
        // Invalid UTF-8 (e.g. GBK) → Encoding decode path below.
      }
    }

    const bytes = await readFile(path);
    const decoded = decodeBytes(bytes);
    const buf = this.intent.createBuffer(
      decoded.text,
      {
        encoding: decoded.encoding,
        eol: decoded.eol,
        bom: decoded.bom,
      },
      SHELL_FULL_TEXT,
    );
    this.registerTab(buf, path);
    return buf;
  }

  private registerTab(buf: BufferSnapshot, path: string | null): void {
    this.tabs.set(buf.id, {
      bufferId: buf.id,
      path,
      savedRev: this.intent.rev(buf.id),
      savedEncoding: buf.encoding,
      savedEol: buf.eol,
      savedBom: buf.bom,
    });
    this.order.push(buf.id);
    this.activeId = buf.id;
  }

  async saveActive(): Promise<void> {
    if (!this.activeId) throw new Error("no active Buffer");
    const tab = this.requireTab(this.activeId);
    if (!tab.path) {
      throw new Error("untitled Buffer has no Path; use saveActiveAs");
    }
    await this.writeBufferToPath(this.activeId, tab.path);
    this.markSaved(this.activeId);
  }

  async saveActiveAs(path: string): Promise<void> {
    if (!this.activeId) throw new Error("no active Buffer");
    this.requireTab(this.activeId);
    await this.writeBufferToPath(this.activeId, path);
    const tab = this.requireTab(this.activeId);
    tab.path = path;
    this.markSaved(this.activeId);
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

  private async writeBufferToPath(
    bufferId: BufferId,
    path: string,
  ): Promise<void> {
    const meta = this.intent.getBuffer(bufferId);
    // UTF-8 / LF / no BOM: write from the core without materializing in JS.
    if (
      meta.encoding === "utf-8" &&
      meta.eol === "lf" &&
      meta.bom === false
    ) {
      this.intent.savePath(bufferId, path);
      return;
    }
    const buf = this.intent.getBuffer(bufferId, SHELL_FULL_TEXT);
    const bytes = encodeText(buf.text ?? "", buf.encoding, buf.eol, {
      bom: buf.bom,
    });
    await writeFile(path, bytes);
  }

  private markSaved(bufferId: BufferId): void {
    const tab = this.requireTab(bufferId);
    const buf = this.intent.getBuffer(bufferId);
    tab.savedRev = this.intent.rev(bufferId);
    tab.savedEncoding = buf.encoding;
    tab.savedEol = buf.eol;
    tab.savedBom = buf.bom;
  }

  private isDirty(bufferId: BufferId): boolean {
    const tab = this.requireTab(bufferId);
    const buf = this.intent.getBuffer(bufferId);
    return (
      this.intent.rev(bufferId) !== tab.savedRev ||
      buf.encoding !== tab.savedEncoding ||
      buf.eol !== tab.savedEol ||
      buf.bom !== tab.savedBom
    );
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
    const title = untitled ? "Untitled" : basename(tab.path!);
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

/** True when the Path can open via Rust core (UTF-8, no BOM). */
async function shouldOpenViaCore(path: string): Promise<boolean> {
  const fh = await fsOpen(path, "r");
  try {
    const head = Buffer.alloc(3);
    const { bytesRead } = await fh.read(head, 0, 3, 0);
    if (bytesRead >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
      return false; // UTF-8 BOM — keep Encoding metadata path
    }
    if (bytesRead >= 2 && head[0] === 0xff && head[1] === 0xfe) return false;
    if (bytesRead >= 2 && head[0] === 0xfe && head[1] === 0xff) return false;
    return true;
  } finally {
    await fh.close();
  }
}
