/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  isMatrixEnvironment,
  scanLatexRegions,
  scanLatexSegment,
} from './latexScanner';
import { LatexMathRegion, TaboutOptions, TaboutPlan } from './types';
import { alignmentBoundaryLengthAt } from './alignmentBoundary';

type DelimiterKind =
  | 'brace'
  | 'parenthesis'
  | 'bracket'
  | 'angle'
  | 'vert'
  | 'double-vert'
  | 'ceil'
  | 'floor'
  | 'escaped-brace'
  | 'left-right'
  | 'math-paren'
  | 'math-bracket'
  | 'math-dollar-inline'
  | 'math-dollar-block';

interface DelimiterFrame {
  readonly id: number;
  readonly kind: DelimiterKind;
}

type StructuralToken =
  | { readonly kind: 'open'; readonly delimiter: DelimiterKind; readonly end: number }
  | { readonly kind: 'close'; readonly delimiter: DelimiterKind; readonly end: number }
  | { readonly kind: 'toggle'; readonly delimiter: DelimiterKind; readonly end: number }
  | { readonly kind: 'boundary' | 'comment' | 'opaque' | 'other'; readonly end: number };

const COMMAND_OPENERS = new Map<string, DelimiterKind>([
  ['langle', 'angle'],
  ['lvert', 'vert'],
  ['lVert', 'double-vert'],
  ['lceil', 'ceil'],
  ['lfloor', 'floor'],
  ['{', 'escaped-brace'],
  ['(', 'math-paren'],
  ['[', 'math-bracket'],
]);

const COMMAND_CLOSERS = new Map<string, DelimiterKind>([
  ['rangle', 'angle'],
  ['rvert', 'vert'],
  ['rVert', 'double-vert'],
  ['rceil', 'ceil'],
  ['rfloor', 'floor'],
  ['}', 'escaped-brace'],
  [')', 'math-paren'],
  [']', 'math-bracket'],
]);

const OPAQUE_ARGUMENT_COMMANDS = new Set([
  'text',
  'textrm',
  'textsf',
  'texttt',
  'textnormal',
  'textbf',
  'textmd',
  'textit',
  'textsl',
  'textsc',
  'textup',
  'emph',
  'mbox',
  'hbox',
  'intertext',
  'shortintertext',
]);

const SNIPPET_SUPPRESSION_COMMANDS = new Set(['label', 'tag']);

function readCommand(
  text: string,
  slashOffset: number,
): { readonly command: string; readonly end: number } {
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { command: '', end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/u.test(first)) {
    return { command: first, end: slashOffset + 2 };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/u.test(text[end]!)) {
    end += 1;
  }
  return { command: text.slice(slashOffset + 1, end), end };
}

function physicalLineEnd(text: string, from: number): number {
  let end = from;
  while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
    end += 1;
  }
  return end;
}

function readVerbEnd(text: string, commandEnd: number): number {
  let delimiterOffset = commandEnd;
  if (text[delimiterOffset] === '*') {
    delimiterOffset += 1;
  }
  const delimiter = text[delimiterOffset];
  if (delimiter === undefined || delimiter === '\n' || delimiter === '\r') {
    return commandEnd;
  }
  let end = delimiterOffset + 1;
  while (
    end < text.length &&
    text[end] !== delimiter &&
    text[end] !== '\n' &&
    text[end] !== '\r'
  ) {
    end += 1;
  }
  return text[end] === delimiter ? end + 1 : end;
}

function readSizingDelimiterEnd(
  text: string,
  commandEnd: number,
  recognizeAlignmentBoundaries: boolean,
): number | undefined {
  let delimiterStart = commandEnd;
  for (;;) {
    while (delimiterStart < text.length && /\s/u.test(text[delimiterStart]!)) {
      delimiterStart += 1;
    }
    if (text[delimiterStart] !== '%') {
      break;
    }
    delimiterStart = physicalLineEnd(text, delimiterStart);
  }
  const delimiter = text[delimiterStart];
  if (
    delimiter === undefined ||
    delimiter === '%' ||
    (recognizeAlignmentBoundaries &&
      alignmentBoundaryLengthAt(text, delimiterStart) > 0)
  ) {
    return undefined;
  }
  if (delimiter !== '\\') {
    return delimiterStart + 1;
  }
  const command = readCommand(text, delimiterStart);
  return command.end > delimiterStart + 1 ? command.end : undefined;
}

