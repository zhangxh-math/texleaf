import { OffsetRange } from './types';

/** Common citation commands used when an adapter does not provide its own list. */
export const DEFAULT_CITATION_COMMANDS: readonly string[] = Object.freeze([
  'cite',
  'Cite',
  'citep',
  'Citep',
  'citet',
  'Citet',
  'citealp',
  'citealt',
  'autocite',
  'Autocite',
  'parencite',
  'Parencite',
  'textcite',
  'Textcite',
  'footcite',
  'footcitetext',
  'smartcite',
  'supercite',
  'nocite',
]);

/**
 * A citation argument containing the cursor. Offsets are UTF-16 offsets, as
 * used by JavaScript strings and VS Code documents. End offsets are exclusive.
 */
export interface CitationContext {
  /** Command name without the leading backslash (for example, `citep`). */
  readonly command: string;
  readonly commandStart: number;
  readonly openingBrace: number;
  readonly closingBrace: number | undefined;
  readonly closed: boolean;
  /** Range inside the mandatory braces, excluding both braces. */
  readonly argumentRange: OffsetRange;
  /** The current comma-delimited token, with surrounding whitespace excluded. */
  readonly replacementRange: OffsetRange;
  /** Trimmed contents of replacementRange. */
  readonly query: string;
  /** Every non-empty comma-delimited key, including query when it is non-empty. */
  readonly keys: readonly string[];
  /** Every non-empty sibling key except the token containing the cursor. */
  readonly otherKeys: readonly string[];
}

export interface CitationCompletionEdit {
  /**
   * `replace-token` supplies a VS Code InsertReplaceRange for the token under
   * the cursor. `insert-at-cursor` is used when the cursor is only in the
   * token's surrounding whitespace, so the existing token is not removed.
   */
  readonly mode: 'replace-token' | 'insert-at-cursor';
  /** Range used while typing/filtering a completion item. */
  readonly insertingRange: OffsetRange;
  /** Range replaced when the completion item is accepted. */
  readonly replacingRange: OffsetRange;
  /** Current token prefix from insertingRange.start through the cursor. */
  readonly prefixQuery: string;
}

/** Metadata shared by entries already in a .bib file and remote references. */
export interface CitationReference {
  readonly key: string;
  readonly title: string;
  readonly authors: string;
  readonly container: string;
  readonly year: string;
}

export interface BibTeXEntry extends CitationReference {
  /** Lower-case BibTeX entry type, such as `article` or `inproceedings`. */
  readonly type: string;
  /** Alias retained for call sites where `type` is already used as a discriminator. */
  readonly entryType: string;
  /** BibTeX `author` field. This is also exposed as `authors`. */
  readonly author: string;
  /** BibTeX `journal`/`journaltitle` field. */
  readonly journal: string;
  /** Cleaned, lower-case field-name to display-value mapping. */
  readonly fields: Readonly<Record<string, string>>;
  /** Exact source entry, from `@` through the matching closing delimiter. */
  readonly raw: string;
  readonly range: OffsetRange;
}

export interface BibTeXIndex {
  readonly entries: readonly BibTeXEntry[];
  /** First entry for each exact (case-sensitive) citation key. */
  readonly byKey: ReadonlyMap<string, BibTeXEntry>;
}

interface LatexControlSequence {
  readonly name: string;
  readonly baseName: string;
  readonly end: number;
}

interface CitationOpening {
  readonly openingBrace: number;
  readonly closingBrace: number | undefined;
}

interface CitationSegment {
  readonly start: number;
  readonly end: number;
}

interface ParsedBibValue {
  readonly value: string;
  readonly end: number;
}

function readLatexControlSequence(text: string, start: number): LatexControlSequence {
  let end = start + 1;
  const first = text[end];
  if (first === undefined) {
    return { name: '', baseName: '', end };
  }

  if (/[A-Za-z@]/u.test(first)) {
    end += 1;
    while (end < text.length && /[A-Za-z@]/u.test(text[end] ?? '')) {
      end += 1;
    }
    const baseName = text.slice(start + 1, end);
    if (text[end] === '*') {
      end += 1;
      return { name: `${baseName}*`, baseName, end };
    }
    return { name: baseName, baseName, end };
  }

  return { name: first, baseName: first, end: end + 1 };
}

function skipLineComment(text: string, start: number, limit = text.length): number {
  let index = start + 1;
  while (index < limit && text[index] !== '\n' && text[index] !== '\r') {
    index += 1;
  }
  return index;
}

function skipLatexTrivia(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const char = text[index];
    if (char !== undefined && /\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '%') {
      index = skipLineComment(text, index);
      continue;
    }
    break;
  }
  return index;
}

