/**
 * WUF-111 / WUF-118 / WUF-119 — editor viewport layout policy at the layout seam.
 *
 * WUF-111 half-width root cause (CSS width chain, not soft-wrap):
 * `.editor-window` is absolutely positioned inside `.editor-viewport`. If that
 * window only gets `left` (no stretch), shrink-to-fit collapses to the
 * textarea's intrinsic cols width (~200px) — a narrow left column with a large
 * blank right. Soft-wrap would only paint inside that narrow box; it is not
 * the cause and must stay off so virtual-scroll `LINE_HEIGHT_PX` stays 1:1
 * with Buffer lines.
 *
 * WUF-118 extends the same seam:
 * - Fixed shell chrome; only `.editor-viewport` scrolls (both axes).
 * - White editor surface fills the middle grid `1fr` (min-height ~16rem floor).
 * - Long unwrapped lines grow content width so the same viewport can scroll
 *   horizontally (`min-width: 100%`, width may exceed the viewport).
 * - Line gutter stays pinned to the viewport left under horizontal scroll
 *   (translateX = scrollLeft); vertical sync remains VirtualEditor scrollTop.
 *
 * WUF-119 extends the same seam again:
 * - Editable surface (textarea + gutter) geometry ≥ viewport `clientHeight`
 *   so visible white area is clickable and gutter paint fills the column.
 * - CSS `min-height: 100%` is fallback only; VirtualEditor applies an explicit
 *   px floor from {@link editorSurfaceMinHeightPx} on bind / sync / resize.
 */

/** Soft wrap stays off after root-cause analysis (see module doc). */
export const EDITOR_SOFT_WRAP_ENABLED = false as const;

/** HTML `wrap` matching {@link EDITOR_SOFT_WRAP_ENABLED}. */
export const EDITOR_TEXTAREA_WRAP_ATTR = "off" as const;

/** CSS `white-space` for the editor surface when soft wrap is off. */
export const EDITOR_WHITE_SPACE = "pre" as const;

/** Product rule: shell chrome stays fixed; only the editor viewport scrolls. */
export const EDITOR_SCROLL_SCOPE = {
  chromeFixed: true,
  /** One viewport handles vertical + horizontal overflow. */
  viewportOverflow: "auto",
} as const;

/** Minimum editor viewport height floor (~16rem) for short windows. */
export const EDITOR_VIEWPORT_MIN_HEIGHT = "16rem" as const;

/**
 * Declarative layout chain the desktop stylesheet must keep.
 * Values are CSS tokens asserted against `styles.css` (no pixel screenshots).
 *
 * Width: `min-width: 100%` prevents the abspos half-column collapse; omitting a
 * fixed `width: 100%` / `right: 0` lets long unwrapped lines grow past the
 * viewport so horizontal scroll can reach them.
 */