/** Skip one known text/annotation command's complete mandatory argument. */
function readOpaqueArgumentEnd(text: string, commandEnd: number, allowStar: boolean): number {
  let open = commandEnd;
  if (allowStar && text[open] === '*') {
    open += 1;
  }
  for (;;) {
    while (open < text.length && /\s/u.test(text[open]!)) {
      open += 1;
    }
    if (text[open] !== '%') {
      break;
    }
    open = physicalLineEnd(text, open);
  }
  if (text[open] !== '{') {
    return commandEnd;
  }

  let depth = 0;
  for (let index = open; index < text.length;) {
    const char = text[index]!;
    if (char === '%') {
      index = physicalLineEnd(text, index);
      continue;
    }
    if (char === '\\') {
      const command = readCommand(text, index);
      if (command.command === 'verb') {
        index = Math.max(index + 1, readVerbEnd(text, command.end));
      } else {
        index = Math.max(index + 1, command.end);
      }
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return text.length;
}

function structuralTokenAt(
  text: string,
  offset: number,
  recognizeAlignmentBoundaries: boolean,
  exposeSnippetSuppression: boolean,
): StructuralToken {
  if (recognizeAlignmentBoundaries) {
    const boundaryLength = alignmentBoundaryLengthAt(text, offset);
    if (boundaryLength > 0) {
      return { kind: 'boundary', end: offset + boundaryLength };
    }
  }

  const char = text[offset]!;
  if (char === '%') {
    return { kind: 'comment', end: physicalLineEnd(text, offset) };
  }
  if (char === '\\') {
    const command = readCommand(text, offset);
    if (command.command === 'verb') {
      return { kind: 'opaque', end: readVerbEnd(text, command.end) };
    }
    if (command.command === 'left') {
      const end = readSizingDelimiterEnd(
        text,
        command.end,
        recognizeAlignmentBoundaries,
      );
      return end === undefined
        ? { kind: 'other', end: command.end }
        : { kind: 'open', delimiter: 'left-right', end };
    }
    if (command.command === 'right') {
      const end = readSizingDelimiterEnd(
        text,
        command.end,
        recognizeAlignmentBoundaries,
      );
      return end === undefined
        ? { kind: 'other', end: command.end }
        : { kind: 'close', delimiter: 'left-right', end };
    }
    if (command.command === 'middle') {
      return {
        kind: 'other',
        end: readSizingDelimiterEnd(
          text,
          command.end,
          recognizeAlignmentBoundaries,
        ) ?? command.end,
      };
    }
    const opener = COMMAND_OPENERS.get(command.command);
    if (opener !== undefined) {
      return { kind: 'open', delimiter: opener, end: command.end };
    }
    const closer = COMMAND_CLOSERS.get(command.command);
    if (closer !== undefined) {
      return { kind: 'close', delimiter: closer, end: command.end };
    }
    if (OPAQUE_ARGUMENT_COMMANDS.has(command.command)) {
      return {
        kind: 'opaque',
        end: readOpaqueArgumentEnd(text, command.end, command.command === 'tag'),
      };
    }
    if (SNIPPET_SUPPRESSION_COMMANDS.has(command.command)) {
      return exposeSnippetSuppression
        ? { kind: 'other', end: command.end }
        : {
            kind: 'opaque',
            end: readOpaqueArgumentEnd(text, command.end, command.command === 'tag'),
          };
    }
    return { kind: 'other', end: Math.max(offset + 1, command.end) };
  }

  if (char === '{') {
    return { kind: 'open', delimiter: 'brace', end: offset + 1 };
  }
  if (char === '}') {
    return { kind: 'close', delimiter: 'brace', end: offset + 1 };
  }
  if (char === '(') {
    return { kind: 'open', delimiter: 'parenthesis', end: offset + 1 };
  }
  if (char === ')') {
    return { kind: 'close', delimiter: 'parenthesis', end: offset + 1 };
  }
  if (char === '[') {
    return { kind: 'open', delimiter: 'bracket', end: offset + 1 };
  }
  if (char === ']') {
    return { kind: 'close', delimiter: 'bracket', end: offset + 1 };
  }
  if (char === '$') {
    if (text[offset + 1] === '$') {
      return { kind: 'toggle', delimiter: 'math-dollar-block', end: offset + 2 };
    }
    return { kind: 'toggle', delimiter: 'math-dollar-inline', end: offset + 1 };
  }
  return { kind: 'other', end: offset + 1 };
}

function innermostRegionAt(text: string, cursorOffset: number): LatexMathRegion | undefined {
  let result: LatexMathRegion | undefined;
  for (const region of scanLatexRegions(text)) {
    if (cursorOffset < region.innerStart || cursorOffset > region.innerEnd) {
      continue;
    }
    if (
      result === undefined ||
      region.innerEnd - region.innerStart < result.innerEnd - result.innerStart
    ) {
      result = region;
    }
  }
  return result;
}

function openingSyntaxLength(kind: DelimiterKind): number {
  return kind === 'math-dollar-inline' ? 1 : 2;
}

function localMathDelimiterKind(
  kind: 'dollar-inline' | 'dollar-block' | 'paren' | 'bracket',
): DelimiterKind {
  switch (kind) {
    case 'dollar-inline':
      return 'math-dollar-inline';
    case 'dollar-block':
      return 'math-dollar-block';
    case 'paren':
      return 'math-paren';
    case 'bracket':
      return 'math-bracket';
  }
}

/**
 * Plan Snippet Leaf-style Tabout. A closer is eligible only when it closes the
 * innermost delimiter already open at the caret. Future, unrelated command
 * arguments must never steal Tab from an align/matrix cell.
 */
export function planTabout(
  text: string,
  cursorOffset: number,
  options: TaboutOptions = {},
): TaboutPlan | undefined {
  if (!Number.isInteger(cursorOffset) || cursorOffset < 0 || cursorOffset > text.length) {
    return undefined;
  }

  const inferredRegion = options.innerEnd === undefined
    ? innermostRegionAt(text, cursorOffset)
    : undefined;
  if (options.innerEnd === undefined && inferredRegion === undefined) {
    return undefined;
  }

  const cursorState = scanLatexSegment(text.slice(0, cursorOffset));
  if (
    cursorState.inComment ||
    cursorState.verbatimDelimiter !== undefined ||
    cursorState.verbatimEnvironment !== undefined ||
    cursorState.pendingSnippetSuppression !== undefined ||
    cursorState.pendingTextArgument !== undefined
  ) {
    return undefined;
  }

  const activeTextArgument = cursorState.textArguments[cursorState.textArguments.length - 1];
  const localMathDelimiter = activeTextArgument?.delimiter;
  if (activeTextArgument !== undefined && localMathDelimiter === undefined) {
    return undefined;
  }

  const inferredInnerStart = inferredRegion?.innerStart ?? 0;
  let innerStart = Math.max(
    0,
    Math.min(options.innerStart ?? inferredInnerStart, cursorOffset),
  );
  const innerEnd = Math.max(
    cursorOffset,
    Math.min(options.innerEnd ?? inferredRegion?.innerEnd ?? cursorOffset, text.length),
  );
  const outerEnd = Math.max(
    innerEnd,
    Math.min(options.outerEnd ?? inferredRegion?.outerEnd ?? innerEnd, text.length),
  );
  const arrayMode = options.arrayMode ?? (
    inferredRegion?.environmentName !== undefined &&
    isMatrixEnvironment(inferredRegion.environmentName)
  );
  // Inside `\label{...}`/`\tag{...}`, snippets stay disabled but the outer
  // mandatory brace remains a real local Tabout target. Its contents are not
  // an alignment list, even when the command appears inside `align`.
  const exposeSnippetSuppression = cursorState.snippetSuppression !== undefined;
  // Unescaped TeX alignment tokens are hard structural boundaries regardless
  // of whether the user enabled matrix shortcuts for the surrounding custom
  // environment. The setting controls insertion/exit behavior, not whether a
  // delimiter from another cell or row may be claimed.
  const recognizeAlignmentBoundaries = !exposeSnippetSuppression;

  const stack: DelimiterFrame[] = [];
  let nextFrameId = 1;
  let localFrameId: number | undefined;
  if (localMathDelimiter !== undefined) {
    const delimiter = localMathDelimiterKind(localMathDelimiter.kind);
    innerStart = Math.max(
      innerStart,
      localMathDelimiter.startOffset + openingSyntaxLength(delimiter),
    );
    localFrameId = nextFrameId;
    stack.push({ id: nextFrameId, kind: delimiter });
    nextFrameId += 1;
  }

  let prefixMalformed = false;
  for (let index = innerStart; index < cursorOffset;) {
    const token = structuralTokenAt(
      text,
      index,
      recognizeAlignmentBoundaries,
      exposeSnippetSuppression,
    );
    if (token.end > cursorOffset) {
      return undefined;
    }
    if (token.kind === 'boundary') {
      stack.length = 0;
      prefixMalformed = false;
      localFrameId = undefined;
      index = token.end;
      continue;
    }
    if (token.kind === 'open') {
      stack.push({ id: nextFrameId, kind: token.delimiter });
      nextFrameId += 1;
    } else if (token.kind === 'toggle') {
      const top = stack[stack.length - 1];
      if (top?.kind === token.delimiter) {
        stack.pop();
      } else {
        stack.push({ id: nextFrameId, kind: token.delimiter });
        nextFrameId += 1;
      }
    } else if (token.kind === 'close') {
      const top = stack[stack.length - 1];
      if (top?.kind !== token.delimiter) {
        prefixMalformed = true;
      } else {
        stack.pop();
      }
    }
    index = Math.max(index + 1, token.end);
  }

  if (prefixMalformed) {
    return undefined;
  }

  const target = stack[stack.length - 1];
  if (target !== undefined) {
    for (let index = cursorOffset; index < innerEnd;) {
      const token = structuralTokenAt(
        text,
        index,
        recognizeAlignmentBoundaries,
        exposeSnippetSuppression,
      );
      if (token.kind === 'boundary') {
        return undefined;
      }
      if (token.kind === 'open') {
        stack.push({ id: nextFrameId, kind: token.delimiter });
        nextFrameId += 1;
      } else if (token.kind === 'toggle') {
        const top = stack[stack.length - 1];
        if (top?.kind === token.delimiter) {
          const closed = stack.pop();
          if (closed?.id === target.id) {
            return {
              kind: 'closing-delimiter',
              from: cursorOffset,
              to: token.end,
              skippedText: text.slice(cursorOffset, token.end),
            };
          }
        } else {
          stack.push({ id: nextFrameId, kind: token.delimiter });
          nextFrameId += 1;
        }
      } else if (token.kind === 'close') {
        const top = stack[stack.length - 1];
        if (top?.kind !== token.delimiter) {
          return undefined;
        }
        const closed = stack.pop();
        if (closed?.id === target.id) {
          return {
            kind: 'closing-delimiter',
            from: cursorOffset,
            to: token.end,
            skippedText: text.slice(cursorOffset, token.end),
          };
        }
      }
      index = Math.max(index + 1, token.end);
    }
    return undefined;
  }

  if (
    localFrameId === undefined &&
    !arrayMode &&
    (inferredRegion?.closed ?? outerEnd > innerEnd) &&
    outerEnd > innerEnd &&
    text.slice(cursorOffset, innerEnd).trim().length === 0
  ) {
    return {
      kind: 'math-delimiter',
      from: cursorOffset,
      to: outerEnd,
      skippedText: text.slice(cursorOffset, outerEnd),
    };
  }

  return undefined;
}
