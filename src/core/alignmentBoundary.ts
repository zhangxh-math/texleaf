const CONTROL_WORD_CHARACTER = /[A-Za-z@]/u;

const NAMED_ROW_BOUNDARIES = [
  '\\tabularnewline',
  '\\crcr',
  '\\cr',
] as const;

/**
 * Return the UTF-16 length of a TeX alignment cell/row boundary at `offset`.
 * Escaped `\&` is ordinary content, while `&`, `\\`, `\cr`, `\crcr`, and
 * `\tabularnewline` split the current alignment math list.  A generated
 * `\left`/`\right` pair and Tabout must never cross one of these boundaries.
 */
export function alignmentBoundaryLengthAt(
  text: string,
  offset: number,
): number {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset >= text.length ||
    isEscapedAt(text, offset)
  ) {
    return 0;
  }

  if (text[offset] === '&') {
    return 1;
  }
  if (text[offset] !== '\\') {
    return 0;
  }
  if (text.startsWith('\\\\', offset)) {
    return 2;
  }
  for (const command of NAMED_ROW_BOUNDARIES) {
    if (!text.startsWith(command, offset)) {
      continue;
    }
    const next = text[offset + command.length];
    if (next === undefined || !CONTROL_WORD_CHARACTER.test(next)) {
      return command.length;
    }
  }
  return 0;
}

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
