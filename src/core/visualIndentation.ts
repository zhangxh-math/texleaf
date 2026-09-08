/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createLatexScanState, scanLatexSegment } from './latexScanner';

export interface VisualLeadingIndentPlan {
  readonly lineFrom: number;
  readonly indentationLength: number;
  /** Number of source indentation characters hidden in visual mode. */
  readonly hideLength: number;
}

export interface VisualLatexIndentationChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly lineNumber: number;
}

export interface VisualLatexIndentationFormatPlan {
  readonly changes: readonly VisualLatexIndentationChange[];
  readonly changedLineCount: number;
  readonly skippedOpaqueLineCount: number;
  readonly exceededChangeLimit: boolean;
}

export interface VisualLatexIndentationTransportPlan {
  readonly changes: readonly VisualLatexIndentationChange[];
  readonly insertedLength: number;
  readonly exceededLimit: boolean;
}

export const VISUAL_LATEX_INDENT_UNIT = '  ';

export const VISUAL_LATEX_FORMAT_MAX_TRANSPORT_CHANGES = 256;

export const VISUAL_LATEX_FORMAT_MAX_TRANSPORT_INSERT = 5_000_000;

const DEFAULT_VISUAL_FORMAT_CHANGE_LIMIT = 100_000;
const DEFAULT_VISUAL_FORMAT_DEPTH_LIMIT = 256;

/** Convert source spaces/tabs to visual columns for block-widget layout. */
export function visualSourceIndentationColumns(
  prefix: string,
  tabSize = 4,
  maxColumns = 256,
): number {
  if (!/^[\t ]*$/u.test(prefix)) {
    return 0;
  }
  const safeTabSize = Math.max(1, Math.min(16, Math.trunc(tabSize) || 4));
  const requestedMaximum = Number.isFinite(maxColumns)
    ? Math.trunc(maxColumns)
    : 256;
  const safeMaximum = Math.max(0, Math.min(4_096, requestedMaximum));
  if (safeMaximum === 0) {
    return 0;
  }
  let columns = 0;
  for (const character of prefix) {
    columns = character === '\t'
      ? columns + safeTabSize - (columns % safeTabSize)
      : columns + 1;
    if (columns >= safeMaximum) {
      return safeMaximum;
    }
  }
  return columns;
}

/**
 * Keep visual indentation faithful to the physical LaTeX source.
 *
 * Earlier versions hid a line's common leading whitespace in visual mode. That
 * made the rendered hierarchy disagree with source mode and made an otherwise
 * correctly indented paragraph appear to jump left after leaving an environment.
 * Visual mode now displays every physical indentation character. The formatter
 * below owns normalization; presentation no longer silently changes columns.
 */
export function planVisualLeadingIndentation(
  source: string,
): readonly VisualLeadingIndentPlan[] {
  const plans: VisualLeadingIndentPlan[] = [];
  let lineFrom = 0;

  while (lineFrom <= source.length) {
    const nextLf = source.indexOf('\n', lineFrom);
    const segmentTo = nextLf < 0 ? source.length : nextLf + 1;
    const contentTo = nextLf < 0
      ? source.length
      : nextLf > lineFrom && source[nextLf - 1] === '\r'
      ? nextLf - 1
      : nextLf;
    const lineText = source.slice(lineFrom, contentTo);
    const indentation = /^[\t ]*/u.exec(lineText)?.[0] ?? '';

    plans.push({
      lineFrom,
      indentationLength: indentation.length,
      hideLength: 0,
    });

    if (nextLf < 0) {
      break;
    }
    lineFrom = segmentTo;
  }

  return plans;
}

function normalizeVisualEnvironmentName(name: string): string {
  return name.endsWith('*') ? name.slice(0, -1) : name;
}

/**
 * Plan a conservative whole-document indentation pass.
 *
 * Only leading spaces and tabs are changed. Commands, comments, formula text,
 * line endings and every opaque environment body remain byte-for-byte intact.
 * `document` is a wrapper rather than an indentation level; every other real
 * environment adds one level. Block `\\[...\\]` and `$$...$$` bodies add one
 * temporary level, with their closer aligned to the opener.
 */
