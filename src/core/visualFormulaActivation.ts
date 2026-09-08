/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export interface VisualFormulaActivationRange {
  readonly from: number;
  readonly to: number;
}

export interface VisualFormulaActivationTarget {
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
}

function validActivationRange(
  range: VisualFormulaActivationRange | undefined,
  documentLength: number,
): range is VisualFormulaActivationRange {
  return range !== undefined &&
    Number.isSafeInteger(range.from) &&
    Number.isSafeInteger(range.to) &&
    range.from >= 0 &&
    range.to >= range.from &&
    range.to <= documentLength;
}

function validActivationTarget(
  target: VisualFormulaActivationTarget | undefined,
  documentLength: number,
): target is VisualFormulaActivationTarget {
  return target !== undefined &&
    validActivationRange(target, documentLength) &&
    validActivationRange(
      { from: target.bodyFrom, to: target.bodyTo },
      documentLength,
    ) &&
    target.bodyFrom >= target.from &&
    target.bodyTo <= target.to;
}

/**
 * Resolves the source range opened by a visual formula widget.
 *
 * CodeMirror may reuse a widget DOM node after an authoritative document
 * replacement. Its data attributes are then only a best-effort mapped cache:
 * a single replacement spanning the formula can even map the old endpoints in
 * reverse order. The current formula StateField record is authoritative and
 * must win whenever it is available; mapped DOM ranges are only a compatibility
 * fallback while a fresh host snapshot is pending.
 */
export function resolveVisualFormulaActivationTarget(
  documentLength: number,
  liveTarget: VisualFormulaActivationTarget | undefined,
  mappedOuterRange: VisualFormulaActivationRange | undefined,
  mappedBodyRange: VisualFormulaActivationRange | undefined,
): VisualFormulaActivationTarget | undefined {
  if (validActivationTarget(liveTarget, documentLength)) {
    return liveTarget;
  }
  if (
    !validActivationRange(mappedOuterRange, documentLength) ||
    !validActivationRange(mappedBodyRange, documentLength) ||
    mappedBodyRange.from < mappedOuterRange.from ||
    mappedBodyRange.to > mappedOuterRange.to
  ) {
    return undefined;
  }
  return {
    from: mappedOuterRange.from,
    to: mappedOuterRange.to,
    bodyFrom: mappedBodyRange.from,
    bodyTo: mappedBodyRange.to,
  };
}
