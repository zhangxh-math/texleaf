/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  AutoEnlargeOptions,
  EnlargeBracketPlan,
  EnlargeCloseBracket,
  EnlargeOpenBracket,
  OffsetRange,
} from './types';
import { alignmentBoundaryLengthAt } from './alignmentBoundary';

const DEFAULT_TRIGGERS = [
  '\\frac',
  '\\binom',
  '\\sum',
  '\\prod',
  '\\int',
  '\\lim',
] as const;
const MAX_AUTO_ENLARGE_ANCESTORS = 64;

interface BracketSpec {
  readonly open: EnlargeOpenBracket;
  readonly close: EnlargeCloseBracket;
}

interface OpenFrame extends BracketSpec {
  readonly offset: number;
  readonly end: number;
  readonly scopeId: number;
}

interface BracketPair extends OpenFrame {
  readonly closeOffset: number;
  readonly closeEnd: number;
}

const COMMAND_BRACKETS: readonly BracketSpec[] = [
  { open: '\\langle', close: '\\rangle' },
  { open: '\\lvert', close: '\\rvert' },
  { open: '\\lVert', close: '\\rVert' },
  { open: '\\lceil', close: '\\rceil' },
  { open: '\\lfloor', close: '\\rfloor' },
  { open: '\\{', close: '\\}' },
];

const PLAIN_BRACKETS: readonly BracketSpec[] = [
  { open: '(', close: ')' },
  { open: '[', close: ']' },
];

const OPEN_COMMANDS = [...COMMAND_BRACKETS].sort((left, right) => right.open.length - left.open.length);
const CLOSE_COMMANDS = [...COMMAND_BRACKETS].sort((left, right) => right.close.length - left.close.length);

// The upstream extension treats all standard TeX sizing commands as an
// existing decoration. Whitespace between a modifier and delimiter is allowed.
const SIZE_MODIFIER_AT_END = /\\(?:left|right|big[lr]?|Big[lr]?|bigg[lr]?|Bigg[lr]?)(?:(?:[ \t\r\n])|%(?:[^\r\n]*)(?:\r\n|\r|\n|$))*$/;

function isEscaped(text: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    count += 1;
  }
  return count % 2 === 1;
}

function clampRange(range: OffsetRange | undefined, textLength: number): OffsetRange {
  const start = Math.max(0, Math.min(range?.start ?? 0, textLength));
  const end = Math.max(start, Math.min(range?.end ?? textLength, textLength));
  return { start, end };
}

function commandAt<T extends BracketSpec>(
  text: string,
  offset: number,
  specs: readonly T[],
  field: 'open' | 'close',
): T | undefined {
  return specs.find((spec) => {
    const command = spec[field];
    if (!text.startsWith(command, offset)) {
      return false;
    }
    const final = command[command.length - 1];
    return final === undefined || !/[A-Za-z@]/u.test(final) ||
      !/[A-Za-z@]/u.test(text[offset + command.length] ?? '');
  });
}

function verbEndAt(text: string, offset: number, limit: number): number | undefined {
  if (!text.startsWith('\\verb', offset)) {
    return undefined;
  }
  let delimiterOffset = offset + '\\verb'.length;
  if (text[delimiterOffset] === '*') {
    delimiterOffset += 1;
  }
  if (/[A-Za-z@]/u.test(text[delimiterOffset] ?? '')) {
    return undefined;
  }
  const delimiter = text[delimiterOffset];
  if (delimiter === undefined || delimiter === '\r' || delimiter === '\n') {
    return undefined;
  }
  const end = text.indexOf(delimiter, delimiterOffset + 1);
  return end < 0 || end >= limit ? limit : end + 1;
}

