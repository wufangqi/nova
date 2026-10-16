/**
 * Injectable RecoveryBuffer store — install-local, not a user-facing draft box.
 * Desktop host / contracts inject a profile or temp directory.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORE_FILE = "recovery.json";

/** One dirty Buffer snapshot eligible for cross-launch restore. */
export type RecoverableBuffer = {
  bufferId: string;
  text: string;
  /** Bound Path when the Buffer had one; null for untitled. */
  path: string | null;
};

export interface RecoveryStore {
  /** Replace the recovery layer with the current dirty set (quit snapshot). */
  saveAll(dirty: RecoverableBuffer[]): Promise<void>;
  loadAll(): Promise<RecoverableBuffer[]>;
  /** Drop one Buffer from recovery (tab Don’t save, or after a successful Save). */
  drop(bufferId: string): Promise<void>;
}

function normalize(row: unknown): RecoverableBuffer | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.bufferId !== "string") return null;
  if (typeof r.text !== "string") return null;
  if (r.path !== null && typeof r.path !== "string") return null;
  return {
    bufferId: r.bufferId,
    text: r.text,
    path: r.path as string | null,
  };
}

/** In-memory store for unit contracts. */
export function createMemoryRecoveryStore(): RecoveryStore {
  let entries: RecoverableBuffer[] = [];
  return {
    async saveAll(dirty) {
      entries = dirty.map((e) => ({ ...e }));
    },
    async loadAll() {
      return entries.map((e) => ({ ...e }));
    },
    async drop(bufferId) {
      entries = entries.filter((e) => e.bufferId !== bufferId);
    },
  };
}

/**
 * Directory-backed store. Same directory across process/shell instances =
 * fake relaunch for contracts (exact OS profile path is not asserted).
 */
export function createFileRecoveryStore(dir: string): RecoveryStore {
  const file = join(dir, STORE_FILE);

  async function readEntries(): Promise<RecoverableBuffer[]> {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalize).filter(Boolean) as RecoverableBuffer[];
    } catch {
      return [];
    }
  }

  async function writeEntries(entries: RecoverableBuffer[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      file,
      JSON.stringify(
        entries.map((e) => ({
          bufferId: e.bufferId,
          text: e.text,
          path: e.path,
        })),
        null,
        2,
      ),
      "utf8",
    );
  }

  return {
    async saveAll(dirty) {
      await writeEntries(dirty.map((e) => ({ ...e })));
    },
    async loadAll() {
      return readEntries();
    },
    async drop(bufferId) {
      const next = (await readEntries()).filter((e) => e.bufferId !== bufferId);
      await writeEntries(next);
    },
  };
}
