import { FractionNumeratorOptions, FractionNumeratorPlan } from './types';

const DEFAULT_BREAKING_CHARACTERS = '+-=,;:&\t';

// TeX ignores the single delimiter space after a control word. Snippet Leaf's
// upstream fraction finder consequently treats this space as part of a Greek
// symbol expression rather than as an arithmetic boundary.
const GREEK_CONTROL_WORD = /\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|omicron|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/;

function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function matchingOpen(close: string): string | undefined {
  switch (close) {
    case ')':
      return '(';
    case ']':
      return '[';
    case '}':
      return '{';
    default:
      return undefined;
  }
}

function findMatchingOpen(
  text: string,
  closeOffset: number,
  lowerBound: number,
): number | undefined {
  const close = text[closeOffset];
  if (close === undefined) {
    return undefined;
  }
  const open = matchingOpen(close);
  if (open === undefined) {
    return undefined;
  }

  let depth = 1;
  for (let index = closeOffset - 1; index >= lowerBound; index -= 1) {
    if (isEscaped(text, index)) {
      continue;
    }
    if (text[index] === close) {
      depth += 1;
    } else if (text[index] === open) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function findMatchingClose(text: string, openOffset: number, upperBound: number): number | undefined {
  const open = text[openOffset];
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : undefined;
  if (close === undefined) {
    return undefined;
  }

  let depth = 1;
  for (let index = openOffset + 1; index < upperBound; index += 1) {
    if (isEscaped(text, index)) {
      continue;
    }
    if (text[index] === open) {
      depth += 1;
    } else if (text[index] === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function isGreekDelimiterSpace(text: string, offset: number, lowerBound: number): boolean {
  return text[offset] === ' ' && GREEK_CONTROL_WORD.test(text.slice(lowerBound, offset));
}

/**
 * Locate the numerator immediately before a just-typed slash. The routine is
 * deliberately independent of editor state; callers normally pass the current
 * math region's innerStart as `lowerBound` after checking strict math context.
 */
export function findFractionNumerator(
  text: string,
  slashOffset: number,
  options: FractionNumeratorOptions = {},
): FractionNumeratorPlan | undefined {
  if (!Number.isInteger(slashOffset) || slashOffset < 0 || text[slashOffset] !== '/') {
    return undefined;
  }

  const lowerBound = Math.max(0, Math.min(options.lowerBound ?? 0, slashOffset));
  const breakingCharacters = options.breakingCharacters ?? DEFAULT_BREAKING_CHARACTERS;
  const boundaryCharacters = new Set(` $([{\n\r${breakingCharacters}`);
  let sourceStart = slashOffset;
  let index = slashOffset - 1;

  while (index >= lowerBound) {
    const char = text[index]!;

    if (!isEscaped(text, index) && (char === ')' || char === ']' || char === '}')) {
      const openOffset = findMatchingOpen(text, index, lowerBound);
      if (openOffset === undefined) {
        return undefined;
      }
      sourceStart = openOffset;
      index = openOffset - 1;
      continue;
    }

    if (!isEscaped(text, index) && boundaryCharacters.has(char)) {
      if (char === ' ' && isGreekDelimiterSpace(text, index, lowerBound)) {
        sourceStart = index;
        index -= 1;
        continue;
      }
      break;
    }

    sourceStart = index;
    index -= 1;
  }

  if (sourceStart >= slashOffset) {
    return undefined;
  }

  let numeratorStart = sourceStart;
  let numeratorEnd = slashOffset;
  const shouldStripParentheses = options.stripOuterParentheses ?? true;
  if (
    shouldStripParentheses &&
    text[numeratorStart] === '(' &&
    text[numeratorEnd - 1] === ')' &&
    findMatchingClose(text, numeratorStart, numeratorEnd) === numeratorEnd - 1
  ) {
    numeratorStart += 1;
    numeratorEnd -= 1;
  }

  if (numeratorStart >= numeratorEnd) {
    return undefined;
  }

  return {
    numeratorRange: { start: numeratorStart, end: numeratorEnd },
    numerator: text.slice(numeratorStart, numeratorEnd),
    replacementRange: { start: sourceStart, end: slashOffset + 1 },
  };
}