/** Find a LaTeX group close while respecting nested groups, escapes, and comments. */
function findLatexGroupClose(
  text: string,
  openingOffset: number,
  opening: '{' | '[',
): number | undefined {
  const closing = opening === '{' ? '}' : ']';
  let groupDepth = 1;
  let braceDepth = 0;
  let index = openingOffset + 1;

  while (index < text.length) {
    const char = text[index];
    if (char === '\\') {
      index = readLatexControlSequence(text, index).end;
      continue;
    }
    if (char === '%') {
      index = skipLineComment(text, index);
      continue;
    }

    if (opening === '[') {
      if (char === '{') {
        braceDepth += 1;
      } else if (char === '}' && braceDepth > 0) {
        braceDepth -= 1;
      } else if (braceDepth === 0 && char === opening) {
        groupDepth += 1;
      } else if (braceDepth === 0 && char === closing) {
        groupDepth -= 1;
        if (groupDepth === 0) {
          return index;
        }
      }
    } else if (char === opening) {
      groupDepth += 1;
    } else if (char === closing) {
      groupDepth -= 1;
      if (groupDepth === 0) {
        return index;
      }
    }
    index += 1;
  }

  return undefined;
}

function findCitationOpening(text: string, commandEnd: number): CitationOpening | undefined {
  let index = skipLatexTrivia(text, commandEnd);
  while (text[index] === '[') {
    const close = findLatexGroupClose(text, index, '[');
    if (close === undefined) {
      return undefined;
    }
    index = skipLatexTrivia(text, close + 1);
  }

  if (text[index] !== '{') {
    return undefined;
  }
  return {
    openingBrace: index,
    closingBrace: findLatexGroupClose(text, index, '{'),
  };
}

function normalizeCommandNames(commands: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const command of commands) {
    const trimmed = command.trim().replace(/^\\/u, '');
    if (trimmed.length > 0) {
      normalized.add(trimmed);
    }
  }
  return normalized;
}

function skipVerbCommand(text: string, commandEnd: number, limit: number): number {
  const delimiter = text[commandEnd];
  if (delimiter === undefined || delimiter === '\n' || delimiter === '\r') {
    return commandEnd;
  }
  let index = commandEnd + 1;
  while (index < limit) {
    const char = text[index];
    if (char === delimiter) {
      return index + 1;
    }
    if (char === '\n' || char === '\r') {
      return index;
    }
    index += 1;
  }
  return limit;
}

function citationSegments(text: string, start: number, end: number): readonly CitationSegment[] {
  const segments: CitationSegment[] = [];
  let segmentStart = start;
  let braceDepth = 0;
  let index = start;

  while (index < end) {
    const char = text[index];
    if (char === '\\') {
      index = Math.min(end, readLatexControlSequence(text, index).end);
      continue;
    }
    if (char === '%') {
      index = Math.min(end, skipLineComment(text, index, end));
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === ',' && braceDepth === 0) {
      segments.push({ start: segmentStart, end: index });
      segmentStart = index + 1;
    }
    index += 1;
  }

  segments.push({ start: segmentStart, end });
  return segments;
}

function trimWhitespaceRange(text: string, range: OffsetRange, cursorOffset: number): OffsetRange {
  let start = range.start;
  while (start < range.end && /\s/u.test(text[start] ?? '')) {
    start += 1;
  }

  let end = range.end;
  while (end > start && /\s/u.test(text[end - 1] ?? '')) {
    end -= 1;
  }

  if (start === end) {
    const insertionPoint = Math.max(range.start, Math.min(cursorOffset, range.end));
    return { start: insertionPoint, end: insertionPoint };
  }
  return { start, end };
}

function removeLatexComments(value: string): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\') {
      const control = readLatexControlSequence(value, index);
      result += value.slice(index, control.end);
      index = control.end;
      continue;
    }
    if (char === '%') {
      index = skipLineComment(value, index);
      result += ' ';
      continue;
    }
    result += char ?? '';
    index += 1;
  }
  return result;
}

function cleanCitationToken(value: string): string {
  return removeLatexComments(value).trim();
}

/** Split one citation argument at top-level, unescaped commas. */
export function splitCitationKeys(argument: string): readonly string[] {
  return citationSegments(argument, 0, argument.length)
    .map((segment) => cleanCitationToken(argument.slice(segment.start, segment.end)))
    .filter((key) => key.length > 0);
}

/**
 * Locate the configured cite-like command whose mandatory argument contains
 * the cursor. Commands may be supplied with or without a leading backslash.
 * A configured unstarred name also accepts its starred form.
 */
