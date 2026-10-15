/**
 * Format Patch edits as a simple unified-style diff for the Intent preview UI.
 */
import type { Patch } from "../types.js";

function linePrefixed(prefix: string, text: string): string {
  if (text.length === 0) return `${prefix}`;
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** Render all edits in a Patch batch against Buffer text (right-to-left safe display). */
export function formatPatchDiff(bufferText: string, patches: Patch[]): string {
  const chunks: string[] = [];
  const edits = patches.flatMap((p) => p.edits);
  const ordered = [...edits].sort((a, b) => a.start - b.start);

  for (const edit of ordered) {
    const before = bufferText.slice(edit.start, edit.end);
    const after = edit.replacement;
    chunks.push(`@@ ${edit.start},${edit.end} @@`);
    if (before.length > 0) chunks.push(linePrefixed("-", before));
    if (after.length > 0) chunks.push(linePrefixed("+", after));
  }

  return chunks.join("\n");
}
