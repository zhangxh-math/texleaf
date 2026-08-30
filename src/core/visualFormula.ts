/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

export const VISUAL_FORMULA_FOREGROUND = "#010203";

export interface VisualFormulaAsset {
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
}

export interface VisualFormulaAssetOptions {
  readonly display: boolean;
  readonly foreground?: string;
  readonly maximumWidthEm?: number;
  readonly maximumHeightEm?: number;
}

export interface VisualFormulaViewportRecord {
  readonly id: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Pick a small nearest-first formula batch from an already source-sorted
 * snapshot. Expanding around a midpoint lower-bound keeps the work
 * proportional to the requested batch instead of filtering and sorting every
 * formula in a large document after each viewport refinement.
 */
export function selectVisualFormulaViewportBatch<
  T extends VisualFormulaViewportRecord,
>(
  records: readonly T[],
  renderedFormulaIds: ReadonlySet<string>,
  requestedFrom: number,
  requestedTo: number,
  requestedLimit: number,
): T[] {
  const limit = Math.max(0, Math.trunc(requestedLimit));
  if (records.length === 0 || limit === 0) {
    return [];
  }
  const from = Math.min(requestedFrom, requestedTo);
  const to = Math.max(requestedFrom, requestedTo);
  const center = (from + to) / 2;

  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const record = records[middle]!;
    if ((record.from + record.to) / 2 < center) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  let left = low - 1;
  let right = low;
  let leftCandidate: T | undefined;
  let rightCandidate: T | undefined;
  const nextLeft = (): T | undefined => {
    while (left >= 0) {
      const record = records[left--]!;
      if (record.to < from) {
        left = -1;
        return undefined;
      }
      if (record.from <= to && !renderedFormulaIds.has(record.id)) {
        return record;
      }
    }
    return undefined;
  };
  const nextRight = (): T | undefined => {
    while (right < records.length) {
      const record = records[right++]!;
      if (record.from > to) {
        right = records.length;
        return undefined;
      }
      if (record.to >= from && !renderedFormulaIds.has(record.id)) {
        return record;
      }
    }
    return undefined;
  };

  const selected: T[] = [];
  while (selected.length < limit) {
    leftCandidate ??= nextLeft();
    rightCandidate ??= nextRight();
    if (leftCandidate === undefined && rightCandidate === undefined) {
      break;
    }
    const useLeft = rightCandidate === undefined ||
      (leftCandidate !== undefined &&
        Math.abs((leftCandidate.from + leftCandidate.to) / 2 - center) <=
          Math.abs((rightCandidate.from + rightCandidate.to) / 2 - center));
    if (useLeft) {
      selected.push(leftCandidate!);
      leftCandidate = undefined;
    } else {
      selected.push(rightCandidate!);
      rightCandidate = undefined;
    }
  }
  return selected;
}

/**
 * Overlapping or nearby viewport reports commonly come from CodeMirror's
 * widget-height correction and may share one render lane. A distant scroll
 * must supersede the old backlog immediately.
 */
export function visualFormulaViewportsKeepPriority(
  previousFrom: number,
  previousTo: number,
  nextFrom: number,
  nextTo: number,
  maximumGap = 512,
): boolean {
  const previousStart = Math.min(previousFrom, previousTo);
  const previousEnd = Math.max(previousFrom, previousTo);
  const nextStart = Math.min(nextFrom, nextTo);
  const nextEnd = Math.max(nextFrom, nextTo);
  const gap = Math.max(
    0,
    Math.max(previousStart, nextStart) - Math.min(previousEnd, nextEnd),
  );
  return gap <= Math.max(0, maximumGap);
}

/**
 * Convert a worker SVG into a theme-neutral, bounded visual-editor asset.
 *
 * The worker deliberately renders with a unique placeholder colour. Replacing
 * only that exact colour with `currentColor` lets the SVG follow VS Code theme
 * changes without weakening the worker's SVG safety boundary. Worker geometry
 * is retained at its intrinsic size.  The large display limits below are
 * paint-safety ceilings for malformed worker geometry, not presentation
 * limits: ordinary wide and multi-line formulae stay at the editor's normal
 * font scale and retain their complete intrinsic geometry in the document.
 */
export function prepareVisualFormulaAsset(
  asset: VisualFormulaAsset,
  options: VisualFormulaAssetOptions,
): VisualFormulaAsset {
  const foreground = (options.foreground ?? VISUAL_FORMULA_FOREGROUND).toLowerCase();
  const width = finitePositive(asset.widthEm, 1);
  const height = finitePositive(asset.heightEm, options.display ? 2.4 : 1.2);
  const maxHeight = finitePositive(
    options.maximumHeightEm ?? Number.NaN,
    options.display ? 256 : 4.5,
  );
  const maxWidth = finitePositive(
    options.maximumWidthEm ?? Number.NaN,
    options.display ? 512 : 80,
  );
  const scale = Math.min(1, maxHeight / height, maxWidth / width);
  const widthEm = roundGeometry(Math.max(0.25, width * scale));
  const heightEm = roundGeometry(Math.max(0.25, height * scale));
  const colourPattern = new RegExp(escapeRegExp(foreground), "giu");
  const svg = asset.svg
    .replace(colourPattern, "currentColor")
    .replace(/vertical-align\s*:[^;'"]*;?/giu, "");
  return { svg, widthEm, heightEm };
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function roundGeometry(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
