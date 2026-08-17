export type MathPreviewPlacement =
  | "autoBelow"
  | "autoAbove"
  | "above"
  | "below";
export type MathPreviewSide = "above" | "below";

export interface MathPreviewLayoutPoint {
  readonly line: number;
  readonly character: number;
}

export interface MathPreviewVisibleLineRange {
  readonly startLine: number;
  readonly endLine: number;
}

export interface MathPreviewLayoutRequest {
  readonly mode: "inline" | "block";
  readonly formulaStart: MathPreviewLayoutPoint;
  readonly formulaEnd: MathPreviewLayoutPoint;
  readonly cursorLine: number;
  /** First non-whitespace source character on the active cursor line. */
  readonly cursorLineStartCharacter: number;
  readonly visibleRanges: readonly MathPreviewVisibleLineRange[];
  readonly previewHeightEm: number;
  readonly fontSizePx: number;
  readonly lineHeightPx: number;
  readonly placement: MathPreviewPlacement;
}

export interface MathPreviewLayoutPlan {
  readonly side: MathPreviewSide;
  readonly anchor: MathPreviewLayoutPoint;
  readonly requiredVisibleLines: number;
  readonly hostTextDecoration: string;
  readonly attachmentTextDecoration: string;
}

/** Normalize the public setting while preserving the pre-0.8.12 `auto`
 * spelling as the below-first behavior. */
export function normalizeMathPreviewPlacement(
  value: string,
): MathPreviewPlacement {
  return value === "autoBelow" ||
      value === "autoAbove" ||
      value === "above" ||
      value === "below"
    ? value
    : "autoBelow";
}

const PREVIEW_GAP_EM = 0.35;
const DEFAULT_FONT_SIZE_PX = 14;
const DEFAULT_LINE_HEIGHT_MULTIPLIER = 1.5;
const OVERFLOW_SOURCE_TAIL_LINES = 3;
const OVERFLOW_PREVIEW_TAIL_LINES = 2;

// VS Code has no public editor view-zone API. These fixed strings form a
// deliberately narrow Monaco compatibility layer: no user text, URL, color,
// or arbitrary CSS is interpolated into them. If Monaco ever stops accepting
// the extra declarations, contentIconPath still degrades to a normal image.
const HOST_TEXT_DECORATION = "none";
const MAX_HORIZONTAL_OFFSET_COLUMNS = 2_048;

export type MathPreviewHorizontalStrategy = {
  /** Preserve Monaco's static inline position, optionally corrected by a
   * small cross-line monospace offset. Inline previews use this at either
   * the opening delimiter or the active source line's indentation. */
  readonly kind: "static";
  readonly offsetColumns?: number;
};

/**
 * Plan a floating preview which does not participate in Monaco's inline text
 * flow. Inline cards follow the active cursor line: they align to the opening
 * delimiter on the first line and to the active line's indentation on later
 * lines. Block cards keep the opening delimiter as their preferred horizontal
 * origin. The vertical anchor follows the visible formula boundary, or the
 * current line when that boundary has scrolled away.
 */
