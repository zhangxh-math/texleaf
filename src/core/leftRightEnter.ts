import { scanLatexContext, scanLatexRegions } from './latexScanner';

/**
 * Math environments in which TeXLeaf may turn one matched `\left`/`\right`
 * group into two rows. Stars are normalized before this set is consulted.
 *
 * Matrix-like environments deliberately stay out of this list. Their Enter
 * behavior already means "insert a row", while splitting a scalable delimiter
 * inside one matrix cell would also change the surrounding matrix structure.
 */
const LINE_BREAK_MATH_ENVIRONMENTS = new Set([
  'displaymath',
  'equation',
  'align',
  'alignat',
  'aligned',
  'alignedat',
  'gather',
  'gathered',
  'multline',
  'flalign',
  'split',
]);

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

export interface LeftRightEnterOptions {
  /** Override the document EOL chosen for the inserted row. */
  readonly eol?: '\n' | '\r\n';
}

export interface LeftRightEnterPlan {
  /** The edit is an insertion at this UTF-16 document offset. */
  readonly insertionOffset: number;
  readonly insertionText: string;
  /** Cursor position after the insertion, immediately after the new `\left.`. */
  readonly cursorOffset: number;
  readonly environmentName: string;
  readonly openingDelimiter: string;
  readonly closingDelimiter: string;
}

interface ControlSequence {
  readonly name: string;
  readonly end: number;
}

interface SizingDelimiter {
  readonly raw: string;
  readonly end: number;
}

interface LeftToken {
  readonly commandStart: number;
  readonly contentStart: number;
  readonly delimiter: string;
  readonly braceDepth: number;
  readonly pairDepth: number;
}

interface RightToken {
  readonly commandStart: number;
  readonly commandEnd: number;
  readonly delimiter: string;
  readonly braceDepth: number;
}

interface LeftRightPair {
  readonly open: LeftToken;
  readonly close: RightToken;
}

interface Hazard {
  readonly offset: number;
}

/**
 * Plan the conservative Enter transform used inside a matched scalable pair:
 *
 * ```tex
 * \left( first|second \right)
 * ```
 *
 * becomes, at `|`:
 *
 * ```tex
 * \left( first\right.\\
 * <indent>\left.second \right)
 * ```
 *
 * No edit is returned when the cursor is in a comment, command token, braced
 * argument, nested pair, alignment cell boundary, existing row, or nested
 * environment. Those cases must retain the editor/other extension's ordinary
 * Enter behavior instead of receiving a best-effort rewrite.
 */
export function planLeftRightEnter(
  text: string,
  cursorOffset: number,
  options: LeftRightEnterOptions = {},
): LeftRightEnterPlan | undefined {
  if (
    !Number.isInteger(cursorOffset) ||
    cursorOffset < 0 ||
    cursorOffset > text.length ||
    text.lastIndexOf('\\left', cursorOffset) < 0 ||
    text.indexOf('\\right', cursorOffset) < 0
  ) {
    return undefined;
  }

  const context = scanLatexContext(text, cursorOffset);
  if (
    context.mathMode !== 'block' ||
    context.inComment ||
    context.inVerbatim ||
    context.inSnippetSuppressedArgument
  ) {
    return undefined;
  }

  const region = scanLatexRegions(text)
    .filter(
      (candidate) =>
        candidate.environmentName !== undefined &&
        cursorOffset >= candidate.innerStart &&
        cursorOffset <= candidate.innerEnd,
    )
    .sort(
      (left, right) =>
        left.innerEnd - left.innerStart - (right.innerEnd - right.innerStart),
    )[0];
  if (
    region?.environmentName === undefined ||
    !LINE_BREAK_MATH_ENVIRONMENTS.has(normalizeEnvironmentName(region.environmentName))
  ) {
    return undefined;
  }

  const pairScan = scanLeftRightPairs(
    text,
    region.innerStart,
    region.innerEnd,
    cursorOffset,
  );
  if (pairScan === undefined || pairScan.cursorInsideSyntax) {
    return undefined;
  }

  const containingPairs = pairScan.pairs.filter(
    (pair) =>
      cursorOffset >= pair.open.contentStart &&
      cursorOffset <= pair.close.commandStart,
  );
  // More than one containing pair means the cursor lies across a nested
  // `\left`/`\right` boundary. Closing only one layer would leave another
  // scalable group crossing the new `\\`, which TeX cannot safely typeset.
  if (containingPairs.length !== 1) {
    return undefined;
  }

  const pair = containingPairs[0]!;
  if (
    pair.open.pairDepth !== 0 ||
    pair.open.braceDepth !== 0 ||
    pair.close.braceDepth !== 0 ||
    pairScan.cursorBraceDepth !== 0 ||
    pairScan.hazards.some(
      (hazard) =>
        hazard.offset >= pair.open.contentStart &&
        hazard.offset < pair.close.commandEnd,
    )
  ) {
    return undefined;
  }

  const eol = options.eol ?? inferEol(text);
  const indentation = lineIndentationAt(text, cursorOffset);
  const insertionText = `\\right.\\\\${eol}${indentation}\\left.`;
  return {
    insertionOffset: cursorOffset,
    insertionText,
    cursorOffset: cursorOffset + insertionText.length,
    environmentName: region.environmentName,
    openingDelimiter: pair.open.delimiter,
    closingDelimiter: pair.close.delimiter,
  };
}

