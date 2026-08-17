import {
  AutoEnlargeOptions,
  EnlargeBracketPlan,
  EnlargeCloseBracket,
  EnlargeOpenBracket,
  OffsetRange,
} from './types';
import { alignmentBoundaryLengthAt } from './alignmentBoundary';

const DEFAULT_TRIGGERS = ['\\frac', '\\sum', '\\prod', '\\int', '\\lim'] as const;

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
const SIZE_MODIFIER_AT_END = /\\(?:left|right|big[lr]?|Big[lr]?|bigg[lr]?|Bigg[lr]?)\s*$/;

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
  return specs.find((spec) => text.startsWith(spec[field], offset));
}

function scanBracketPairs(text: string, bounds: OffsetRange): readonly BracketPair[] {
  const pairs: BracketPair[] = [];
  const openFrames: OpenFrame[] = [];
  const scopeStack: number[] = [0];
  let nextScopeId = 1;
  let inComment = false;
  let index = bounds.start;
  const currentScope = (): number => scopeStack[scopeStack.length - 1] ?? 0;

  const discardOpenFramesInCurrentScope = (): void => {
    const scopeId = currentScope();
    for (let frameIndex = openFrames.length - 1; frameIndex >= 0; frameIndex -= 1) {
      if (openFrames[frameIndex]?.scopeId === scopeId) {
        openFrames.splice(frameIndex, 1);
      }
    }
  };

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
      // delimiter in this scope with a closer across `&` or a row command.
      discardOpenFramesInCurrentScope();
      index += boundaryLength;
      continue;
    }

    if (char === '\\') {
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
  if (
    !Number.isInteger(contentRange.start) ||
    !Number.isInteger(contentRange.end) ||
    contentRange.start < 0 ||
    contentRange.end < contentRange.start ||
    contentRange.end > text.length
  ) {
    return undefined;
  }

  const bounds = clampRange(options.bounds, text.length);
  if (contentRange.start < bounds.start || contentRange.end > bounds.end) {
    return undefined;
  }
  const triggers = options.triggers ?? DEFAULT_TRIGGERS;
  if (triggers.length === 0) {
    return undefined;
  }

  const candidates = scanBracketPairs(text, bounds)
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

  const pair = candidates[0];
  if (pair === undefined) {
    return undefined;
  }

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
