/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export interface VisualLineNumberDocument {
  readonly length: number;
  lineAt(position: number): {
    readonly number: number;
    readonly from: number;
    readonly to: number;
  };
}

export interface VisualSourceLineNumberRange {
  readonly fromLine: number;
  readonly toLine: number;
}

/**
 * Return the first position on the physical line immediately following a
 * document-end command. CodeMirror normalizes every line separator to one
 * document position, so exact adjacency distinguishes a real following line
 * from same-line inert tail text.
 */
export function visualDocumentEndFollowingLinePosition(
  document: VisualLineNumberDocument,
  sourceTo: number,
): number | undefined {
  if (
    !Number.isSafeInteger(document.length) ||
    document.length <= 0 ||
    !Number.isSafeInteger(sourceTo) ||
    sourceTo < 0 ||
    sourceTo >= document.length
  ) {
    return undefined;
  }
  const commandLine = document.lineAt(sourceTo);
  const followingPosition = sourceTo + 1;
  const followingLine = document.lineAt(followingPosition);
  return commandLine.to === sourceTo &&
      followingLine.from === followingPosition &&
      followingLine.number === commandLine.number + 1
    ? followingPosition
    : undefined;
}

export type VisualSourceRangeLineNumberLayout =
  | "compact"
  | "balanced"
  | "capped";

export const VISUAL_SOURCE_RANGE_COMPACT_MAX_LINE_HEIGHTS = 2.75;
export const VISUAL_SOURCE_RANGE_CAPPED_MIN_LINE_HEIGHTS = 6;

/**
 * Decide whether a block replacement must own CodeMirror's terminal boundary.
 *
 * A block that reaches the end of the document otherwise leaves a zero-length
 * text block behind. The native line-number gutter renders that residual block
 * in addition to the visual widget's source-range marker, which produces two
 * copies of the final source line number. Non-terminal and inline replacements
 * deliberately remain end-exclusive so the following source line stays native.
 */
export function visualBlockReplacementInclusiveEnd(
  block: boolean,
  replacementTo: number,
  documentLength: number,
): boolean {
  return block &&
    Number.isSafeInteger(replacementTo) &&
    Number.isSafeInteger(documentLength) &&
    replacementTo >= 0 &&
    documentLength >= 0 &&
    replacementTo === documentLength;
}

/**
 * Locate CodeMirror's synthetic final line for a document-end command followed
 * by exactly one normalized line separator.
 *
 * CodeMirror faithfully represents a terminal LF/CRLF as an empty logical
 * line at `document.length`. A standalone `\\end{document}` replacement owns
 * its terminating line separator. The host deliberately scans only through
 * the executable command, so `replacement.sourceTo` is one normalized
 * position before the empty EOF line. Requiring that exact adjacency preserves
 * a genuinely blank tail (two separators), trailing text, and files that do
 * not end in a line separator.
 */
export function visualTerminalSyntheticEofLinePosition(
  document: VisualLineNumberDocument,
  sourceTo: number,
): number | undefined {
  const followingPosition = visualDocumentEndFollowingLinePosition(
    document,
    sourceTo,
  );
  if (followingPosition !== document.length) {
    return undefined;
  }
  const terminalLine = document.lineAt(document.length);
  return terminalLine.from === document.length &&
      terminalLine.to === document.length
    ? document.length
    : undefined;
}

/**
 * Choose a readable range-marker layout from the rendered block height.
 *
 * A short formula cannot fit two stacked line numbers plus a vertical rule,
 * while stretching the same marker across a tall table makes its endpoints
 * look unrelated. The middle state preserves the requested vertical range;
 * the outer states collapse it into a two-row fixed-width marker or cap its
 * visual height.
 */
export function visualSourceRangeLineNumberLayout(
  blockHeight: number,
  lineHeight: number,
): VisualSourceRangeLineNumberLayout {
  if (
    !Number.isFinite(blockHeight) ||
    blockHeight <= 0 ||
    !Number.isFinite(lineHeight) ||
    lineHeight <= 0
  ) {
    return "balanced";
  }

  const heightInLines = blockHeight / lineHeight;
  if (heightInLines < VISUAL_SOURCE_RANGE_COMPACT_MAX_LINE_HEIGHTS) {
    return "compact";
  }
  if (heightInLines > VISUAL_SOURCE_RANGE_CAPPED_MIN_LINE_HEIGHTS) {
    return "capped";
  }
  return "balanced";
}

/**
 * Resolve the source-line span hidden by a block replacement.
 *
 * Replacement ranges are half-open and commonly consume the newline after a
 * standalone formula/environment. Looking at `to` itself would therefore
 * report the following prose line. The final owned character (`to - 1`) keeps
 * the displayed range tied to the source actually represented by the widget.
 */
export function visualSourceLineNumberRange(
  document: VisualLineNumberDocument,
  from: number,
  to: number,
): VisualSourceLineNumberRange | undefined {
  if (
    !Number.isSafeInteger(document.length) ||
    document.length < 0 ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to)
  ) {
    return undefined;
  }
  const safeFrom = Math.max(0, Math.min(document.length, from));
  const safeTo = Math.max(0, Math.min(document.length, to));
  if (safeFrom >= safeTo) {
    return undefined;
  }
  return {
    fromLine: document.lineAt(safeFrom).number,
    toLine: document.lineAt(Math.max(safeFrom, safeTo - 1)).number,
  };
}