export const EDITOR_VIEWPORT_WIDTH_CHAIN = {
  viewport: {
    selector: ".editor-viewport",
    width: "100%",
    minHeight: EDITOR_VIEWPORT_MIN_HEIGHT,
    overflow: "auto",
    height: "100%",
  },
  window: {
    selector: ".editor-window",
    position: "absolute",
    left: "0",
    minWidth: "100%",
    minHeight: "100%",
  },
  editor: {
    selector: ".editor",
    minWidth: "100%",
    minHeight: "100%",
    whiteSpace: EDITOR_WHITE_SPACE,
  },
  gutter: {
    selector: ".line-gutter",
    position: "absolute",
    left: "0",
    /** CSS fallback; VirtualEditor also sets an explicit px floor (WUF-119). */
    minHeight: "100%",
  },
  app: {
    selector: ".app",
    /** Definite height so the middle `1fr` track can fill the window. */
    height: "100vh",
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

/** Layout probe for WUF-118 full-height fill + horizontal reach + gutter pin. */
export type EditorViewportLayoutProbe = {
  /** Middle `1fr` content box height. */
  allocatedHeightPx: number;
  viewportClientHeightPx: number;
  viewportScrollWidthPx: number;
  viewportClientWidthPx: number;
  longLineScrollWidthPx: number;
  /**
   * Gutter's left edge in viewport coordinates after horizontal scroll.
   * Pinned gutter stays ~0.
   */
  gutterOffsetLeftPx: number;
};

/** Full-height fill: viewport client height ≈ allocated 1fr (within tolerance). */
export function viewportFillsAllocatedHeight(
  probe: Pick<
    EditorViewportLayoutProbe,
    "allocatedHeightPx" | "viewportClientHeightPx"
  >,
  tolerancePx = 2,
): boolean {
  const { allocatedHeightPx, viewportClientHeightPx } = probe;
  if (allocatedHeightPx <= 0 || viewportClientHeightPx <= 0) return false;
  return Math.abs(viewportClientHeightPx - allocatedHeightPx) <= tolerancePx;
}

/**
 * Long unwrapped line is horizontally reachable: content/scroll width exceeds
 * the viewport client width (same scroller as vertical virtualization).
 */
export function longLineHorizontallyReachable(
  probe: Pick<
    EditorViewportLayoutProbe,
    "viewportClientWidthPx" | "longLineScrollWidthPx" | "viewportScrollWidthPx"
  >,
): boolean {
  const {
    viewportClientWidthPx,
    longLineScrollWidthPx,
    viewportScrollWidthPx,
  } = probe;
  if (viewportClientWidthPx <= 0) return false;
  const linePastEdge = longLineScrollWidthPx > viewportClientWidthPx;
  const scrollable = viewportScrollWidthPx > viewportClientWidthPx;
  return linePastEdge && scrollable;
}

/** Gutter left edge stays at the viewport left after horizontal scroll. */
export function gutterPinnedLeft(
  probe: Pick<EditorViewportLayoutProbe, "gutterOffsetLeftPx">,
  tolerancePx = 1,
): boolean {
  return Math.abs(probe.gutterOffsetLeftPx) <= tolerancePx;
}

/**
 * Horizontal pin: gutter `translateX` equals viewport `scrollLeft` so numbers
 * stay on the visible left edge while content scrolls.
 */
export function gutterHorizontalPinTranslateX(scrollLeftPx: number): number {
  if (!Number.isFinite(scrollLeftPx) || scrollLeftPx <= 0) return 0;
  return scrollLeftPx;
}

/**
 * Content width the virtual window/textarea should claim so long lines expand
 * the shared viewport's scrollWidth (never below the viewport client width).
 */
export function editorContentWidthPx(
  viewportClientWidthPx: number,
  longestLineScrollWidthPx: number,
): number {
  const vp = Number.isFinite(viewportClientWidthPx)
    ? Math.max(0, viewportClientWidthPx)
    : 0;
  const line = Number.isFinite(longestLineScrollWidthPx)
    ? Math.max(0, longestLineScrollWidthPx)
    : 0;
  return Math.max(vp, line);
}

/**
 * Top+bottom padding on `.editor` / `.line-gutter` (~0.85rem each side).
 * Used when converting rem padding into the surface min-height formula.
 */
export const EDITOR_SURFACE_PAD_TOP_BOTTOM_REM = 0.85 as const;

/** `:root` font-size in `styles.css` — rem → px for surface padding. */
export const EDITOR_ROOT_FONT_SIZE_PX = 14 as const;

/** Vertical padding px matching stylesheet (~0.85rem × 2 at root 14px). */
export function editorSurfaceVerticalPaddingPx(
  rootFontSizePx: number = EDITOR_ROOT_FONT_SIZE_PX,
): number {
  const root =
    Number.isFinite(rootFontSizePx) && rootFontSizePx > 0
      ? rootFontSizePx
      : EDITOR_ROOT_FONT_SIZE_PX;
  return EDITOR_SURFACE_PAD_TOP_BOTTOM_REM * 2 * root;
}

/**
 * Editable surface min-height: at least one viewport tall, or tall enough for
 * the mounted virtual window (line rows + vertical padding).
 */
export function editorSurfaceMinHeightPx(
  viewportClientHeightPx: number,
  mountedLineCount: number,
  lineHeightPx: number,
  verticalPaddingPx: number,
): number {
  const vp = Number.isFinite(viewportClientHeightPx)
    ? Math.max(0, viewportClientHeightPx)
    : 0;
  const lines = Number.isFinite(mountedLineCount)
    ? Math.max(0, mountedLineCount)
    : 0;
  const lh =
    Number.isFinite(lineHeightPx) && lineHeightPx > 0 ? lineHeightPx : 0;
  const pad = Number.isFinite(verticalPaddingPx)
    ? Math.max(0, verticalPaddingPx)
    : 0;
  return Math.max(vp, lines * lh + pad);
}

/** WUF-119 geometry probe — Node-runnable, no screenshots. */
export type EditorSurfaceFillProbe = {
  viewportClientHeightPx: number;
  /** Textarea or editor-window hit-box height. */
  surfaceHeightPx: number;
  gutterHeightPx: number;
  /** Click in viewport client coords (typically mid-lower white area). */
  clickInViewport: { x: number; y: number };
  /** Whether that click lands on the textarea hit box. */
  hitTargetIsTextarea: boolean;
};

/** Surface (textarea / window) height covers the viewport client height. */
export function surfaceFillsViewportClientHeight(
  probe: Pick<
    EditorSurfaceFillProbe,
    "viewportClientHeightPx" | "surfaceHeightPx"
  >,
  tolerancePx = 1,
): boolean {
  const { viewportClientHeightPx, surfaceHeightPx } = probe;
  if (viewportClientHeightPx <= 0 || surfaceHeightPx <= 0) return false;
  return surfaceHeightPx + tolerancePx >= viewportClientHeightPx;
}

/** Gutter column height covers the viewport client height. */
export function gutterFillsViewportClientHeight(
  probe: Pick<
    EditorSurfaceFillProbe,
    "viewportClientHeightPx" | "gutterHeightPx"
  >,
  tolerancePx = 1,
): boolean {
  const { viewportClientHeightPx, gutterHeightPx } = probe;
  if (viewportClientHeightPx <= 0 || gutterHeightPx <= 0) return false;
  return gutterHeightPx + tolerancePx >= viewportClientHeightPx;
}

/**
 * Pure hit test: click is inside a filled surface rect anchored at viewport
 * origin (0,0) with the given size — models “white area is the textarea”.
 */
export function clickHitsFilledSurface(
  click: { x: number; y: number },
  surface: { widthPx: number; heightPx: number },
): boolean {
  if (surface.widthPx <= 0 || surface.heightPx <= 0) return false;
  return (
    click.x >= 0 &&
    click.y >= 0 &&
    click.x < surface.widthPx &&
    click.y < surface.heightPx
  );
}

/**
 * Build a fill probe from measured geometry. Derives `hitTargetIsTextarea`
 * from whether the click sits inside the surface hit box (Node-safe).
 */
export function probeEditorSurfaceFill(input: {
  viewportClientHeightPx: number;
  viewportClientWidthPx: number;
  surfaceHeightPx: number;
  gutterHeightPx: number;
  clickInViewport: { x: number; y: number };
}): EditorSurfaceFillProbe {
  const hitTargetIsTextarea = clickHitsFilledSurface(input.clickInViewport, {
    widthPx: input.viewportClientWidthPx,
    heightPx: input.surfaceHeightPx,
  });
  return {
    viewportClientHeightPx: input.viewportClientHeightPx,
    surfaceHeightPx: input.surfaceHeightPx,
    gutterHeightPx: input.gutterHeightPx,
    clickInViewport: input.clickInViewport,
    hitTargetIsTextarea,
  };
}

/** All WUF-119 surface-fill checks hold for the probe. */
export function editorSurfaceFillHolds(
  probe: EditorSurfaceFillProbe,
  tolerancePx = 1,
): boolean {
  return (
    surfaceFillsViewportClientHeight(probe, tolerancePx) &&
    gutterFillsViewportClientHeight(probe, tolerancePx) &&
    probe.hitTargetIsTextarea
  );
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
  if (win["min-width"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.minWidth) {
    throw new Error(".editor-window min-width must be 100%");
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

/** WUF-118: full-height fill, dual-axis overflow, gutter pin base, app height. */
export function assertEditorViewportScrollCss(css: string): void {
  assertEditorViewportWidthCss(css);

  const vp = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.selector);
  const win = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.window.selector);
  const ed = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.editor.selector);
  const gutter = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.gutter.selector);
  const app = cssRuleDeclarations(css, EDITOR_VIEWPORT_WIDTH_CHAIN.app.selector);

  if (vp["min-height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.minHeight) {
    throw new Error(
      `.editor-viewport min-height must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.minHeight}`,
    );
  }
  if (vp["overflow"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.overflow) {
    throw new Error(
      `.editor-viewport overflow must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.overflow}`,
    );
  }
  if (vp["height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.height) {
    throw new Error(
      `.editor-viewport height must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.viewport.height}`,
    );
  }
  if (win["min-height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.window.minHeight) {
    throw new Error(".editor-window min-height must be 100%");
  }
  if (ed["min-height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.editor.minHeight) {
    throw new Error(".editor min-height must be 100%");
  }
  if (gutter["position"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.gutter.position) {
    throw new Error(".line-gutter must be position: absolute");
  }
  if (gutter["left"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.gutter.left) {
    throw new Error(".line-gutter left must be 0 (pin base)");
  }
  if (gutter["min-height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.gutter.minHeight) {
    throw new Error(".line-gutter min-height must be 100% (surface-fill fallback)");
  }
  if (app["height"] !== EDITOR_VIEWPORT_WIDTH_CHAIN.app.height) {
    throw new Error(
      `.app height must be ${EDITOR_VIEWPORT_WIDTH_CHAIN.app.height} so the middle 1fr can fill`,
    );
  }
  // Fixed-width stretch would block horizontal growth past the viewport.
  if (win["right"] === "0" && win["width"] === "100%") {
    throw new Error(
      ".editor-window must not pin both right:0 and width:100% (blocks horizontal scroll growth)",
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
