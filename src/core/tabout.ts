import { scanLatexRegions, isMatrixEnvironment } from './latexScanner';
import { LatexMathRegion, TaboutOptions, TaboutPlan } from './types';
import { alignmentBoundaryLengthAt } from './alignmentBoundary';

const SINGLE_CHARACTER_CLOSERS = new Set(['}', ')', ']', '>', '|']);
const COMMAND_CLOSER = '\\rangle';

function isEscapedAt(text: string, offset: number): boolean {
  let precedingSlashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && text[index] === '\\';
    index -= 1
  ) {
    precedingSlashes += 1;
  }
  return precedingSlashes % 2 === 1;
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

/**
 * Plan Snippet Leaf-style Tabout. The adapter should first allow VS Code's
 * active snippet session to advance its own tabstop; this planner handles the
 * fallback that jumps past a closing token or, when only whitespace remains,
 * the current math region's closing syntax.
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

  for (let index = cursorOffset; index < innerEnd; index += 1) {
    if (text[index] === '%' && !isEscapedAt(text, index)) {
      // TeX comments are not part of the math list. Ignore boundary-looking
      // tokens and closing delimiters until the physical line ends.
      while (
        index < innerEnd &&
        text[index] !== '\n' &&
        text[index] !== '\r'
      ) {
        index += 1;
      }
      continue;
    }
    if (arrayMode && alignmentBoundaryLengthAt(text, index) > 0) {
      // An alignment cell/row is a separate math list. Tabout may leave local
      // braces before the boundary, but must not jump into a later cell/row.
      break;
    }
    if (text.startsWith(COMMAND_CLOSER, index)) {
      const to = index + COMMAND_CLOSER.length;
      return {
        kind: 'closing-delimiter',
        from: cursorOffset,
        to,
        skippedText: text.slice(cursorOffset, to),
      };
    }
    if (SINGLE_CHARACTER_CLOSERS.has(text[index]!)) {
      const to = index + 1;
      return {
        kind: 'closing-delimiter',
        from: cursorOffset,
        to,
        skippedText: text.slice(cursorOffset, to),
      };
    }
  }

  if (
    !arrayMode &&
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