export function findCitationContext(
  text: string,
  cursorOffset: number,
  commands: readonly string[] = DEFAULT_CITATION_COMMANDS,
): CitationContext | undefined {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length));
  const commandNames = normalizeCommandNames(commands);
  let best:
    | {
      readonly command: string;
      readonly commandStart: number;
      readonly opening: CitationOpening;
    }
    | undefined;
  let index = 0;
  let inComment = false;

  while (index < cursor) {
    const char = text[index];
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
    if (char !== '\\') {
      index += 1;
      continue;
    }

    const control = readLatexControlSequence(text, index);
    if (control.baseName === 'verb') {
      index = skipVerbCommand(text, control.end, cursor);
      continue;
    }

    const configured = commandNames.has(control.name)
      || (control.name.endsWith('*') && commandNames.has(control.baseName));
    if (configured) {
      const opening = findCitationOpening(text, control.end);
      if (opening !== undefined) {
        const argumentEnd = opening.closingBrace ?? text.length;
        if (cursor >= opening.openingBrace + 1 && cursor <= argumentEnd) {
          if (best === undefined || opening.openingBrace > best.opening.openingBrace) {
            best = {
              command: control.name,
              commandStart: index,
              opening,
            };
          }
        }
      }
    }
    index = Math.max(index + 1, control.end);
  }

  // A cite command earlier on the line must not activate completion inside a
  // trailing LaTeX comment.
  if (inComment || best === undefined) {
    return undefined;
  }

  const argumentStart = best.opening.openingBrace + 1;
  const argumentEnd = best.opening.closingBrace ?? text.length;
  const segments = citationSegments(text, argumentStart, argumentEnd);
  let currentSegmentIndex = segments.length - 1;
  for (let segmentIndex = 0; segmentIndex < segments.length - 1; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (segment !== undefined && cursor <= segment.end) {
      currentSegmentIndex = segmentIndex;
      break;
    }
  }

  const currentSegment = segments[currentSegmentIndex] ?? {
    start: cursor,
    end: cursor,
  };
  const replacementRange = trimWhitespaceRange(text, currentSegment, cursor);
  const query = cleanCitationToken(text.slice(replacementRange.start, replacementRange.end));
  const keys: string[] = [];
  const otherKeys: string[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (segment === undefined) {
      continue;
    }
    const key = cleanCitationToken(text.slice(segment.start, segment.end));
    if (key.length === 0) {
      continue;
    }
    keys.push(key);
    if (segmentIndex !== currentSegmentIndex) {
      otherKeys.push(key);
    }
  }

  return {
    command: best.command,
    commandStart: best.commandStart,
    openingBrace: best.opening.openingBrace,
    closingBrace: best.opening.closingBrace,
    closed: best.opening.closingBrace !== undefined,
    argumentRange: { start: argumentStart, end: argumentEnd },
    replacementRange,
    query,
    keys,
    otherKeys,
  };
}

/**
 * Derive ranges suitable for VS Code's CompletionItem InsertReplaceRange.
 *
 * VS Code requires both ranges to be single-line, to contain the completion
 * position, and to share a start position. The full CitationContext query and
 * replacementRange deliberately retain their full citation-token semantics;
 * this helper adds the stricter native-completion view without weakening them.
 *
 * When the cursor is in whitespace outside an existing trimmed token, a
 * zero-width edit is returned. This lets an adapter offer insertion without
 * deleting the token. A genuinely multiline non-empty token is rejected,
 * because no valid InsertReplaceRange can replace it.
 */
export function getCitationCompletionEdit(
  text: string,
  cursorOffset: number,
  context: CitationContext,
): CitationCompletionEdit | undefined {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length));
  const replacement = context.replacementRange;
  if (
    replacement.start < 0
    || replacement.end < replacement.start
    || replacement.end > text.length
    || cursor < context.argumentRange.start
    || cursor > context.argumentRange.end
  ) {
    return undefined;
  }

  const cursorInsideReplacement = cursor >= replacement.start
    && cursor <= replacement.end;
  if (!cursorInsideReplacement) {
    const insertion = { start: cursor, end: cursor };
    return {
      mode: 'insert-at-cursor',
      insertingRange: insertion,
      replacingRange: insertion,
      prefixQuery: '',
    };
  }

  // A zero-width token is the normal empty-segment case. Keep it explicitly
  // in insertion mode so adapters do not treat it as an existing key.
  if (replacement.start === replacement.end) {
    const insertion = { start: cursor, end: cursor };
    return {
      mode: 'insert-at-cursor',
      insertingRange: insertion,
      replacingRange: insertion,
      prefixQuery: '',
    };
  }

  if (/\r|\n/u.test(text.slice(replacement.start, replacement.end))) {
    return undefined;
  }

  return {
    mode: 'replace-token',
    insertingRange: { start: replacement.start, end: cursor },
    replacingRange: replacement,
    prefixQuery: cleanCitationToken(text.slice(replacement.start, cursor)),
  };
}

function findBibEntryClose(
  text: string,
  openingOffset: number,
  opening: '{' | '(',
): number | undefined {
  let outerDepth = 1;
  let braceDepth = opening === '{' ? 1 : 0;
  let inQuote = false;
  let quoteBraceDepth = 0;
  let inComment = false;
  let index = openingOffset + 1;

  while (index < text.length) {
    const char = text[index];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += Math.min(2, text.length - index);
      continue;
    }
    if (inQuote) {
      if (char === '{') {
        quoteBraceDepth += 1;
      } else if (char === '}' && quoteBraceDepth > 0) {
        quoteBraceDepth -= 1;
      } else if (char === '"' && quoteBraceDepth === 0) {
        inQuote = false;
      }
      index += 1;
      continue;
    }
    if (char === '%') {
      inComment = true;
      index += 1;
      continue;
    }

    if (opening === '{') {
      if (char === '"' && braceDepth === 1) {
        inQuote = true;
      } else if (char === '{') {
        braceDepth += 1;
        outerDepth += 1;
      } else if (char === '}') {
        braceDepth -= 1;
        outerDepth -= 1;
        if (outerDepth === 0) {
          return index;
        }
      }
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
    } else if (braceDepth === 0 && char === '"') {
      inQuote = true;
    } else if (braceDepth === 0 && char === '(') {
      outerDepth += 1;
    } else if (braceDepth === 0 && char === ')') {
      outerDepth -= 1;
      if (outerDepth === 0) {
        return index;
      }
    }
    index += 1;
  }

  return undefined;
}

