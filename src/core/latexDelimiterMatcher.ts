/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { alignmentBoundaryLengthAt } from './alignmentBoundary';

export interface LatexDelimiterRange {
  readonly from: number;
  readonly to: number;
}

export interface LatexDelimiterPair {
  readonly first: LatexDelimiterRange;
  readonly second: LatexDelimiterRange;
}

export interface LatexDelimiterMatch {
  /** A semantic token or an intentionally opaque range owns the caret. */
  readonly touched: boolean;
  /** Undefined means the touched token is currently incomplete or unmatched. */
  readonly pair?: LatexDelimiterPair;
}

interface ScannedDelimiterToken extends LatexDelimiterRange {
  readonly role: 'open' | 'close' | 'middle';
  readonly family: string;
  /**
   * Disjoint delimiter glyphs that also activate/block this logical token.
   *
   * `\\left % comment\n (` must not paint or activate the intervening trivia,
   * but clicking its eventual `(` must still resolve the `\\left` pair.  The
   * primary range remains the compact command range; these aliases provide the
   * second hit target without turning the whole comment into one DOM Range.
   */
  readonly touchRanges: readonly LatexDelimiterRange[];
  pairIndex?: number;
}

export interface LatexDelimiterScan {
  readonly tokens: readonly ScannedDelimiterToken[];
  readonly pairs: readonly LatexDelimiterPair[];
  readonly opaqueRanges: readonly LatexDelimiterRange[];
}

interface DelimiterFrame {
  readonly tokenIndex: number;
  readonly family: string;
  readonly scopeId: number;
  readonly environmentId: number;
  readonly alignmentContextId: number;
  readonly middleTokenIndices: number[];
}

interface EnvironmentFrame {
  readonly id: number;
  readonly name: string;
  readonly scopeId: number;
  readonly alignmentContextId: number;
}

interface ControlSequence {
  readonly command: string;
  readonly end: number;
}

interface SizingDelimiter {
  readonly from: number;
  readonly to: number;
}

interface EnvironmentCommand {
  readonly name: string;
  readonly to: number;
}

const SIMPLE_DELIMITERS = new Set(['(', ')', '[', ']', '.', '|', '/', '<', '>']);

const COMMAND_DELIMITERS = new Set([
  '{',
  '}',
  '|',
  'backslash',
  'langle',
  'rangle',
  'vert',
  'Vert',
  'lvert',
  'rvert',
  'lVert',
  'rVert',
  'lfloor',
  'rfloor',
  'lceil',
  'rceil',
  'lgroup',
  'rgroup',
  'lmoustache',
  'rmoustache',
  'arrowvert',
  'Arrowvert',
  'uparrow',
  'downarrow',
  'updownarrow',
  'Uparrow',
  'Downarrow',
  'Updownarrow',
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

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim',
  'verbatim*',
  'Verbatim',
  'Verbatim*',
  'lstlisting',
  'lstlisting*',
  'minted',
]);

/** Environments whose `&` / row separators belong to a nested alignment list. */
const ALIGNMENT_ENVIRONMENTS = new Set([
  'align',
  'align*',
  'aligned',
  'alignedat',
  'alignat',
  'alignat*',
  'flalign',
  'flalign*',
  'eqnarray',
  'eqnarray*',
  'array',
  'matrix',
  'matrix*',
  'pmatrix',
  'pmatrix*',
  'bmatrix',
  'bmatrix*',
  'Bmatrix',
  'Bmatrix*',
  'vmatrix',
  'vmatrix*',
  'Vmatrix',
  'Vmatrix*',
  'smallmatrix',
  'smallmatrix*',
  'cases',
  'cases*',
  'dcases',
  'dcases*',
  'rcases',
  'rcases*',
  'split',
  'gather',
  'gather*',
  'gathered',
  'multline',
  'multline*',
  'subarray',
  'tabular',
  'tabular*',
  'tabularx',
  'longtable',
]);