function scanBracketPairs(text: string, bounds: OffsetRange): readonly BracketPair[] {
  const pairs: BracketPair[] = [];
  const openFrames: OpenFrame[] = [];
  const scopeStack: number[] = [0];
  let nextScopeId = 1;
  let inComment = false;
  let index = bounds.start;
  const currentScope = (): number => scopeStack[scopeStack.length - 1] ?? 0;

  const closeFrame = (spec: BracketSpec, closeOffset: number, closeEnd: number): void => {
    const scopeId = currentScope();
    for (let frameIndex = openFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
      const frame = openFrames[frameIndex];
      if (frame === undefined || frame.close !== spec.close || frame.scopeId !== scopeId) {
        continue;
      }
      openFrames.splice(frameIndex, 1);
      pairs.push({ ...frame, closeOffset, closeEnd });
      return;
    }
  };

  while (index < bounds.end) {
    const char = text[index];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }
    if (char === '%' && !isEscaped(text, index)) {
      inComment = true;
      index += 1;
      continue;
    }

    const boundaryLength = alignmentBoundaryLengthAt(text, index);
    if (boundaryLength > 0) {
      // TeX alignment cells and rows are separate math lists. Preserve pairs
      // that already closed on either side, but never match an opening
      // delimiter from any brace scope with a closer across `&` or a row
      // command. A boundary inside `{...}` still ends the surrounding cell.
      openFrames.length = 0;
      index += boundaryLength;
      continue;
    }

    if (char === '\\') {
      const verbEnd = verbEndAt(text, index, bounds.end);
      if (verbEnd !== undefined) {
        index = verbEnd;
        continue;
      }
      const closingSpec = commandAt(text, index, CLOSE_COMMANDS, 'close');
      if (closingSpec !== undefined) {
        closeFrame(closingSpec, index, index + closingSpec.close.length);
        index += closingSpec.close.length;
        continue;
      }
      const openingSpec = commandAt(text, index, OPEN_COMMANDS, 'open');
      if (openingSpec !== undefined) {
        openFrames.push({
          ...openingSpec,
          offset: index,
          end: index + openingSpec.open.length,
          scopeId: currentScope(),
        });
        index += openingSpec.open.length;
        continue;
      }
    }

    if (!isEscaped(text, index) && char === '{') {
      scopeStack.push(nextScopeId);
      nextScopeId += 1;
      index += 1;
      continue;
    }
    if (!isEscaped(text, index) && char === '}') {
      if (scopeStack.length > 1) {
        const closingScope = scopeStack.pop();
        for (let frameIndex = openFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
          if (openFrames[frameIndex]?.scopeId === closingScope) {
            openFrames.splice(frameIndex, 1);
          }
        }
      }
      index += 1;
      continue;
    }

    if (!isEscaped(text, index)) {
      const plainOpen = PLAIN_BRACKETS.find((spec) => spec.open === char);
      if (plainOpen !== undefined) {
        openFrames.push({
          ...plainOpen,
          offset: index,
          end: index + 1,
          scopeId: currentScope(),
        });
        index += 1;
        continue;
      }
      const plainClose = PLAIN_BRACKETS.find((spec) => spec.close === char);
      if (plainClose !== undefined) {
        closeFrame(plainClose, index, index + 1);
        index += 1;
        continue;
      }
      if (char === '|') {
        const scopeId = currentScope();
        let openPipeIndex = -1;
        for (let frameIndex = openFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
          const frame = openFrames[frameIndex];
          if (frame?.open === '|' && frame.scopeId === scopeId) {
            openPipeIndex = frameIndex;
            break;
          }
        }
        if (openPipeIndex >= 0) {
          const frame = openFrames.splice(openPipeIndex, 1)[0];
          if (frame !== undefined) {
            pairs.push({ ...frame, closeOffset: index, closeEnd: index + 1 });
          }
        } else {
          openFrames.push({
            open: '|',
            close: '|',
            offset: index,
            end: index + 1,
            scopeId,
          });
        }
      }
    }

    index += 1;
  }

  return pairs;
}