export function planMathPreviewLayout(
  request: MathPreviewLayoutRequest,
): MathPreviewLayoutPlan {
  const cursorLine = nonNegativeInteger(request.cursorLine);
  const cursorLineStartCharacter = nonNegativeInteger(
    request.cursorLineStartCharacter,
  );
  const start = normalizePoint(request.formulaStart);
  const end = normalizePoint(request.formulaEnd);
  const visible = selectVisibleRange(request.visibleRanges, cursorLine);
  const requiredVisibleLines = estimateRequiredVisibleLines(request);
  if (request.mode === "inline") {
    const side = chooseSide(
      request.placement,
      requiredVisibleLines,
      Math.max(0, cursorLine - visible.startLine),
      Math.max(0, visible.endLine - cursorLine),
    );
    return {
      side,
      anchor: {
        line: cursorLine,
        character: cursorLine === start.line
          ? start.character
          : cursorLineStartCharacter,
      },
      requiredVisibleLines,
      hostTextDecoration: HOST_TEXT_DECORATION,
      attachmentTextDecoration: createMathPreviewAttachmentTextDecoration(
        side,
        { kind: "static" },
      ),
    };
  }
  const startVisible = lineIsVisible(start.line, visible);
  const endVisible = lineIsVisible(end.line, visible);
  const aboveAnchorLine = startVisible ? start.line : cursorLine;
  const belowAnchorLine = endVisible ? end.line : cursorLine;
  const visibleLinesAbove = Math.max(
    0,
    aboveAnchorLine - visible.startLine,
  );
  const visibleLinesBelow = Math.max(
    0,
    endVisible ? visible.endLine - belowAnchorLine : 0,
  );
  const side = chooseSide(
    request.placement,
    requiredVisibleLines,
    visibleLinesAbove,
    visibleLinesBelow,
  );
  const bothSidesOverflow =
    isAutomaticPlacement(request.placement) &&
    visibleLinesBelow < requiredVisibleLines &&
    visibleLinesAbove < requiredVisibleLines;
  const shouldPreserveFormulaTail =
    bothSidesOverflow &&
    (request.mode === "block" || end.line > start.line);
  let anchorLine: number;
  if (shouldPreserveFormulaTail) {
    anchorLine = planOverflowTailAnchor(
      start.line,
      endVisible ? end.line : cursorLine,
      visible,
    );
  } else if (side === "above") {
    anchorLine = aboveAnchorLine;
  } else {
    anchorLine = belowAnchorLine;
  }
  const anchor = {
    line: anchorLine,
    character: start.character,
  };

  return {
    side,
    anchor,
    requiredVisibleLines,
    hostTextDecoration: HOST_TEXT_DECORATION,
    attachmentTextDecoration: createMathPreviewAttachmentTextDecoration(
      side,
      { kind: "static" },
    ),
  };
}

/**
 * Build the fixed attachment CSS with one sanitized numeric column offset.
 * This compensates when the vertical anchor line has different indentation
 * or is shorter than the opening-delimiter line. No document text is copied
 * into the declaration.
 */
export function createMathPreviewAttachmentTextDecoration(
  side: MathPreviewSide,
  horizontal: number | MathPreviewHorizontalStrategy = 0,
): string {
  const strategy: MathPreviewHorizontalStrategy = typeof horizontal === "number"
    ? { kind: "static", offsetColumns: horizontal }
    : horizontal;
  const horizontalCss = createStaticPositionCss(strategy.offsetColumns);
  const vertical = side === "above"
    ? "bottom: calc(100% + 0.35em);"
    : "top: calc(100% + 0.35em);";
  return (
    "none; position: absolute; display: inline-block; " +
    horizontalCss +
    `${vertical} z-index: 10; pointer-events: none; ` +
    "opacity: 1; overflow: visible; background-repeat: no-repeat; " +
    "background-size: 100% 100%;"
  );
}

function createStaticPositionCss(offsetColumns: number | undefined): string {
  const safeOffset = clampInteger(
    Number.isFinite(offsetColumns) ? (offsetColumns ?? 0) : 0,
    -MAX_HORIZONTAL_OFFSET_COLUMNS,
    MAX_HORIZONTAL_OFFSET_COLUMNS,
  );
  const translation = safeOffset === 0 ? "0" : `${safeOffset}ch`;
  // Intentionally omit left/right. With both insets auto, Monaco keeps the
  // generated ::before at the source range's static inline position.
  return `transform: translateX(${translation}); `;
}

/** Compute a monospace visual-column correction, including tab expansion. */
export function calculateMathPreviewHorizontalOffsetColumns(
  openingLineText: string,
  openingCharacter: number,
  anchorLineText: string,
  anchorCharacter: number,
  tabSize: number,
): number {
  const safeTabSize = clampInteger(
    Number.isFinite(tabSize) ? tabSize : 4,
    1,
    16,
  );
  return visualColumnAt(
    openingLineText,
    openingCharacter,
    safeTabSize,
  ) - visualColumnAt(anchorLineText, anchorCharacter, safeTabSize);
}