export function planVisualLatexIndentationFormat(
  source: string,
  options: {
    readonly indentUnit?: string;
    readonly maxChanges?: number;
    readonly maxDepth?: number;
    readonly maxInsertedLength?: number;
  } = {},
): VisualLatexIndentationFormatPlan {
  const indentUnit = normalizedVisualIndentUnit(options.indentUnit);
  const maxChanges = Number.isSafeInteger(options.maxChanges) &&
      (options.maxChanges ?? 0) > 0
    ? options.maxChanges!
    : DEFAULT_VISUAL_FORMAT_CHANGE_LIMIT;
  const maxDepth = positiveSafeInteger(
    options.maxDepth,
    DEFAULT_VISUAL_FORMAT_DEPTH_LIMIT,
  );
  const maxInsertedLength = positiveSafeInteger(
    options.maxInsertedLength,
    VISUAL_LATEX_FORMAT_MAX_TRANSPORT_INSERT,
  );
  const changes: VisualLatexIndentationChange[] = [];
  let plannedInsertedLength = 0;
  let skippedOpaqueLineCount = 0;
  let scanState = createLatexScanState();
  let lineFrom = 0;
  let lineNumber = 1;

  while (lineFrom <= source.length) {
    const physicalLine = visualPhysicalLineAt(source, lineFrom);
    const lineText = source.slice(lineFrom, physicalLine.contentTo);
    const leading = /^[\t ]*/u.exec(lineText)?.[0] ?? '';
    const trimmed = lineText.slice(leading.length);
    const nextScanState = physicalLine.lineTo > lineFrom
      ? scanLatexSegment(
          source.slice(lineFrom, physicalLine.lineTo),
          scanState,
          lineFrom,
        )
      : scanState;
    if (
      scanState.environments.length > maxDepth ||
      scanState.textArguments.length > maxDepth ||
      nextScanState.environments.length > maxDepth ||
      nextScanState.textArguments.length > maxDepth
    ) {
      return {
        changes: [],
        changedLineCount: 0,
        skippedOpaqueLineCount,
        exceededChangeLimit: true,
      };
    }
    const opaque = scanState.verbatimEnvironment !== undefined ||
      nextScanState.verbatimEnvironment !== undefined;

    if (opaque) {
      skippedOpaqueLineCount += 1;
    } else {
      const indentation = trimmed.length === 0
        ? ''
        : indentUnit.repeat(
            Math.min(256, visualStructuralIndentationDepth(scanState, trimmed)),
          );
      if (leading !== indentation) {
        plannedInsertedLength += indentation.length;
        if (plannedInsertedLength > maxInsertedLength) {
          return {
            changes: [],
            changedLineCount: 0,
            skippedOpaqueLineCount,
            exceededChangeLimit: true,
          };
        }
        changes.push({
          from: lineFrom,
          to: lineFrom + leading.length,
          insert: indentation,
          lineNumber,
        });
        if (changes.length > maxChanges) {
          return {
            changes: [],
            changedLineCount: 0,
            skippedOpaqueLineCount,
            exceededChangeLimit: true,
          };
        }
      }
    }

    scanState = nextScanState;
    if (physicalLine.lineTo >= source.length) {
      break;
    }
    lineFrom = physicalLine.lineTo;
    lineNumber += 1;
  }

  return {
    changes,
    changedLineCount: changes.length,
    skippedOpaqueLineCount,
    exceededChangeLimit: false,
  };
}

/**
 * Coalesce a potentially large line-by-line format plan into the bounded edit
 * batch accepted by the Extension Host. Choosing the largest unchanged gaps as
 * group boundaries minimizes the amount of unchanged source copied through the
 * Webview protocol. The fine-grained plan remains the authority for selection
 * mapping; callers must not map selections through these wider transport edits.
 */