const FIXED_SIZE_OPENERS = new Map<string, string>([
  ['bigl', 'sized'],
  ['Bigl', 'sized'],
  ['biggl', 'sized'],
  ['Biggl', 'sized'],
]);

const FIXED_SIZE_CLOSERS = new Map<string, string>([
  ['bigr', 'sized'],
  ['Bigr', 'sized'],
  ['biggr', 'sized'],
  ['Biggr', 'sized'],
]);

const BARE_COMMAND_OPENERS = new Map<string, string>([
  ['{', 'bare:brace'],
  ['langle', 'bare:angle'],
  ['lvert', 'bare:vert'],
  ['lVert', 'bare:double-vert'],
  ['lceil', 'bare:ceil'],
  ['lfloor', 'bare:floor'],
]);

const BARE_COMMAND_CLOSERS = new Map<string, string>([
  ['}', 'bare:brace'],
  ['rangle', 'bare:angle'],
  ['rvert', 'bare:vert'],
  ['rVert', 'bare:double-vert'],
  ['rceil', 'bare:ceil'],
  ['rfloor', 'bare:floor'],
]);

/**
 * Scan semantic LaTeX delimiter commands in one pass.
 *
 * Literal `()[]{}` remain CodeMirror's responsibility. This index covers the
 * pieces that a character matcher cannot understand: complete `\left` /
 * `\right` atoms, manually sized l/r atoms, and directional delimiter
 * commands. It deliberately keeps malformed tokens in the index so a touched
 * `\left` cannot fall through and misleadingly match an unrelated literal
 * bracket.
 */