/**
 * Return the start offset of the first BibTeX entry whose outer delimiter is
 * not closed. Appending after such an entry would place the new source inside
 * the malformed entry, so write adapters should stop and ask for a repair.
 */
export function findIncompleteBibTeXEntry(text: string): number | undefined {
  let index = 0;
  let inComment = false;
  while (index < text.length) {
    const char = text[index];
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
    if (char !== '@') {
      index += 1;
      continue;
    }

    const entryStart = index;
    index = skipBibTrivia(text, index + 1, text.length);
    const typeStart = index;
    while (index < text.length && /[A-Za-z0-9_-]/u.test(text[index] ?? '')) {
      index += 1;
    }
    if (index === typeStart) {
      continue;
    }
    index = skipBibTrivia(text, index, text.length);
    const opening = text[index];
    if (opening !== '{' && opening !== '(') {
      continue;
    }
    const close = findBibEntryClose(text, index, opening);
    if (close === undefined) {
      return entryStart;
    }
    index = close + 1;
  }
  return undefined;
}

function findTopLevelComma(text: string, start: number, end: number): number | undefined {
  let braceDepth = 0;
  let inQuote = false;
  let quoteBraceDepth = 0;
  let inComment = false;
  let index = start;

  while (index < end) {
    const char = text[index];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += Math.min(2, end - index);
      continue;
    }
    if (inQuote) {
      if (char === '{') {
        quoteBraceDepth += 1;
      } else if (char === '}' && quoteBraceDepth > 0) {
        quoteBraceDepth -= 1;
      } else if (char === '"' && quoteBraceDepth === 0) {
        inQuote = false;
      }
      index += 1;
      continue;
    }
    if (char === '%') {
      inComment = true;
    } else if (char === '"' && braceDepth === 0) {
      inQuote = true;
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === ',' && braceDepth === 0) {
      return index;
    }
    index += 1;
  }
  return undefined;
}

function skipBibTrivia(text: string, start: number, end: number): number {
  let index = start;
  while (index < end) {
    const char = text[index];
    if (char !== undefined && /\s/u.test(char)) {
      index += 1;
      continue;
    }
    if (char === '%') {
      index = skipLineComment(text, index, end);
      continue;
    }
    break;
  }
  return index;
}

function readBracedBibValue(text: string, start: number, end: number): ParsedBibValue {
  let depth = 1;
  let index = start + 1;
  let inComment = false;
  while (index < end) {
    const char = text[index];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += Math.min(2, end - index);
      continue;
    }
    if (char === '%') {
      inComment = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { value: text.slice(start + 1, index), end: index + 1 };
      }
    }
    index += 1;
  }
  return { value: text.slice(start + 1, end), end };
}

function readQuotedBibValue(text: string, start: number, end: number): ParsedBibValue {
  let braceDepth = 0;
  let index = start + 1;
  while (index < end) {
    const char = text[index];
    if (char === '\\') {
      index += Math.min(2, end - index);
      continue;
    }
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
    } else if (char === '"' && braceDepth === 0) {
      return { value: text.slice(start + 1, index), end: index + 1 };
    }
    index += 1;
  }
  return { value: text.slice(start + 1, end), end };
}

function readBareBibValue(text: string, start: number, end: number): ParsedBibValue {
  let index = start;
  while (index < end && text[index] !== '#' && text[index] !== ',') {
    index += 1;
  }
  return { value: text.slice(start, index).trim(), end: index };
}

function parseBibValueExpression(text: string, start: number, end: number): ParsedBibValue {
  const parts: string[] = [];
  let index = start;
  while (index < end) {
    index = skipBibTrivia(text, index, end);
    const char = text[index];
    let atom: ParsedBibValue;
    if (char === '{') {
      atom = readBracedBibValue(text, index, end);
    } else if (char === '"') {
      atom = readQuotedBibValue(text, index, end);
    } else {
      atom = readBareBibValue(text, index, end);
    }
    parts.push(atom.value);
    index = skipBibTrivia(text, atom.end, end);
    if (text[index] !== '#') {
      break;
    }
    index += 1;
  }
  return { value: parts.join(''), end: index };
}

function findNextField(text: string, start: number, end: number): number {
  const comma = findTopLevelComma(text, start, end);
  return comma === undefined ? end : comma + 1;
}

