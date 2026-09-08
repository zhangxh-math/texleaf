/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export interface VisualPointerSourceRange {
  readonly from: number;
  readonly to: number;
}

function clampVisualPointerPosition(position: number, documentLength: number): number {
  return Math.max(0, Math.min(documentLength, Math.trunc(position)));
}

/**
 * Keep CodeMirror's pointer position on the physical `.cm-line` that was
 * actually hit. Block replacements are allowed to bias both `posAtCoords`
 * and Chromium's DOM caret into an adjacent formula, but they must not move a
 * plain-text click away from its painted source line.
 */
export function resolveVisualPointerPosition(
  documentLength: number,
  domPosition: number | undefined,
  coordinatePosition: number | undefined,
  clickedLine: VisualPointerSourceRange | undefined,
): number | undefined {
  const safeLength = Number.isSafeInteger(documentLength)
    ? Math.max(0, documentLength)
    : 0;
  const safeDomPosition = Number.isSafeInteger(domPosition)
    ? clampVisualPointerPosition(domPosition as number, safeLength)
    : undefined;
  const safeCoordinatePosition = Number.isSafeInteger(coordinatePosition)
    ? clampVisualPointerPosition(coordinatePosition as number, safeLength)
    : undefined;

  if (clickedLine === undefined) {
    return safeDomPosition ?? safeCoordinatePosition;
  }

  const lineFrom = clampVisualPointerPosition(
    Math.min(clickedLine.from, clickedLine.to),
    safeLength,
  );
  const lineTo = clampVisualPointerPosition(
    Math.max(clickedLine.from, clickedLine.to),
    safeLength,
  );
  for (const candidate of [safeDomPosition, safeCoordinatePosition]) {
    if (candidate !== undefined && candidate >= lineFrom && candidate <= lineTo) {
      return candidate;
    }
  }

  // The mousedown coordinate belongs to this exact gesture, whereas the live
  // DOM selection may still point at the replacement selected by CodeMirror.
  const fallback = safeCoordinatePosition ?? safeDomPosition;
  if (fallback === undefined) {
    return lineFrom;
  }
  return Math.max(lineFrom, Math.min(lineTo, fallback));
}

/**
 * Decides whether a click belongs to collapsed source.
 *
 * A real `.cm-line` under the pointer is more reliable than CodeMirror's
 * nearest editable coordinate around a block replacement. Only fall back to
 * the replacement interval when no physical source line could be identified,
 * and keep that interval half-open so its `to` endpoint remains owned by the
 * following source line.
 */
export function visualPointerTargetsCollapsedSource(
  position: number,
  clickedLineNumber: number | undefined,
  boundaryLineNumbers: readonly number[],
  replacement: VisualPointerSourceRange,
): boolean {
  if (clickedLineNumber !== undefined) {
    return boundaryLineNumbers.includes(clickedLineNumber);
  }
  const from = Math.min(replacement.from, replacement.to);
  const to = Math.max(replacement.from, replacement.to);
  return Number.isSafeInteger(position) &&
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    position >= from &&
    position < to;
}