export function scanLatexDelimiterPairs(text: string): LatexDelimiterScan {
  const tokens: ScannedDelimiterToken[] = [];
  const pairs: LatexDelimiterPair[] = [];
  const opaqueRanges: LatexDelimiterRange[] = [];
  const stack: DelimiterFrame[] = [];
  const scopeStack: number[] = [0];
  const environmentStack: EnvironmentFrame[] = [];
  let nextScopeId = 1;
  let nextEnvironmentId = 1;
  let nextAlignmentContextId = 1;
  let index = 0;

  const currentScope = (): number => scopeStack[scopeStack.length - 1] ?? 0;
  const currentEnvironmentId = (): number =>
    environmentStack[environmentStack.length - 1]?.id ?? 0;
  const currentAlignmentContextId = (): number =>
    environmentStack[environmentStack.length - 1]?.alignmentContextId ?? 0;
  const addOpaqueRange = (range: LatexDelimiterRange): void => {
    if (range.to > range.from) {
      opaqueRanges.push(range);
    }
  };
  const addToken = (
    from: number,
    to: number,
    role: ScannedDelimiterToken['role'],
    family: string,
    touchRanges: readonly LatexDelimiterRange[] = [],
  ): number => {
    tokens.push({ from, to, role, family, touchRanges });
    return tokens.length - 1;
  };
  const addSizingToken = (
    commandFrom: number,
    commandEnd: number,
    delimiter: SizingDelimiter | undefined,
    role: ScannedDelimiterToken['role'],
    family: string,
  ): number => delimiter === undefined || delimiter.from === commandEnd
    ? addToken(
      commandFrom,
      delimiter?.to ?? commandEnd,
      role,
      family,
    )
    : addToken(
      commandFrom,
      commandEnd,
      role,
      family,
      [delimiter],
    );
  const openToken = (tokenIndex: number, family: string): void => {
    stack.push({
      tokenIndex,
      family,
      scopeId: currentScope(),
      environmentId: currentEnvironmentId(),
      alignmentContextId: currentAlignmentContextId(),
      middleTokenIndices: [],
    });
  };
  const closeToken = (tokenIndex: number, family: string): void => {
    const frame = stack[stack.length - 1];
    if (
      frame === undefined ||
      frame.family !== family ||
      frame.scopeId !== currentScope() ||
      frame.environmentId !== currentEnvironmentId() ||
      frame.alignmentContextId !== currentAlignmentContextId()
    ) {
      return;
    }
    stack.pop();
    const open = tokens[frame.tokenIndex];
    const close = tokens[tokenIndex];
    if (open === undefined || close === undefined) {
      return;
    }
    const pairIndex = pairs.length;
    pairs.push({
      first: { from: open.from, to: open.to },
      second: { from: close.from, to: close.to },
    });
    open.pairIndex = pairIndex;
    close.pairIndex = pairIndex;
    for (const middleTokenIndex of frame.middleTokenIndices) {
      const middle = tokens[middleTokenIndex];
      if (middle !== undefined) {
        middle.pairIndex = pairIndex;
      }
    }
  };
  const discardFrames = (predicate: (frame: DelimiterFrame) => boolean): void => {
    for (let frameIndex = stack.length - 1; frameIndex >= 0; frameIndex -= 1) {
      const frame = stack[frameIndex];
      if (frame !== undefined && predicate(frame)) {
        stack.splice(frameIndex, 1);
      }
    }
  };
  const closeEnvironment = (name: string): void => {
    let environmentIndex = environmentStack.length - 1;
    while (environmentIndex >= 0 && environmentStack[environmentIndex]?.name !== name) {
      environmentIndex -= 1;
    }
    if (environmentIndex < 0) {
      // A stray/mismatched environment boundary must not allow a delimiter to
      // appear structurally valid across it.
      stack.length = 0;
      return;
    }
    const removedIds = new Set(
      environmentStack.slice(environmentIndex).map((environment) => environment.id),
    );
    discardFrames((frame) => removedIds.has(frame.environmentId));
    environmentStack.length = environmentIndex;
  };

  while (index < text.length) {
    const boundaryLength = alignmentBoundaryLengthAt(text, index);
    if (boundaryLength > 0) {
      const boundaryContextId = currentAlignmentContextId();
      discardFrames((frame) => frame.alignmentContextId === boundaryContextId);
      index += boundaryLength;
      continue;
    }

    const character = text[index]!;
    if (character === '%') {
      const end = physicalLineEnd(text, index);
      opaqueRanges.push({ from: index, to: end });
      index = end;
      continue;
    }
    if (character === '{') {
      scopeStack.push(nextScopeId);
      nextScopeId += 1;
      index += 1;
      continue;
    }
    if (character === '}') {
      const closingScope = currentScope();
      discardFrames((frame) => frame.scopeId === closingScope);
      let environmentIndex = environmentStack.length - 1;
      while (
        environmentIndex >= 0 &&
        environmentStack[environmentIndex]?.scopeId === closingScope
      ) {
        environmentIndex -= 1;
      }
      environmentStack.length = environmentIndex + 1;
      if (scopeStack.length > 1) {
        scopeStack.pop();
      }
      index += 1;
      continue;
    }
    if (character === '$') {
      stack.length = 0;
      index += text[index + 1] === '$' ? 2 : 1;
      continue;
    }
    if (character !== '\\') {
      index += 1;
      continue;
    }

    const control = readCommand(text, index);
    if (control.command === 'verb') {
      const end = Math.max(index + 1, readVerbEnd(text, control.end));
      opaqueRanges.push({ from: index, to: end });
      index = end;
      continue;
    }
    if (OPAQUE_ARGUMENT_COMMANDS.has(control.command)) {
      const end = Math.max(
        index + 1,
        readOpaqueArgumentEnd(text, control.end),
      );
      collectSuppressedSemanticTokens(
        text,
        control.end,
        end,
        addToken,
        addOpaqueRange,
      );
      index = end;
      continue;
    }

    if (control.command === 'begin' || control.command === 'end') {
      const environment = readEnvironmentCommand(
        text,
        control.end,
        addOpaqueRange,
      );
      if (environment === undefined) {
        index = Math.max(index + 1, control.end);
        continue;
      }
      if (control.command === 'end') {
        closeEnvironment(environment.name);
        index = environment.to;
        continue;
      }
      if (VERBATIM_ENVIRONMENTS.has(environment.name)) {
        const closing = findVerbatimEnvironmentEnd(
          text,
          environment.to,
          environment.name,
        );
        addOpaqueRange({
          from: environment.to,
          to: closing?.from ?? text.length,
        });
        index = closing?.to ?? text.length;
        continue;
      }
      environmentStack.push({
        id: nextEnvironmentId,
        name: environment.name,
        scopeId: currentScope(),
        alignmentContextId: ALIGNMENT_ENVIRONMENTS.has(environment.name)
          ? nextAlignmentContextId
          : currentAlignmentContextId(),
      });
      nextEnvironmentId += 1;
      if (ALIGNMENT_ENVIRONMENTS.has(environment.name)) {
        nextAlignmentContextId += 1;
      }
      index = environment.to;
      continue;
    }
    if (
      control.command === '(' ||
      control.command === ')' ||
      control.command === '[' ||
      control.command === ']'
    ) {
      stack.length = 0;
      index = control.end;
      continue;
    }

    if (control.command === 'left' || control.command === 'right') {
      const delimiter = readSizingDelimiter(text, control.end, addOpaqueRange);
      const to = delimiter?.to ?? control.end;
      const role = control.command === 'left' ? 'open' : 'close';
      const tokenIndex = addSizingToken(
        index,
        control.end,
        delimiter,
        role,
        'left-right',
      );
      if (role === 'open') {
        openToken(tokenIndex, 'left-right');
      } else {
        closeToken(tokenIndex, 'left-right');
      }
      index = Math.max(index + 1, to);
      continue;
    }

    if (control.command === 'middle') {
      const delimiter = readSizingDelimiter(text, control.end, addOpaqueRange);
      const to = delimiter?.to ?? control.end;
      const tokenIndex = addSizingToken(
        index,
        control.end,
        delimiter,
        'middle',
        'left-right',
      );
      for (let frameIndex = stack.length - 1; frameIndex >= 0; frameIndex -= 1) {
        const frame = stack[frameIndex];
        if (
          frame?.family === 'left-right' &&
          frame.scopeId === currentScope() &&
          frame.environmentId === currentEnvironmentId() &&
          frame.alignmentContextId === currentAlignmentContextId()
        ) {
          frame.middleTokenIndices.push(tokenIndex);
          break;
        }
      }
      index = Math.max(index + 1, to);
      continue;
    }

    const fixedOpenFamily = FIXED_SIZE_OPENERS.get(control.command);
    if (fixedOpenFamily !== undefined) {
      const delimiter = readSizingDelimiter(text, control.end, addOpaqueRange);
      const to = delimiter?.to ?? control.end;
      const tokenIndex = addSizingToken(
        index,
        control.end,
        delimiter,
        'open',
        fixedOpenFamily,
      );
      openToken(tokenIndex, fixedOpenFamily);
      index = Math.max(index + 1, to);
      continue;
    }
    const fixedCloseFamily = FIXED_SIZE_CLOSERS.get(control.command);
    if (fixedCloseFamily !== undefined) {
      const delimiter = readSizingDelimiter(text, control.end, addOpaqueRange);
      const to = delimiter?.to ?? control.end;
      const tokenIndex = addSizingToken(
        index,
        control.end,
        delimiter,
        'close',
        fixedCloseFamily,
      );
      closeToken(tokenIndex, fixedCloseFamily);
      index = Math.max(index + 1, to);
      continue;
    }

    const bareOpenFamily = BARE_COMMAND_OPENERS.get(control.command);
    if (bareOpenFamily !== undefined) {
      const tokenIndex = addToken(index, control.end, 'open', bareOpenFamily);
      openToken(tokenIndex, bareOpenFamily);
      index = control.end;
      continue;
    }
    const bareCloseFamily = BARE_COMMAND_CLOSERS.get(control.command);
    if (bareCloseFamily !== undefined) {
      const tokenIndex = addToken(index, control.end, 'close', bareCloseFamily);
      closeToken(tokenIndex, bareCloseFamily);
      index = control.end;
      continue;
    }

    index = Math.max(index + 1, control.end);
  }

  return { tokens, pairs, opaqueRanges };
}

