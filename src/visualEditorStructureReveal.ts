/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export interface VisualStructureSourceRange {
  readonly from: number;
  readonly to: number;
}

export type VisualStructureSourceRevealRetention =
  | "exact-range"
  | "boundary-lines";

export interface VisualStructureSourceReveal {
  readonly ranges: readonly VisualStructureSourceRange[];
  readonly scopeFrom: number;
  readonly scopeTo: number;
  /**
   * Inline commands such as `\\cite{...}` stop exposing source as soon as the
   * caret leaves the exact command. Paired environment boundaries deliberately
   * remain editable while the caret stays anywhere on either physical boundary
   * line, including optional titles and labels beside `\\begin` / `\\end`.
   */
  readonly retention: VisualStructureSourceRevealRetention;
}

export interface VisualStructureSelectionRange {
  readonly from: number;
  readonly to: number;
}

export interface VisualEnvironmentBoundaryRecord {
  readonly begin: {
    readonly sourceFrom: number;
    readonly sourceTo: number;
  };
  readonly end: {
    readonly sourceFrom: number;
    readonly sourceTo: number;
  };
}

/**
 * Plan the paired source reveal used by both begin and end edit controls.
 * Keeping this symmetric prevents an end control from revealing only its own
 * command or landing in a still-hidden boundary.
 */
export function pairedVisualEnvironmentBoundaryReveal(
  record: VisualEnvironmentBoundaryRecord,
  from: number,
  to: number,
): VisualStructureSourceReveal | undefined {
  const touchesBegin = rangesOverlap(
    record.begin.sourceFrom,
    record.begin.sourceTo,
    from,
    to,
  );
  const touchesEnd = rangesOverlap(
    record.end.sourceFrom,
    record.end.sourceTo,
    from,
    to,
  );
  if (!touchesBegin && !touchesEnd) {
    return undefined;
  }
  return {
    ranges: [
      { from: record.begin.sourceFrom, to: record.begin.sourceTo },
      { from: record.end.sourceFrom, to: record.end.sourceTo },
    ],
    scopeFrom: record.begin.sourceFrom,
    scopeTo: record.end.sourceTo,
    retention: "boundary-lines",
  };
}

/**
 * Decide whether a selection still owns an explicitly revealed structure.
 *
 * Exact inline ranges use half-open source semantics: a collapsed caret at
 * `range.to` has already crossed the closing brace and must restore the visual
 * widget immediately. Environment boundaries retain the historic whole-line
 * behaviour so their optional arguments remain comfortable to edit.
 */
export function selectionRetainsVisualStructureSourceReveal(
  reveal: VisualStructureSourceReveal,
  selections: readonly VisualStructureSelectionRange[],
  lineNumberAt: (position: number) => number,
): boolean {
  if (reveal.retention === "exact-range") {
    return reveal.ranges.some((sourceRange) =>
      selections.some((selection) =>
        selection.from === selection.to
          ? selection.from > sourceRange.from && selection.from < sourceRange.to
          : selection.from < sourceRange.to && selection.to > sourceRange.from
      )
    );
  }

  return reveal.ranges.some((sourceRange) => {
    const firstRevealLine = lineNumberAt(sourceRange.from);
    const lastRevealLine = lineNumberAt(
      Math.max(sourceRange.from, sourceRange.to - 1),
    );
    return selections.some((selection) => {
      const firstSelectionLine = lineNumberAt(selection.from);
      const lastSelectionLine = lineNumberAt(selection.to);
      return firstSelectionLine <= lastRevealLine &&
        lastSelectionLine >= firstRevealLine;
    });
  });
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
): boolean {
  return leftFrom < rightTo && rightFrom < leftTo;
}
