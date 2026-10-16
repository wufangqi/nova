/**
 * WUF-111 — editor viewport width / soft-wrap policy at the layout seam.
 *
 * Half-width root cause (CSS width chain, not soft-wrap):
 * `.editor-window` is absolutely positioned inside `.editor-viewport`. If that
 * window only gets `left` (no `right` / `width: 100%`), shrink-to-fit collapses
 * to the textarea's intrinsic cols width (~200px) — a narrow left column with
 * a large blank right. Soft-wrap would only paint inside that narrow box; it
 * is not the cause and must stay off so virtual-scroll `LINE_HEIGHT_PX` stays
 * 1:1 with Buffer lines.
 */

/** Soft wrap stays off after root-cause analysis (see module doc). */
export const EDITOR_SOFT_WRAP_ENABLED = false as const;

/** HTML `wrap` matching {@link EDITOR_SOFT_WRAP_ENABLED}. */
export const EDITOR_TEXTAREA_WRAP_ATTR = "off" as const;

/** CSS `white-space` for the editor surface when soft wrap is off. */
export const EDITOR_WHITE_SPACE = "pre" as const;

/**
 * Declarative width chain the desktop stylesheet must keep.
 * Values are CSS tokens asserted against `styles.css` (no pixel screenshots).
 */
export const EDITOR_VIEWPORT_WIDTH_CHAIN = {
  viewport: {
    selector: ".editor-viewport",
    width: "100%",
  },
  window: {
    selector: ".editor-window",
    position: "absolute",
    left: "0",
    right: "0",
    width: "100%",
    minWidth: "100%",
  },
  editor: {
    selector: ".editor",
    width: "100%",
    minWidth: "100%",
    whiteSpace: EDITOR_WHITE_SPACE,
  },
} as const;

/**
 * Content box must fill the editor viewport (no half-column).
 * Pure geometry — usable from headless contracts without a real WebView.
 */
export function editorContentBoxWidthPx(viewportWidthPx: number): number {
  if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) {
    return 0;
  }
  return viewportWidthPx;
}

export type EditorWidthProbe = {
  viewportWidthPx: number;
  contentBoxWidthPx: number;
  /** scrollWidth of a single long unwrapped line (or equivalent). */
  longLineScrollWidthPx: number;
};

/**
 * Wide viewport + long unwrapped line: content box fills the viewport, and the
 * line's laid-out width reaches past the horizontal midpoint (uses the right half).
 */
export function longUnwrappedLineUsesRightHalf(probe: EditorWidthProbe): boolean {
  const { viewportWidthPx, contentBoxWidthPx, longLineScrollWidthPx } = probe;
  if (viewportWidthPx <= 0) return false;
  const fillsViewport = contentBoxWidthPx >= viewportWidthPx * 0.95;
  const reachesRightHalf = longLineScrollWidthPx > viewportWidthPx * 0.5;
  return fillsViewport && reachesRightHalf;
}

/** True when an abspos window has collapsed to intrinsic textarea-ish width. */
export function isCollapsedHalfWidthColumn(probe: {
  viewportWidthPx: number;
  contentBoxWidthPx: number;
}): boolean {
  if (probe.viewportWidthPx <= 0) return false;
  return probe.contentBoxWidthPx < probe.viewportWidthPx * 0.5;
}

type Decl = Record<string, string>;

/**
 * Extract a flat property map for the first rule block of `selector` in CSS text.
 * Enough for contract checks; not a full CSS parser.
 */
export function cssRuleDeclarations(css: string, selector: string): Decl {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
  const match = withoutComments.match(re);
  if (!match) return {};
  const body = match[1] ?? "";
  const out: Decl = {};
  for (const part of body.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const prop = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    out[prop] = value;
  }
  return out;
}

export function assertEditorViewportWidthCss(css: string): void {
  const vp = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.selector);
  const win = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.window.selector);
  const ed = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.editor.selector);

  if (vp["width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.width) {
    throw new Error(
      `.editor-viewport width must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.width}`,
    );
  }
  if (win["position"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.position) {
    throw new Error(".editor-window must be position: absolute");
  }
  if (win["left"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.left) {
    throw new Error(".editor-window left must be 0");
  }
  if (win["right"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.right) {
    throw new Error(".editor-window right must be 0");
  }
  if (win["width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.width) {
    throw new Error(".editor-window width must be 100% (stretch past intrinsic cols)");
  }
  if (win["min-width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.minWidth) {
    throw new Error(".editor-window min-width must be 100%");
  }
  if (ed["width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.editor.width) {
    throw new Error(".editor width must be 100%");
  }
  if (ed["min-width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.editor.minWidth) {
    throw new Error(".editor min-width must be 100%");
  }
  if (ed["white-space"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.editor.whiteSpace) {
    throw new Error(
      `.editor white-space must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.editor.whiteSpace} (soft wrap off)`,
    );
  }
}

/** Require textarea markup to pin wrap=off so HTML matches the CSS policy. */
export function assertEditorTextareaWrapAttr(html: string): void {
  const re =
    /<textarea\b[^>]*\bid\s*=\s*["']editor["'][^>]*>|<textarea\b[^>]*\bclass\s*=\s*["'][^"']*\beditor\b[^"']*["'][^>]*>/i;
  const tag = html.match(re)?.[0];
  if (!tag) {
    throw new Error("editor textarea markup not found");
  }
  if (!/\bwrap\s*=\s*["']off["']/i.test(tag)) {
    throw new Error(`editor textarea must set wrap="${EDITOR_TEXTAREA_WRAP_ATTR}"`);
  }
}