/** Resolve the semantic token touching a caret, preferring a token that starts there. */
export function latexDelimiterPairAt(
  scan: LatexDelimiterScan,
  caret: number,
): LatexDelimiterMatch {
  if (!Number.isSafeInteger(caret) || caret < 0) {
    return { touched: false };
  }
  const candidates = scan.tokens
    .filter((token) =>
      rangeTouchesCaret(token, caret) ||
      token.touchRanges.some((range) => rangeTouchesCaret(range, caret))
    )
    .sort((left, right) =>
      Number(right.from === caret) - Number(left.from === caret) ||
      Number(right.to === caret) - Number(left.to === caret) ||
      left.to - left.from - (right.to - right.from) ||
      right.from - left.from
    );
  const token = candidates[0];
  if (token === undefined) {
    return scan.opaqueRanges.some((range) => caret >= range.from && caret <= range.to)
      ? { touched: true }
      : { touched: false };
  }
  const pair = token.pairIndex === undefined
    ? undefined
    : scan.pairs[token.pairIndex];
  return pair === undefined
    ? { touched: true }
    : { touched: true, pair };
}

/** True when a literal CodeMirror bracket range belongs to a semantic atom. */
export function latexDelimiterTokenOverlaps(
  scan: LatexDelimiterScan,
  from: number,
  to: number,
): boolean {
  return scan.tokens.some((token) =>
    rangesOverlap(token, from, to) ||
    token.touchRanges.some((range) => rangesOverlap(range, from, to))
  );
}