function hasSizeModifier(text: string, from: number, delimiterOffset: number): boolean {
  return SIZE_MODIFIER_AT_END.test(text.slice(from, delimiterOffset));
}

function pairToPlan(pair: BracketPair): EnlargeBracketPlan {
  return {
    openOffset: pair.offset,
    closeOffset: pair.closeOffset,
    open: pair.open,
    close: pair.close,
    insertLeftAt: pair.offset,
    insertRightAt: pair.closeOffset,
    insertLeftText: '\\left',
    insertRightText: '\\right',
  };
}

function eligiblePairs(
  text: string,
  contentRange: OffsetRange,
  options: AutoEnlargeOptions,
): readonly BracketPair[] {
  if (
    !Number.isInteger(contentRange.start) ||
    !Number.isInteger(contentRange.end) ||
    contentRange.start < 0 ||
    contentRange.end < contentRange.start ||
    contentRange.end > text.length
  ) {
    return [];
  }

  const bounds = clampRange(options.bounds, text.length);
  if (contentRange.start < bounds.start || contentRange.end > bounds.end) {
    return [];
  }
  const triggers = options.triggers ?? DEFAULT_TRIGGERS;
  if (triggers.length === 0) {
    return [];
  }

  return scanBracketPairs(text, bounds)
    .filter((pair) => pair.end <= contentRange.start && pair.closeOffset >= contentRange.end)
    .filter((pair) => {
      const content = text.slice(pair.end, pair.closeOffset);
      return triggers.some((trigger) => trigger.length > 0 && content.includes(trigger));
    })
    .filter((pair) =>
      !hasSizeModifier(text, bounds.start, pair.offset) &&
      !hasSizeModifier(text, pair.end, pair.closeOffset),
    )
    .sort((left, right) =>
      (left.closeEnd - left.offset) - (right.closeEnd - right.offset) ||
      right.offset - left.offset,
    );
}

/**
 * Plan every strictly enclosing, unsized ancestor pair around `contentRange`.
 * Plans use offsets from the same input string and are ordered from the
 * innermost pair to the outermost pair so an adapter can rebuild the complete
 * replacement atomically. Malformed crossing pairs stop the ancestor walk;
 * they are never treated as structural parents.
 */
export function planAutoEnlargeAncestors(
  text: string,
  contentRange: OffsetRange,
  options: AutoEnlargeOptions = {},
): readonly EnlargeBracketPlan[] {
  const candidates = eligiblePairs(text, contentRange, options);
  const chain: BracketPair[] = [];
  for (const candidate of candidates) {
    // Keep one automatic expansion bounded even for generated or hostile TeX.
    // The nearest layers are the most relevant; deeper ancestors remain valid
    // ordinary delimiters and can still be sized explicitly by the author.
    if (chain.length >= MAX_AUTO_ENLARGE_ANCESTORS) {
      break;
    }
    const currentOuter = chain[chain.length - 1];
    if (currentOuter === undefined) {
      chain.push(candidate);
      continue;
    }
    if (
      candidate.offset < currentOuter.offset &&
      candidate.closeEnd > currentOuter.closeEnd
    ) {
      chain.push(candidate);
      continue;
    }
    // Every candidate surrounds the inserted content. If it does not strictly
    // contain the current outer pair, the source delimiters cross or overlap.
    // Keep the already proven inner chain and never cascade through it.
    break;
  }
  return chain.map(pairToPlan);
}

/**
 * Find the smallest eligible bracket pair enclosing `contentRange` and plan
 * insertion of neutral `\\left` / `\\right` modifiers. The returned edits use
 * original-document offsets and can therefore be applied together in reverse
 * order or as a single workspace edit.
 */
export function planAutoEnlarge(
  text: string,
  contentRange: OffsetRange,
  options: AutoEnlargeOptions = {},
): EnlargeBracketPlan | undefined {
  return planAutoEnlargeAncestors(text, contentRange, options)[0];
}