export function coalesceVisualLatexIndentationChanges(
  source: string,
  changes: readonly VisualLatexIndentationChange[],
  options: {
    readonly maxChanges?: number;
    readonly maxInsertedLength?: number;
  } = {},
): VisualLatexIndentationTransportPlan {
  const maxChanges = positiveSafeInteger(
    options.maxChanges,
    VISUAL_LATEX_FORMAT_MAX_TRANSPORT_CHANGES,
  );
  const maxInsertedLength = positiveSafeInteger(
    options.maxInsertedLength,
    VISUAL_LATEX_FORMAT_MAX_TRANSPORT_INSERT,
  );
  if (changes.length === 0) {
    return { changes: [], insertedLength: 0, exceededLimit: false };
  }

  let previousTo = 0;
  for (const change of changes) {
    if (
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < previousTo ||
      change.to < change.from ||
      change.to > source.length ||
      !/^[\t ]*$/u.test(change.insert) ||
      !/^[\t ]*$/u.test(source.slice(change.from, change.to))
    ) {
      return { changes: [], insertedLength: 0, exceededLimit: true };
    }
    previousTo = change.to;
  }

  if (changes.length <= maxChanges) {
    const insertedLength = changes.reduce(
      (total, change) => total + change.insert.length,
      0,
    );
    return insertedLength <= maxInsertedLength
      ? { changes, insertedLength, exceededLimit: false }
      : { changes: [], insertedLength: 0, exceededLimit: true };
  }

  const boundaryCount = maxChanges - 1;
  const boundaries = new Set(
    changes.slice(0, -1)
      .map((change, index) => ({
        afterIndex: index,
        gap: (changes[index + 1]?.from ?? change.to) - change.to,
      }))
      .sort((left, right) => right.gap - left.gap || left.afterIndex - right.afterIndex)
      .slice(0, boundaryCount)
      .map((entry) => entry.afterIndex),
  );
  const transport: VisualLatexIndentationChange[] = [];
  let groupStart = 0;
  let insertedLength = 0;
  for (let index = 0; index < changes.length; index += 1) {
    if (index < changes.length - 1 && !boundaries.has(index)) {
      continue;
    }
    const group = changes.slice(groupStart, index + 1);
    const first = group[0]!;
    const last = group[group.length - 1]!;
    let cursor = first.from;
    let insert = '';
    for (const change of group) {
      insert += source.slice(cursor, change.from);
      insert += change.insert;
      cursor = change.to;
    }
    insert += source.slice(cursor, last.to);
    insertedLength += insert.length;
    if (insertedLength > maxInsertedLength) {
      return { changes: [], insertedLength: 0, exceededLimit: true };
    }
    transport.push({
      from: first.from,
      to: last.to,
      insert,
      lineNumber: first.lineNumber,
    });
    groupStart = index + 1;
  }

  return {
    changes: transport,
    insertedLength,
    exceededLimit: transport.length > maxChanges,
  };
}

function normalizedVisualIndentUnit(candidate: string | undefined): string {
  return candidate !== undefined && /^[\t ]{1,8}$/u.test(candidate)
    ? candidate
    : VISUAL_LATEX_INDENT_UNIT;
}

function positiveSafeInteger(candidate: number | undefined, fallback: number): number {
  return Number.isSafeInteger(candidate) && (candidate ?? 0) > 0
    ? candidate!
    : fallback;
}

function visualStructuralIndentationDepth(
  state: ReturnType<typeof createLatexScanState>,
  trimmedLine: string,
): number {
  const environments = state.environments;
  let depth = environments.reduce(
    (count, frame) =>
      count + (normalizeVisualEnvironmentName(frame.name) === 'document' ? 0 : 1),
    0,
  );
  const closingEnvironment = /^\\end\s*\{([^{}]+)\}/u.exec(trimmedLine)?.[1]?.trim();
  if (closingEnvironment !== undefined) {
    for (let index = environments.length - 1; index >= 0; index -= 1) {
      if (environments[index]?.name !== closingEnvironment) {
        continue;
      }
      depth = environments.slice(0, index).reduce(
        (count, frame) =>
          count + (normalizeVisualEnvironmentName(frame.name) === 'document' ? 0 : 1),
        0,
      );
      break;
    }
  }

  const delimiter = state.delimiter;
  if (delimiter?.kind === 'bracket') {
    return depth + (/^\\\]/u.test(trimmedLine) ? 0 : 1);
  }
  if (delimiter?.kind === 'dollar-block') {
    return depth + (/^\$\$/u.test(trimmedLine) ? 0 : 1);
  }
  return depth;
}

function visualPhysicalLineAt(
  source: string,
  lineFrom: number,
): { readonly contentTo: number; readonly lineTo: number } {
  let contentTo = lineFrom;
  while (
    contentTo < source.length &&
    source[contentTo] !== '\r' &&
    source[contentTo] !== '\n'
  ) {
    contentTo += 1;
  }
  if (contentTo >= source.length) {
    return { contentTo, lineTo: contentTo };
  }
  return {
    contentTo,
    lineTo: source.startsWith('\r\n', contentTo) ? contentTo + 2 : contentTo + 1,
  };
}