function rangeTouchesCaret(range: LatexDelimiterRange, caret: number): boolean {
  return caret >= range.from && caret <= range.to;
}

function rangesOverlap(
  range: LatexDelimiterRange,
  from: number,
  to: number,
): boolean {
  return from < range.to && to > range.from;
}

function readCommand(text: string, slashOffset: number): ControlSequence {
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

function readSizingDelimiter(
  text: string,
  commandEnd: number,
  onOpaqueRange?: (range: LatexDelimiterRange) => void,
): SizingDelimiter | undefined {
  let delimiterStart = commandEnd;
  for (;;) {
    while (delimiterStart < text.length && /\s/u.test(text[delimiterStart]!)) {
      delimiterStart += 1;
    }
    if (text[delimiterStart] !== '%') {
      break;
    }
    const commentEnd = physicalLineEnd(text, delimiterStart);
    onOpaqueRange?.({ from: delimiterStart, to: commentEnd });
    delimiterStart = commentEnd;
  }
  if (
    delimiterStart >= text.length ||
    alignmentBoundaryLengthAt(text, delimiterStart) > 0
  ) {
    return undefined;
  }
  const delimiter = text[delimiterStart]!;
  if (delimiter !== '\\') {
    return SIMPLE_DELIMITERS.has(delimiter)
      ? { from: delimiterStart, to: delimiterStart + 1 }
      : undefined;
  }
  const control = readCommand(text, delimiterStart);
  return COMMAND_DELIMITERS.has(control.command)
    ? { from: delimiterStart, to: control.end }
    : undefined;
}

function collectSuppressedSemanticTokens(
  text: string,
  from: number,
  to: number,
  addToken: (
    from: number,
    to: number,
    role: ScannedDelimiterToken['role'],
    family: string,
    touchRanges?: readonly LatexDelimiterRange[],
  ) => number,
  addOpaqueRange: (range: LatexDelimiterRange) => void,
): void {
  let index = from;
  const addSizingToken = (
    commandFrom: number,
    commandEnd: number,
    delimiter: SizingDelimiter | undefined,
    role: ScannedDelimiterToken['role'],
    family: string,
  ): void => {
    if (delimiter === undefined || delimiter.from === commandEnd) {
      addToken(
        commandFrom,
        Math.min(to, delimiter?.to ?? commandEnd),
        role,
        family,
      );
      return;
    }
    addToken(
      commandFrom,
      commandEnd,
      role,
      family,
      delimiter.from < to
        ? [{ from: delimiter.from, to: Math.min(to, delimiter.to) }]
        : [],
    );
  };

  while (index < to) {
    const boundaryLength = alignmentBoundaryLengthAt(text, index);
    if (boundaryLength > 0) {
      index += boundaryLength;
      continue;
    }
    const character = text[index]!;
    if (character === '%') {
      const commentEnd = Math.min(to, physicalLineEnd(text, index));
      addOpaqueRange({ from: index, to: commentEnd });
      index = commentEnd;
      continue;
    }
    if (character !== '\\') {
      index += 1;
      continue;
    }
    const control = readCommand(text, index);
    if (control.command === 'verb') {
      const verbEnd = Math.min(to, Math.max(index + 1, readVerbEnd(text, control.end)));
      addOpaqueRange({ from: index, to: verbEnd });
      index = verbEnd;
      continue;
    }
    const fixedOpenFamily = FIXED_SIZE_OPENERS.get(control.command);
    const fixedCloseFamily = FIXED_SIZE_CLOSERS.get(control.command);
    const role = control.command === 'left' || fixedOpenFamily !== undefined
      ? 'open'
      : control.command === 'right' || fixedCloseFamily !== undefined
        ? 'close'
        : control.command === 'middle'
          ? 'middle'
          : undefined;
    if (role !== undefined) {
      const delimiter = readSizingDelimiter(text, control.end, addOpaqueRange);
      const family = fixedOpenFamily ?? fixedCloseFamily ?? 'left-right';
      addSizingToken(index, control.end, delimiter, role, family);
      index = Math.min(to, Math.max(index + 1, delimiter?.to ?? control.end));
      continue;
    }
    index = Math.min(to, Math.max(index + 1, control.end));
  }
}

function readEnvironmentCommand(
  text: string,
  commandEnd: number,
  onOpaqueRange?: (range: LatexDelimiterRange) => void,
): EnvironmentCommand | undefined {
  let open = commandEnd;
  for (;;) {
    while (open < text.length && /\s/u.test(text[open]!)) {
      open += 1;
    }
    if (text[open] !== '%') {
      break;
    }
    const commentEnd = physicalLineEnd(text, open);
    onOpaqueRange?.({ from: open, to: commentEnd });
    open = commentEnd;
  }
  if (text[open] !== '{') {
    return undefined;
  }
  const close = text.indexOf('}', open + 1);
  if (close < 0) {
    return undefined;
  }
  const name = text.slice(open + 1, close).trim();
  if (name.length === 0 || /[{}%\r\n]/u.test(name)) {
    return undefined;
  }
  return { name, to: close + 1 };
}

function findVerbatimEnvironmentEnd(
  text: string,
  from: number,
  name: string,
): LatexDelimiterRange | undefined {
  let searchFrom = from;
  for (;;) {
    const candidate = text.indexOf('\\', searchFrom);
    if (candidate < 0) {
      return undefined;
    }
    const control = readCommand(text, candidate);
    if (control.command === 'end') {
      const environment = readEnvironmentCommand(text, control.end);
      if (environment?.name === name) {
        return { from: candidate, to: environment.to };
      }
    }
    searchFrom = Math.max(candidate + 1, control.end);
  }
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

function readOpaqueArgumentEnd(text: string, commandEnd: number): number {
  let open = commandEnd;
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
    const character = text[index]!;
    if (character === '%') {
      index = physicalLineEnd(text, index);
      continue;
    }
    if (character === '\\') {
      const control = readCommand(text, index);
      if (control.command === 'verb') {
        index = Math.max(index + 1, readVerbEnd(text, control.end));
      } else {
        index = Math.max(index + 1, control.end);
      }
      continue;
    }
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return text.length;
}
