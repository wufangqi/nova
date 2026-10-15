/**
 * Test helpers: read Buffer body via slice/len — never assume default snapshots
 * carry full text (WUF-99).
 */
import type { IntentService } from "../../src/intent-service.js";
import type { BufferId } from "../../src/types.js";

export function bufferBody(svc: IntentService, id: BufferId): string {
  const n = svc.len(id);
  return n === 0 ? "" : svc.slice(id, 0, n);
}

export function bufferLen(svc: IntentService, id: BufferId): number {
  return svc.len(id);
}