function removeBibPercentComments(value: string): string {
  let result = '';
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      result += value.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (char === '%') {
      index = skipLineComment(value, index);
      result += ' ';
      continue;
    }
    result += char ?? '';
    index += 1;
  }
  return result;
}

/** Convert a BibTeX field value into compact text suitable for UI display. */
export function bibTeXValueToText(value: string): string {
  return removeBibPercentComments(value)
    // Preserve the letter while dropping common TeX accent commands.
    .replace(/\\["'`^~=.uvHckbdtr]\s*\{?\s*([A-Za-z])\s*\}?/gu, '$1')
    .replace(/\\([%&_#$])/gu, '$1')
    .replace(/\\(?:text[a-zA-Z]+|emph|mathrm|mathbf|mathit|operatorname)\*?/gu, '')
    .replace(/\\[A-Za-z@]+\*?/gu, '')
    .replace(/[{}]/gu, '')
    .replace(/~/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function parseBibFields(text: string, start: number, end: number): Readonly<Record<string, string>> {
  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  let index = start;
  while (index < end) {
    index = skipBibTrivia(text, index, end);
    while (text[index] === ',') {
      index = skipBibTrivia(text, index + 1, end);
    }
    if (index >= end) {
      break;
    }

    const nameStart = index;
    while (index < end && /[A-Za-z0-9_:-]/u.test(text[index] ?? '')) {
      index += 1;
    }
    if (index === nameStart) {
      index = findNextField(text, index, end);
      continue;
    }
    const fieldName = text.slice(nameStart, index).toLocaleLowerCase('en-US');
    index = skipBibTrivia(text, index, end);
    if (text[index] !== '=') {
      index = findNextField(text, index, end);
      continue;
    }

    const parsed = parseBibValueExpression(text, index + 1, end);
    fields[fieldName] = bibTeXValueToText(parsed.value);
    index = parsed.end;
    if (text[index] !== ',') {
      index = findNextField(text, index, end);
    }
  }
  return fields;
}

function yearFromFields(fields: Readonly<Record<string, string>>): string {
  const year = fields['year'];
  if (year !== undefined && year.length > 0) {
    return year;
  }
  const date = fields['date'] ?? '';
  return /^\d{4}/u.exec(date)?.[0] ?? date;
}

/** Parse complete regular BibTeX entries. @comment/@preamble/@string are skipped. */
export function parseBibTeXEntries(text: string): readonly BibTeXEntry[] {
  const entries: BibTeXEntry[] = [];
  let index = 0;
  let inComment = false;

  while (index < text.length) {
    const char = text[index];
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
    if (char !== '@') {
      index += 1;
      continue;
    }

    const entryStart = index;
    index += 1;
    index = skipBibTrivia(text, index, text.length);
    const typeStart = index;
    while (index < text.length && /[A-Za-z0-9_-]/u.test(text[index] ?? '')) {
      index += 1;
    }
    if (index === typeStart) {
      continue;
    }
    const entryType = text.slice(typeStart, index).toLocaleLowerCase('en-US');
    index = skipBibTrivia(text, index, text.length);
    const opening = text[index];
    if (opening !== '{' && opening !== '(') {
      continue;
    }
    const close = findBibEntryClose(text, index, opening);
    if (close === undefined) {
      // An incomplete entry owns the remainder of the file; do not index it.
      break;
    }
    const entryEnd = close + 1;
    if (entryType === 'comment' || entryType === 'preamble' || entryType === 'string') {
      index = entryEnd;
      continue;
    }

    const keyEnd = findTopLevelComma(text, index + 1, close);
    if (keyEnd === undefined) {
      index = entryEnd;
      continue;
    }
    const key = text.slice(index + 1, keyEnd).trim();
    if (key.length === 0) {
      index = entryEnd;
      continue;
    }

    const fields = parseBibFields(text, keyEnd + 1, close);
    const authors = fields['author'] ?? '';
    const journal = fields['journal'] ?? fields['journaltitle'] ?? '';
    const container = journal || fields['booktitle'] || fields['publisher'] || '';
    entries.push({
      type: entryType,
      entryType,
      key,
      title: fields['title'] ?? '',
      authors,
      author: authors,
      journal,
      container,
      year: yearFromFields(fields),
      fields,
      raw: text.slice(entryStart, entryEnd),
      range: { start: entryStart, end: entryEnd },
    });
    index = entryEnd;
  }

  return entries;
}

/** Short name for parseBibTeXEntries. */
export function parseBibTeX(text: string): readonly BibTeXEntry[] {
  return parseBibTeXEntries(text);
}

export function indexBibTeX(text: string): BibTeXIndex {
  const entries = parseBibTeXEntries(text);
  const byKey = new Map<string, BibTeXEntry>();
  for (const entry of entries) {
    if (!byKey.has(entry.key)) {
      byKey.set(entry.key, entry);
    }
  }
  return { entries, byKey };
}

/** Detect the line ending already used by text, falling back to LF. */
export function detectLineEnding(text: string, fallbackText = ''): '\n' | '\r\n' {
  const firstCrLf = text.indexOf('\r\n');
  const firstLf = text.indexOf('\n');
  if (firstCrLf >= 0 && (firstLf < 0 || firstCrLf <= firstLf)) {
    return '\r\n';
  }
  if (firstLf >= 0) {
    return '\n';
  }
  return fallbackText.includes('\r\n') ? '\r\n' : '\n';
}

function trailingLineEndingCount(text: string): number {
  let count = 0;
  let index = text.length;
  while (index > 0) {
    if (index >= 2 && text.slice(index - 2, index) === '\r\n') {
      count += 1;
      index -= 2;
    } else if (text[index - 1] === '\n' || text[index - 1] === '\r') {
      count += 1;
      index -= 1;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Format text to insert at EOF when adding a BibTeX entry. The block uses the
 * file's existing LF/CRLF convention, separates entries by one blank line, and
 * leaves the file with a final newline.
 */
export function formatBibTeXAppendBlock(existingText: string, rawEntry: string): string {
  const trimmedEntry = rawEntry.trim();
  if (trimmedEntry.length === 0) {
    return '';
  }
  const lineEnding = detectLineEnding(existingText, rawEntry);
  const entry = trimmedEntry.replace(/\r\n?|\n/gu, lineEnding);
  if (existingText.length === 0) {
    return `${entry}${lineEnding}`;
  }
  const trailingLines = trailingLineEndingCount(existingText);
  const prefix = trailingLines >= 2
    ? ''
    : lineEnding.repeat(2 - trailingLines);
  return `${prefix}${entry}${lineEnding}`;
}

/** Return the complete .bib text after a safe append. */
export function appendBibTeXEntry(existingText: string, rawEntry: string): string {
  return existingText + formatBibTeXAppendBlock(existingText, rawEntry);
}

/** Normalize search text with case, punctuation, and Unicode accents folded. */
export function normalizeReferenceSearchText(value: string): string {
  return foldReferenceSearchUnicode(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function foldReferenceSearchUnicode(value: string): string {
  return value
    .replace(/[Ææ]/gu, 'ae')
    .replace(/[Œœ]/gu, 'oe')
    .replace(/[Øø]/gu, 'o')
    .replace(/[Łł]/gu, 'l')
    .replace(/[ÐðĐđ]/gu, 'd')
    .replace(/[Þþ]/gu, 'th')
    .replace(/[ßẞ]/gu, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US');
}

export const MAX_CITATION_SEARCH_QUERY_LENGTH = 512;
export const MAX_CITATION_SEARCH_TERMS = 32;

export interface CitationSearchIdentifiers {
  readonly doi?: string;
  readonly isbn?: string;
}

export interface PreparedCitationSearchReference<
  T extends CitationReference = CitationReference,
> {
  readonly reference: T;
  readonly canonicalKey: string;
  readonly compactKey: string;
  readonly fields: readonly CitationSearchField[];
  readonly canonicalDoi: string;
  readonly canonicalIsbns: readonly string[];
  readonly tieBreak: string;
}

interface CitationSearchField {
  readonly value: string;
  readonly words: readonly string[];
  readonly priority: number;
}

export type CitationSearchMatchKind =
  | 'key-exact'
  | 'key-compact-exact'
  | 'key-prefix'
  | 'doi-exact'
  | 'doi-prefix'
  | 'isbn-exact'
  | 'isbn-prefix'
  | 'all-words'
  | 'word-prefix'
  | 'substring'
  | 'empty';

export interface CitationSearchMatch {
  readonly kind: CitationSearchMatchKind;
  /** Lower values are more relevant. */
  readonly rank: number;
  /** Lower values break ties inside the same rank. */
  readonly quality: number;
}

export interface RankedCitationSearchReference<
  T extends CitationReference = CitationReference,
> {
  readonly prepared: PreparedCitationSearchReference<T>;
  readonly match: CitationSearchMatch;
}

interface PreparedCitationSearchQuery {
  readonly canonicalKey: string;
  readonly compactKey: string;
  readonly canonicalDoi: string;
  readonly canonicalIsbn: string;
  readonly terms: readonly string[];
}

/** Normalize once when a bibliography or Zotero snapshot is built. */
export function prepareCitationSearchReference<T extends CitationReference>(
  reference: T,
  identifiers: CitationSearchIdentifiers = {},
): PreparedCitationSearchReference<T> {
  const normalizedTitle = boundedSearchField(reference.title, 2_048);
  const normalizedAuthors = boundedSearchField(reference.authors, 2_048);
  const normalizedYear = boundedSearchField(reference.year, 64);
  const normalizedKey = boundedSearchField(reference.key, 512);
  const canonicalKey = normalizeCitationKeyForSearch(reference.key).slice(0, 512);
  const canonicalDoi = normalizeCitationDoi(identifiers.doi ?? '');
  const canonicalIsbns = normalizeCitationIsbns(identifiers.isbn ?? '');
  const identifierFields = [canonicalDoi, ...canonicalIsbns]
    .map((value) => boundedSearchField(value, 512))
    .filter((value) => value.length > 0);
  const titleTie = normalizedTitle.length > 0
    ? `0:${normalizedTitle}`
    : '1:';
  return {
    reference,
    canonicalKey,
    compactKey: compactReferenceSearchText(canonicalKey).slice(0, 512),
    fields: [
      citationSearchField(normalizedKey, 0),
      ...identifierFields.map((value) => citationSearchField(value, 1)),
      citationSearchField(normalizedYear, 2),
      citationSearchField(normalizedTitle, 3),
      citationSearchField(normalizedAuthors, 4),
    ],
    canonicalDoi,
    canonicalIsbns,
    tieBreak: [
      titleTie,
      normalizedYear,
      normalizedAuthors,
      canonicalKey,
      reference.key,
    ].join('\u0000'),
  };
}

/** Match a query without renormalizing reference metadata on every keystroke. */
export function matchPreparedCitationReference(
  prepared: PreparedCitationSearchReference,
  query: string,
): CitationSearchMatch | undefined {
  const preparedQuery = prepareCitationSearchQuery(query);
  if (preparedQuery === undefined) {
    return undefined;
  }
  return matchPreparedCitationSearchQuery(prepared, preparedQuery);
}

/** Rank a complete source before callers impose any UI-only result limit. */
export function rankCitationReferences<T extends CitationReference>(
  preparedReferences: readonly PreparedCitationSearchReference<T>[],
  query: string,
): readonly RankedCitationSearchReference<T>[] {
  const preparedQuery = prepareCitationSearchQuery(query);
  if (preparedQuery === undefined) {
    return [];
  }
  const ranked: RankedCitationSearchReference<T>[] = [];
  for (const prepared of preparedReferences) {
    const match = matchPreparedCitationSearchQuery(prepared, preparedQuery);
    if (match !== undefined) {
      ranked.push({ prepared, match });
    }
  }
  ranked.sort(compareRankedCitationSearchReferences);
  return ranked;
}

export function compareCitationSearchMatches(
  left: CitationSearchMatch,
  right: CitationSearchMatch,
): number {
  return left.rank - right.rank || left.quality - right.quality;
}

export function citationSearchMatchSortText(match: CitationSearchMatch): string {
  return `${String(match.rank).padStart(2, '0')}:${String(match.quality).padStart(6, '0')}`;
}

export function referenceMatchesQuery(
  reference: CitationReference,
  query: string,
): boolean {
  return matchPreparedCitationReference(
    prepareCitationSearchReference(reference),
    query,
  ) !== undefined;
}

/** Preserve source order while filtering by key, title, author, and year. */
export function filterReferences<T extends CitationReference>(
  references: readonly T[],
  query: string,
): readonly T[] {
  return references.filter((reference) => referenceMatchesQuery(reference, query));
}

/** Explicit alias for adapters that use the longer citation-specific name. */
export function filterCitationReferences<T extends CitationReference>(
  references: readonly T[],
  query: string,
): readonly T[] {
  return filterReferences(references, query);
}

function prepareCitationSearchQuery(
  query: string,
): PreparedCitationSearchQuery | undefined {
  if (query.length > MAX_CITATION_SEARCH_QUERY_LENGTH) {
    return undefined;
  }
  const normalized = normalizeReferenceSearchText(query);
  const terms = [...new Set(normalized.split(' ').filter((term) => term.length > 0))]
    .sort(compareSearchStrings);
  if (terms.length > MAX_CITATION_SEARCH_TERMS) {
    return undefined;
  }
  const raw = query.trim();
  return {
    canonicalKey: normalizeCitationKeyForSearch(raw),
    compactKey: compactReferenceSearchText(raw),
    canonicalDoi: normalizeCitationDoi(raw),
    canonicalIsbn: normalizeCitationIsbnQuery(raw),
    terms,
  };
}

function matchPreparedCitationSearchQuery(
  prepared: PreparedCitationSearchReference,
  query: PreparedCitationSearchQuery,
): CitationSearchMatch | undefined {
  if (query.terms.length === 0) {
    return { kind: 'empty', rank: 99, quality: 0 };
  }
  if (
    query.canonicalKey.length > 0 &&
    query.canonicalKey === prepared.canonicalKey
  ) {
    return { kind: 'key-exact', rank: 0, quality: 0 };
  }
  if (
    query.compactKey.length >= 2 &&
    query.compactKey === prepared.compactKey
  ) {
    return { kind: 'key-compact-exact', rank: 1, quality: 0 };
  }
  if (
    query.canonicalKey.length >= 2 &&
    (prepared.canonicalKey.startsWith(query.canonicalKey) ||
      (query.compactKey.length >= 2 && prepared.compactKey.startsWith(query.compactKey)))
  ) {
    const keyLength = Math.min(prepared.compactKey.length, 999);
    return {
      kind: 'key-prefix',
      rank: 2,
      quality: Math.max(0, keyLength - Math.min(query.compactKey.length, keyLength)),
    };
  }
  if (
    query.canonicalDoi.length > 0 &&
    query.canonicalDoi === prepared.canonicalDoi
  ) {
    return { kind: 'doi-exact', rank: 3, quality: 0 };
  }
  if (
    query.canonicalDoi.length >= 8 &&
    prepared.canonicalDoi.startsWith(query.canonicalDoi)
  ) {
    return {
      kind: 'doi-prefix',
      rank: 4,
      quality: Math.min(999, prepared.canonicalDoi.length - query.canonicalDoi.length),
    };
  }
  if (
    query.canonicalIsbn.length > 0 &&
    prepared.canonicalIsbns.includes(query.canonicalIsbn)
  ) {
    return { kind: 'isbn-exact', rank: 5, quality: 0 };
  }
  if (
    query.canonicalIsbn.length >= 6 &&
    prepared.canonicalIsbns.some((isbn) => isbn.startsWith(query.canonicalIsbn))
  ) {
    return { kind: 'isbn-prefix', rank: 6, quality: 0 };
  }

  let worstClass = 0;
  let quality = 0;
  for (const term of query.terms) {
    let best: { readonly matchClass: number; readonly field: number } | undefined;
    for (const field of prepared.fields) {
      const matchClass = citationTermMatchClass(field, term);
      if (
        matchClass !== undefined &&
        (best === undefined ||
          matchClass < best.matchClass ||
          (matchClass === best.matchClass && field.priority < best.field))
      ) {
        best = { matchClass, field: field.priority };
      }
    }
    if (best === undefined) {
      return undefined;
    }
    worstClass = Math.max(worstClass, best.matchClass);
    quality += best.matchClass * 10 + best.field;
  }
  return {
    kind: worstClass === 0
      ? 'all-words'
      : worstClass === 1
        ? 'word-prefix'
        : 'substring',
    rank: 7 + worstClass,
    quality: Math.min(999_999, quality),
  };
}

function citationTermMatchClass(
  field: CitationSearchField,
  term: string,
): number | undefined {
  if (field.value.length === 0) {
    return undefined;
  }
  if (field.value === term || field.words.some((word) => word === term)) {
    return 0;
  }
  if (field.words.some((word) => word.startsWith(term))) {
    return 1;
  }
  if (isSingleLatinSearchTerm(term)) {
    return undefined;
  }
  return field.value.includes(term) ? 2 : undefined;
}

function isSingleLatinSearchTerm(term: string): boolean {
  return /^[a-z0-9]$/u.test(term);
}

function compareRankedCitationSearchReferences<T extends CitationReference>(
  left: RankedCitationSearchReference<T>,
  right: RankedCitationSearchReference<T>,
): number {
  return (
    compareCitationSearchMatches(left.match, right.match) ||
    compareSearchStrings(left.prepared.tieBreak, right.prepared.tieBreak)
  );
}

function compareSearchStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedSearchField(value: string, maximum: number): string {
  return normalizeReferenceSearchText(value).slice(0, maximum);
}

function citationSearchField(value: string, priority: number): CitationSearchField {
  return {
    value,
    words: value.length > 0 ? value.split(' ') : [],
    priority,
  };
}

function normalizeCitationKeyForSearch(value: string): string {
  return foldReferenceSearchUnicode(value).trim().replace(/\s+/gu, ' ');
}

function compactReferenceSearchText(value: string): string {
  return foldReferenceSearchUnicode(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeCitationDoi(value: string): string {
  const normalized = foldReferenceSearchUnicode(value)
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '')
    .replace(/^doi\s*:\s*/u, '')
    .replace(/\s+/gu, '')
    .replace(/[.,;]+$/u, '');
  return /^10\.\d{4,9}\/.+/u.test(normalized)
    ? normalized.slice(0, 512)
    : '';
}

function normalizeCitationIsbnQuery(value: string): string {
  const trimmed = value.trim();
  const marked = /^isbn(?:-1[03])?\s*:/iu.test(trimmed);
  const body = marked
    ? trimmed.replace(/^isbn(?:-1[03])?\s*:\s*/iu, '')
    : trimmed;
  // Do not reinterpret an ordinary multi-field query such as
  // "Smith 2017 2020" as one ISBN and bypass the AND-term matcher. An
  // unlabelled ISBN prefix may use digits/X and hyphens; whitespace is only
  // accepted after an explicit ISBN label.
  if (
    body.length === 0 ||
    !(marked ? /^[0-9X\s-]+$/iu : /^[0-9X-]+$/iu).test(body)
  ) {
    return '';
  }
  const canonical = foldReferenceSearchUnicode(body)
    .toLocaleUpperCase('en-US')
    .replace(/[^0-9X]/gu, '');
  return canonical.length >= 6 && canonical.length <= 13 ? canonical : '';
}

function normalizeCitationIsbns(value: string): readonly string[] {
  const result = new Set<string>();
  for (const part of value.split(/[,;]+/u)) {
    const canonical = part
      .toLocaleUpperCase('en-US')
      .replace(/[^0-9X]/gu, '');
    if (canonical.length === 10 || canonical.length === 13) {
      result.add(canonical);
    }
  }
  return [...result].sort(compareSearchStrings);
}
