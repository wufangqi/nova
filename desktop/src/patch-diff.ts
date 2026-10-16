/** Format Patch edits as a simple unified-style diff for the Intent preview panel. */

export type TextEdit = {
  start: number;
  end: number;
  replacement: string;
};

export type Patch = {
  edits: TextEdit[];
};

function linePrefixed(prefix: string, text: string): string {
  if (text.length === 0) return `${prefix}`;
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

/** Sync helper when callers already hold before-slices (or tiny buffers). */
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

/** Diff using per-edit before slices — does not require full Buffer text. */
export async function formatPatchDiffAsync(
  patches: Patch[],
  slice: (start: number, end: number) => Promise<string>,
): Promise<string> {
  const chunks: string[] = [];
  const edits = patches.flatMap((p) => p.edits);
  const ordered = [...edits].sort((a, b) => a.start - b.start);

  for (const edit of ordered) {
    const before =
      edit.start === edit.end ? "" : await slice(edit.start, edit.end);
    const after = edit.replacement;
    chunks.push(`@@ ${edit.start},${edit.end} @@`);
    if (before.length > 0) chunks.push(linePrefixed("-", before));
    if (after.length > 0) chunks.push(linePrefixed("+", after));
  }

  return chunks.join("\n");
}