function scanLeftRightPairs(
  text: string,
  start: number,
  end: number,
  cursorOffset: number,
):
  | {
      readonly pairs: readonly LeftRightPair[];
      readonly hazards: readonly Hazard[];
      readonly cursorBraceDepth: number;
      readonly cursorInsideSyntax: boolean;
    }
  | undefined {
  const stack: LeftToken[] = [];
  const pairs: LeftRightPair[] = [];
  const hazards: Hazard[] = [];
  let braceDepth = 0;
  let cursorBraceDepth: number | undefined;
  let cursorInsideSyntax = false;
  let inComment = false;
  let index = start;

  const markCursorAcrossToken = (tokenStart: number, tokenEnd: number): void => {
    if (cursorOffset > tokenStart && cursorOffset < tokenEnd) {
      cursorInsideSyntax = true;
    }
  };

  while (index < end) {
    if (cursorOffset === index) {
      cursorBraceDepth = braceDepth;
    }
    const char = text[index]!;

    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (char === '%') {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const control = readControlSequence(text, index);
      if (control.name === 'verb') {
        const verbEnd = readVerbEnd(text, control.end, end);
        hazards.push({ offset: index });
        markCursorAcrossToken(index, verbEnd);
        index = verbEnd;
        continue;
      }

      if (control.name === 'left') {
        const delimiter = readSizingDelimiter(text, control.end, end);
        if (delimiter === undefined) {
          return undefined;
        }
        stack.push({
          commandStart: index,
          contentStart: delimiter.end,
          delimiter: delimiter.raw,
          braceDepth,
          pairDepth: stack.length,
        });
        markCursorAcrossToken(index, delimiter.end);
        index = delimiter.end;
        continue;
      }

      if (control.name === 'right') {
        const delimiter = readSizingDelimiter(text, control.end, end);
        const open = stack.pop();
        if (delimiter === undefined || open === undefined) {
          return undefined;
        }
        const close: RightToken = {
          commandStart: index,
          commandEnd: delimiter.end,
          delimiter: delimiter.raw,
          braceDepth,
        };
        pairs.push({ open, close });
        markCursorAcrossToken(index, delimiter.end);
        index = delimiter.end;
        continue;
      }

      if (
        control.name === '\\' ||
        control.name === 'begin' ||
        control.name === 'end' ||
        control.name === 'begingroup' ||
        control.name === 'endgroup'
      ) {
        hazards.push({ offset: index });
      }
      markCursorAcrossToken(index, control.end);
      index = control.end;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (char === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) {
        return undefined;
      }
      index += 1;
      continue;
    }
    if (char === '&') {
      hazards.push({ offset: index });
    }
    index += 1;
  }

  if (cursorOffset === end) {
    cursorBraceDepth = braceDepth;
  }
  if (
    stack.length > 0 ||
    braceDepth !== 0 ||
    cursorBraceDepth === undefined
  ) {
    return undefined;
  }
  return {
    pairs,
    hazards,
    cursorBraceDepth,
    cursorInsideSyntax,
  };
}

function readControlSequence(text: string, slashOffset: number): ControlSequence {
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { name: '', end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/u.test(first)) {
    return { name: first, end: slashOffset + 2 };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/u.test(text[end]!)) {
    end += 1;
  }
  return { name: text.slice(slashOffset + 1, end), end };
}

function readSizingDelimiter(
  text: string,
  from: number,
  limit: number,
): SizingDelimiter | undefined {
  let index = from;
  while (index < limit && (text[index] === ' ' || text[index] === '\t')) {
    index += 1;
  }
  const first = text[index];
  if (first === undefined || index >= limit) {
    return undefined;
  }
  if (first === '\\') {
    const control = readControlSequence(text, index);
    if (!COMMAND_DELIMITERS.has(control.name) || control.end > limit) {
      return undefined;
    }
    return {
      raw: text.slice(index, control.end),
      end: control.end,
    };
  }
  return SIMPLE_DELIMITERS.has(first)
    ? { raw: first, end: index + 1 }
    : undefined;
}

function readVerbEnd(text: string, commandEnd: number, limit: number): number {
  let delimiterOffset = commandEnd;
  if (text[delimiterOffset] === '*') {
    delimiterOffset += 1;
  }
  const delimiter = text[delimiterOffset];
  if (
    delimiter === undefined ||
    delimiter === '\n' ||
    delimiter === '\r' ||
    delimiterOffset >= limit
  ) {
    return commandEnd;
  }
  const close = text.indexOf(delimiter, delimiterOffset + 1);
  return close < 0 || close >= limit ? limit : close + 1;
}

function normalizeEnvironmentName(name: string): string {
  return name.endsWith('*') ? name.slice(0, -1) : name;
}

function inferEol(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function lineIndentationAt(text: string, offset: number): string {
  const previousLineFeed = text.lastIndexOf('\n', Math.max(0, offset - 1));
  const previousCarriageReturn = text.lastIndexOf('\r', Math.max(0, offset - 1));
  const lineStart = Math.max(previousLineFeed, previousCarriageReturn) + 1;
  return /^[ \t]*/u.exec(text.slice(lineStart, offset))?.[0] ?? '';
}