function chooseSide(
  placement: MathPreviewPlacement,
  requiredLines: number,
  visibleLinesAbove: number,
  visibleLinesBelow: number,
): MathPreviewSide {
  if (placement === "above" || placement === "below") {
    return placement;
  }
  if (placement === "autoAbove") {
    if (visibleLinesAbove >= requiredLines) {
      return "above";
    }
    if (visibleLinesBelow >= requiredLines) {
      return "below";
    }
    return "above";
  }
  if (visibleLinesBelow >= requiredLines) {
    return "below";
  }
  return "above";
}

function isAutomaticPlacement(
  placement: MathPreviewPlacement,
): placement is "autoBelow" | "autoAbove" {
  return placement === "autoBelow" || placement === "autoAbove";
}

function estimateRequiredVisibleLines(
  request: MathPreviewLayoutRequest,
): number {
  const fontSize = positiveFinite(request.fontSizePx, DEFAULT_FONT_SIZE_PX);
  const lineHeight = positiveFinite(
    request.lineHeightPx,
    fontSize * DEFAULT_LINE_HEIGHT_MULTIPLIER,
  );
  const heightEm = positiveFinite(request.previewHeightEm, 1);
  return Math.max(
    1,
    Math.ceil(((heightEm + PREVIEW_GAP_EM) * fontSize) / lineHeight),
  );
}

function selectVisibleRange(
  ranges: readonly MathPreviewVisibleLineRange[],
  cursorLine: number,
): MathPreviewVisibleLineRange {
  const normalized = ranges
    .map((range) => ({
      startLine: nonNegativeInteger(Math.min(range.startLine, range.endLine)),
      endLine: nonNegativeInteger(Math.max(range.startLine, range.endLine)),
    }))
    .filter((range) => range.endLine >= range.startLine);
  const containing = normalized.find((range) => lineIsVisible(cursorLine, range));
  if (containing !== undefined) {
    return containing;
  }
  return normalized.sort(
    (left, right) =>
      distanceToRange(cursorLine, left) - distanceToRange(cursorLine, right),
  )[0] ?? { startLine: cursorLine, endLine: cursorLine };
}

function distanceToRange(
  line: number,
  range: MathPreviewVisibleLineRange,
): number {
  if (line < range.startLine) {
    return range.startLine - line;
  }
  if (line > range.endLine) {
    return line - range.endLine;
  }
  return 0;
}

/**
 * Keep the current/closing formula tail below an oversized card. The editor
 * clips the card's top, while its bottom and the final source lines remain in
 * view. This never scrolls or mutates the user's document.
 */
function planOverflowTailAnchor(
  formulaStartLine: number,
  focusTailLine: number,
  visible: MathPreviewVisibleLineRange,
): number {
  const tail = clampInteger(
    focusTailLine,
    visible.startLine,
    visible.endLine,
  );
  const desiredForSourceTail = Math.max(
    formulaStartLine,
    tail - (OVERFLOW_SOURCE_TAIL_LINES - 1),
  );
  const previewTailCapacity = Math.min(
    OVERFLOW_PREVIEW_TAIL_LINES,
    Math.max(0, tail - visible.startLine),
  );
  const minimumForPreviewTail = visible.startLine + previewTailCapacity;
  return Math.min(
    tail,
    Math.max(desiredForSourceTail, minimumForPreviewTail),
  );
}

function lineIsVisible(
  line: number,
  range: MathPreviewVisibleLineRange,
): boolean {
  return line >= range.startLine && line <= range.endLine;
}

function normalizePoint(point: MathPreviewLayoutPoint): MathPreviewLayoutPoint {
  return {
    line: nonNegativeInteger(point.line),
    character: nonNegativeInteger(point.character),
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function visualColumnAt(
  text: string,
  character: number,
  tabSize: number,
): number {
  let column = 0;
  const end = Math.min(
    text.length,
    Math.max(0, Math.trunc(character)),
  );
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\t") {
      column += tabSize - (column % tabSize);
    } else {
      column += 1;
    }
  }
  return column;
}
