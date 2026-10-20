/**
 * WUF-121 — Find workbench geometry (pure, injectable).
 *
 * Default center; title-bar drag; clamp so the title bar stays reachable;
 * session memory is owned by FindDialog (in-memory only — never install-level).
 */

export type WorkbenchPoint = {
  leftPx: number;
  topPx: number;
};

export type WorkbenchSize = {
  widthPx: number;
  heightPx: number;
};

export type ClientSize = {
  widthPx: number;
  heightPx: number;
};

/** Minimum visible strip of the dialog (title bar) that must stay in the client. */
export const MIN_VISIBLE_TITLE_BAR_PX = 28;

/** Center the workbench in the application client area. */
export function centerWorkbench(
  client: ClientSize,
  size: WorkbenchSize,
): WorkbenchPoint {
  return {
    leftPx: Math.max(0, Math.round((client.widthPx - size.widthPx) / 2)),
    topPx: Math.max(0, Math.round((client.heightPx - size.heightPx) / 2)),
  };
}

/**
 * Clamp so at least {@link MIN_VISIBLE_TITLE_BAR_PX} of the dialog remains
 * inside the client — the title bar can always be grabbed back.
 */
export function clampWorkbench(
  pos: WorkbenchPoint,
  size: WorkbenchSize,
  client: ClientSize,
  minVisiblePx: number = MIN_VISIBLE_TITLE_BAR_PX,
): WorkbenchPoint {
  const minLeft = minVisiblePx - size.widthPx;
  const maxLeft = client.widthPx - minVisiblePx;
  const minTop = minVisiblePx - size.heightPx;
  const maxTop = client.heightPx - minVisiblePx;
  return {
    leftPx: clampNum(pos.leftPx, minLeft, maxLeft),
    topPx: clampNum(pos.topPx, minTop, maxTop),
  };
}

/** Apply a pointer delta to an origin point (pre-clamp). */
export function applyDrag(
  origin: WorkbenchPoint,
  delta: { dx: number; dy: number },
): WorkbenchPoint {
  return {
    leftPx: origin.leftPx + delta.dx,
    topPx: origin.topPx + delta.dy,
  };
}

function clampNum(n: number, min: number, max: number): number {
  if (max < min) return Math.min(max, Math.max(min, n));
  return Math.min(max, Math.max(min, n));
}
