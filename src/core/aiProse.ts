/**
 * Pure helpers for presenting LaTeX prose to a remote writing assistant.
 *
 * Every returned segment has the same UTF-16 length as its source slice.
 * LaTeX syntax and non-prose contents are replaced with spaces. Math is
 * represented by fixed-width, protected semantic placeholders, so the model
 * can still understand its grammatical role without seeing formula contents.
 * Every replacement preserves UTF-16 length, therefore a segment-relative
 * offset maps to `sourceStart + offset`.
 * Callers must still use `planAiProseIssues` before applying untrusted edits.
 */

export interface AiProseOffsetRange {
  readonly start: number;
  readonly end: number;
}

export interface AiProseSegment {
  readonly id: string;
  /** Natural-language view. Protected characters are represented by spaces. */
  readonly text: string;
  /** Inclusive UTF-16 offset in the source document. */
  readonly sourceStart: number;
  /** Exclusive UTF-16 offset in the source document. */
  readonly sourceEnd: number;
  /** Segment-relative ranges which a model is allowed to replace. */
  readonly editableRanges: readonly AiProseOffsetRange[];
}

export interface AiProseDocument {
  readonly sourceLength: number;
  readonly segments: readonly AiProseSegment[];
}

export interface AiProseDocumentReviewSelection {
  readonly segments: readonly AiProseSegment[];
  readonly totalCharacters: number;
  readonly truncated: boolean;
}

export interface AiProseSelection {
  readonly segmentId: string;
  /** Segment-relative UTF-16 offsets. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export type AiProseIssueSeverity = 'error' | 'warning' | 'information' | 'hint';

/** Untrusted, model-produced issue using offsets in one AiProseSegment. */
export interface AiProseIssue {
  readonly start: number;
  readonly end: number;
  readonly original: string;
  readonly replacement: string;
  readonly message?: string;
  readonly explanation?: string;
  readonly category?: string;
  readonly severity?: AiProseIssueSeverity;
}

export interface PlannedAiProseEdit extends AiProseIssue {
  readonly issueIndex: number;
  readonly segmentId: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

export type AiProseIssueRejectionReason =
  | 'invalid-segment'
  | 'invalid-shape'
  | 'invalid-offsets'
  | 'out-of-bounds'
  | 'original-mismatch'
  | 'protected-source'
  | 'multiline-source'
  | 'unsafe-replacement'
  | 'replacement-already-present'
  | 'unchanged'
  | 'overlap';

export interface RejectedAiProseIssue {
  readonly issueIndex: number;
  readonly reason: AiProseIssueRejectionReason;
}

export interface AiProseIssuePlan {
  /** Validated edits sorted by ascending source offset. */
  readonly edits: readonly PlannedAiProseEdit[];
  readonly rejected: readonly RejectedAiProseIssue[];
}

export interface AiProseIssuePlanOptions {
  /** Defaults to 2048 UTF-16 code units. */
  readonly maxReplacementLength?: number;
}

const DEFAULT_MAX_REPLACEMENT_LENGTH = 2048;

const MATH_ENVIRONMENTS = new Set([
  'math',
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
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
]);

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim',
  'Verbatim',
  'lstlisting',
  'minted',
]);

/** Environments whose body is expected to contain reviewable prose. */
const PROSE_ENVIRONMENTS = new Set([
  'document',
  'abstract',
  'proof',
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'definition',
  'remark',
  'example',
  'exercise',
  'solution',
  'quote',
  'quotation',
  'verse',
  'itemize',
  'enumerate',
  'description',
  'center',
  'flushleft',
  'flushright',
  'minipage',
  'figure',
  'table',
  'frame',
  'block',
  'alertblock',
  'exampleblock',
  'columns',
  'column',
]);

/** Commands whose braced contents are ordinary prose and should be reviewed. */
const PROSE_ARGUMENT_COMMANDS = new Set([
  'part',
  'chapter',
  'section',
  'subsection',
  'subsubsection',
  'paragraph',
  'subparagraph',
  'title',
  'subtitle',
  'caption',
  'footnote',
  'footnotetext',
  'marginpar',
  'emph',
  'textbf',
  'textit',
  'textmd',
  'textrm',
  'textsf',
  'texttt',
  'textup',
  'textsl',
  'textsc',
  'underline',
  'mbox',
  'texorpdfstring',
]);

/** Number of opaque mandatory arguments before the command's prose argument. */
const TAIL_PROSE_ARGUMENT_COMMANDS = new Map<string, number>([
  ['captionof', 1],
  ['foreignlanguage', 1],
  ['textcolor', 1],
  ['colorbox', 1],
  ['fcolorbox', 2],
  ['rotatebox', 1],
  ['makebox', 0],
  ['parbox', 1],
]);

const OPAQUE_ARGUMENT_COMMANDS = new Set([
  'label',
  'tag',
  'ref',
  'pageref',
  'eqref',
  'autoref',
  'nameref',
  'vref',
  'Vref',
  'cref',
  'Cref',
  'url',
  'nolinkurl',
  'path',
  'includegraphics',
  'input',
  'include',
  'subfile',
  'import',
  'subimport',
  'includepdf',
  'bibliography',
  'bibliographystyle',
  'addbibresource',
  'usepackage',
  'RequirePackage',
  'documentclass',
  'setlength',
  'addtolength',
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareMathOperator',
  'newenvironment',
  'renewenvironment',
  'ensuremath',
  'frac',
  'dfrac',
  'tfrac',
  'sqrt',
]);

const LINK_COMMANDS = new Set(['href', 'hyperlink']);
const LITERAL_PERCENT_ARGUMENT_COMMANDS = new Set(['url', 'nolinkurl', 'path']);
const DELIMITED_INLINE_COMMANDS = new Set(['verb', 'Verb', 'lstinline', 'mintinline']);

const LINE_DEFINITION_COMMANDS = new Set(['def', 'gdef', 'edef', 'xdef']);

interface ParsedCommand {
  readonly name: string;
  readonly end: number;
}

interface ParsedGroup {
  readonly start: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
}

type AiProtectedPlaceholderKind = 'inline-math' | 'display-math';

interface AiProtectedPlaceholderRange extends AiProseOffsetRange {
  readonly kind: AiProtectedPlaceholderKind;
}

interface AiEditableMask {
  readonly editable: readonly boolean[];
  readonly placeholders: readonly AiProtectedPlaceholderRange[];
}

function normalizedEnvironmentName(name: string): string {
  return name.endsWith('*') ? name.slice(0, -1) : name;
}

function isEnvironment(name: string, candidates: ReadonlySet<string>): boolean {
  return candidates.has(name) || candidates.has(normalizedEnvironmentName(name));
}

function parseCommand(text: string, slashOffset: number): ParsedCommand {
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { name: '', end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/u.test(first)) {
    return { name: first, end: Math.min(text.length, slashOffset + 2) };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/u.test(text[end] ?? '')) {
    end += 1;
  }
  const nameEnd = end;
  if (text[end] === '*') {
    end += 1;
  }
  return { name: text.slice(slashOffset + 1, nameEnd), end };
}

function skipTeXTrivia(text: string, offset: number): number {
  let cursor = offset;
  while (cursor < text.length) {
    const char = text[cursor] ?? '';
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === '%' && precedingBackslashCount(text, cursor) % 2 === 0) {
      cursor += 1;
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
        cursor += 1;
      }
      continue;
    }
    break;
  }
  return cursor;
}

function parseBalancedGroup(
  text: string,
  from: number,
  opening: '{' | '[',
  options: { readonly commentsAreTrivia?: boolean } = {},
): ParsedGroup | undefined {
  const start = skipTeXTrivia(text, from);
  if (text[start] !== opening) {
    return undefined;
  }
  const closing = opening === '{' ? '}' : ']';
  let depth = 1;
  let cursor = start + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (options.commentsAreTrivia !== false
      && char === '%'
      && precedingBackslashCount(text, cursor) % 2 === 0) {
      cursor += 1;
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
        cursor += 1;
      }
      continue;
    }
    if (char === '\\') {
      const command = parseCommand(text, cursor);
      cursor = Math.max(cursor + 1, command.end);
      continue;
    }
    if (char === opening) {
      depth += 1;
    } else if (char === closing) {
      depth -= 1;
      if (depth === 0) {
        return {
          start,
          contentStart: start + 1,
          contentEnd: cursor,
          end: cursor + 1,
        };
      }
    }
    cursor += 1;
  }
  return {
    start,
    contentStart: start + 1,
    contentEnd: text.length,
    end: text.length,
  };
}

function groupValue(text: string, group: ParsedGroup): string {
  return text.slice(group.contentStart, group.contentEnd).trim();
}

function setProtected(editable: boolean[], start: number, end: number): void {
  const boundedStart = Math.max(0, Math.min(start, editable.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, editable.length));
  for (let index = boundedStart; index < boundedEnd; index += 1) {
    editable[index] = false;
  }
}

function protectGroupDelimiters(editable: boolean[], group: ParsedGroup): void {
  setProtected(editable, group.start, group.contentStart);
  if (group.contentEnd < group.end) {
    setProtected(editable, group.contentEnd, group.end);
  }
}

function commandHasOpaqueArguments(name: string): boolean {
  if (OPAQUE_ARGUMENT_COMMANDS.has(name)) {
    return true;
  }
  return /^(?:[A-Za-z]*cite[A-Za-z]*|nocite)\*?$/u.test(name);
}

function skipDelimitedInlineCommand(
  text: string,
  command: ParsedCommand,
): number | undefined {
  if (!DELIMITED_INLINE_COMMANDS.has(command.name)) {
    return undefined;
  }

  let cursor = command.end;
  if (command.name === 'Verb'
    || command.name === 'lstinline'
    || command.name === 'mintinline') {
    const optional = parseBalancedGroup(text, cursor, '[');
    if (optional !== undefined) {
      cursor = optional.end;
    }
  }
  if (command.name === 'mintinline') {
    const language = parseBalancedGroup(text, cursor, '{');
    if (language === undefined) {
      return command.end;
    }
    cursor = language.end;
    const bracedCode = parseBalancedGroup(
      text,
      cursor,
      '{',
      { commentsAreTrivia: false },
    );
    if (bracedCode !== undefined) {
      return bracedCode.end;
    }
    cursor = skipTeXTrivia(text, cursor);
  }

  const delimiter = text[cursor];
  if (delimiter === undefined || delimiter === '\r' || delimiter === '\n') {
    return command.end;
  }
  const close = text.indexOf(delimiter, cursor + 1);
  return close < 0 ? text.length : close + 1;
}

function skipCommandGroupsForEnvironment(
  text: string,
  command: ParsedCommand,
): number {
  let cursor = command.end;
  const groupOptions = LITERAL_PERCENT_ARGUMENT_COMMANDS.has(command.name)
    ? { commentsAreTrivia: false }
    : undefined;
  while (cursor < text.length) {
    const optional = parseBalancedGroup(text, cursor, '[', groupOptions);
    const mandatory = optional === undefined
      ? parseBalancedGroup(text, cursor, '{', groupOptions)
      : undefined;
    const group = optional ?? mandatory;
    if (group === undefined) {
      break;
    }
    cursor = group.end;
  }
  return cursor;
}

function findVerbatimEnvironmentEnd(
  text: string,
  from: number,
  environmentName: string,
): number {
  let lineStart = from;
  while (lineStart < text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') {
      lineEnd += 1;
    }
    let cursor = lineStart;
    while (cursor < lineEnd && (text[cursor] === ' ' || text[cursor] === '\t')) {
      cursor += 1;
    }
    const closing = `\\end{${environmentName}}`;
    if (text.startsWith(closing, cursor)) {
      const closingEnd = cursor + closing.length;
      if (closingEnd <= lineEnd
        && text.slice(closingEnd, lineEnd).trim().length === 0) {
        return closingEnd;
      }
    }
    lineStart = lineEnd;
    if (text[lineStart] === '\r') {
      lineStart += 1;
    }
    if (text[lineStart] === '\n') {
      lineStart += 1;
    }
  }
  return text.length;
}

function findEnvironmentEnd(text: string, from: number, environmentName: string): number {
  let depth = 1;
  let groupDepth = 0;
  let cursor = from;
  let inComment = false;

  while (cursor < text.length) {
    const char = text[cursor];
    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      cursor += 1;
      continue;
    }
    if (char === '%' && precedingBackslashCount(text, cursor) % 2 === 0) {
      inComment = true;
      cursor += 1;
      continue;
    }
    if (char === '{') {
      groupDepth += 1;
      cursor += 1;
      continue;
    }
    if (char === '}') {
      groupDepth = Math.max(0, groupDepth - 1);
      cursor += 1;
      continue;
    }
    if (char !== '\\') {
      cursor += 1;
      continue;
    }
    const command = parseCommand(text, cursor);
    const inlineEnd = skipDelimitedInlineCommand(text, command);
    if (inlineEnd !== undefined) {
      cursor = Math.max(cursor + 1, inlineEnd);
      continue;
    }
    if (command.name !== 'begin' && command.name !== 'end') {
      cursor = Math.max(cursor + 1, skipCommandGroupsForEnvironment(text, command));
      continue;
    }
    if (groupDepth !== 0) {
      cursor = Math.max(cursor + 1, skipCommandGroupsForEnvironment(text, command));
      continue;
    }
    const group = parseBalancedGroup(text, command.end, '{');
    if (group === undefined || groupValue(text, group) !== environmentName) {
      cursor = Math.max(cursor + 1, command.end);
      continue;
    }
    if (command.name === 'begin') {
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) {
        return group.end;
      }
    }
    cursor = group.end;
  }

  return text.length;
}

function precedingBackslashCount(text: string, offset: number): number {
  let count = 0;
  for (let cursor = offset - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    count += 1;
  }
  return count;
}

function findUnescapedToken(text: string, token: string, from: number): number | undefined {
  let cursor = from;
  while (cursor <= text.length - token.length) {
    if (text[cursor] === '%' && precedingBackslashCount(text, cursor) % 2 === 0) {
      cursor += 1;
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
        cursor += 1;
      }
      continue;
    }
    if (text.startsWith(token, cursor)
      && precedingBackslashCount(text, cursor) % 2 === 0) {
      return cursor;
    }
    cursor += 1;
  }
  return undefined;
}

function findDollarMathEnd(text: string, from: number, token: '$' | '$$'): number {
  let cursor = from;
  while (cursor <= text.length - token.length) {
    if (text[cursor] === '%' && precedingBackslashCount(text, cursor) % 2 === 0) {
      cursor += 1;
      while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') {
        cursor += 1;
      }
      continue;
    }
    if (text.startsWith(token, cursor)
      && precedingBackslashCount(text, cursor) % 2 === 0) {
      if (token === '$' && text[cursor + 1] === '$') {
        cursor += 2;
        continue;
      }
      return cursor + token.length;
    }
    cursor += 1;
  }
  return text.length;
}

function protectCommandArguments(
  text: string,
  editable: boolean[],
  command: ParsedCommand,
): number {
  let cursor = command.end;
  let consumedEnd = command.end;
  const groupOptions = LITERAL_PERCENT_ARGUMENT_COMMANDS.has(command.name)
    ? { commentsAreTrivia: false }
    : undefined;
  while (cursor < text.length) {
    const optional = parseBalancedGroup(text, cursor, '[', groupOptions);
    const mandatory = optional === undefined
      ? parseBalancedGroup(text, cursor, '{', groupOptions)
      : undefined;
    const group = optional ?? mandatory;
    if (group === undefined) {
      break;
    }
    setProtected(editable, cursor, group.end);
    cursor = group.end;
    consumedEnd = group.end;
  }
  return consumedEnd;
}

function markProseCommandGroups(
  text: string,
  editable: boolean[],
  command: ParsedCommand,
): void {
  let cursor = command.end;
  let groupCount = 0;
  while (groupCount < 8) {
    const optional = parseBalancedGroup(text, cursor, '[');
    const mandatory = optional === undefined
      ? parseBalancedGroup(text, cursor, '{')
      : undefined;
    const group = optional ?? mandatory;
    if (group === undefined) {
      break;
    }
    setProtected(editable, cursor, group.start);
    protectGroupDelimiters(editable, group);
    cursor = group.end;
    groupCount += 1;
  }
}

function protectLinkTarget(
  text: string,
  editable: boolean[],
  command: ParsedCommand,
): void {
  let cursor = command.end;
  const optional = parseBalancedGroup(text, cursor, '[');
  if (optional !== undefined) {
    setProtected(editable, cursor, optional.end);
    cursor = optional.end;
  }
  // url-like command arguments change catcodes and commonly contain literal
  // percent escapes. The whole target is protected, so treating `%` as data
  // here preserves the following visible label without exposing the URL.
  const target = parseBalancedGroup(text, cursor, '{', { commentsAreTrivia: false });
  if (target === undefined) {
    return;
  }
  setProtected(editable, cursor, target.end);
  cursor = target.end;
  const label = parseBalancedGroup(text, cursor, '{');
  if (label !== undefined) {
    setProtected(editable, cursor, label.start);
    protectGroupDelimiters(editable, label);
  }
}

function markTailProseCommandGroup(
  text: string,
  editable: boolean[],
  command: ParsedCommand,
  opaqueMandatoryCount: number,
): void {
  let cursor = command.end;
  let optionalCount = 0;
  while (optionalCount < 4) {
    const optional = parseBalancedGroup(text, cursor, '[');
    if (optional === undefined) {
      break;
    }
    setProtected(editable, cursor, optional.end);
    cursor = optional.end;
    optionalCount += 1;
  }
  for (let index = 0; index < opaqueMandatoryCount; index += 1) {
    const opaque = parseBalancedGroup(text, cursor, '{');
    if (opaque === undefined) {
      return;
    }
    setProtected(editable, cursor, opaque.end);
    cursor = opaque.end;
  }
  const prose = parseBalancedGroup(text, cursor, '{');
  if (prose !== undefined) {
    setProtected(editable, cursor, prose.start);
    protectGroupDelimiters(editable, prose);
  }
}

function buildEditableMask(source: string): AiEditableMask {
  const editable = Array.from<boolean>({ length: source.length }).fill(true);
  const placeholders: AiProtectedPlaceholderRange[] = [];
  const protectMath = (
    start: number,
    end: number,
    kind: AiProtectedPlaceholderKind,
  ): void => {
    setProtected(editable, start, end);
    if (end > start) {
      placeholders.push({ start, end, kind });
    }
  };
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    // Previously discovered opaque arguments may contain TeX-looking bytes
    // such as `%` in a URL. They must not influence the outer scan.
    if (editable[index] === false) {
      index += 1;
      continue;
    }

    if (char === '%') {
      let end = index + 1;
      while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
        end += 1;
      }
      setProtected(editable, index, end);
      index = end;
      continue;
    }

    if (char === '$') {
      const token: '$' | '$$' = source[index + 1] === '$' ? '$$' : '$';
      const end = findDollarMathEnd(source, index + token.length, token);
      protectMath(index, end, token === '$$' ? 'display-math' : 'inline-math');
      index = end;
      continue;
    }

    if (char === '{' || char === '}') {
      editable[index] = false;
      index += 1;
      continue;
    }

    if (char !== '\\') {
      index += 1;
      continue;
    }

    const commandStart = index;
    const command = parseCommand(source, index);
    setProtected(editable, commandStart, command.end);

    if (command.name === '(' || command.name === '[') {
      const closing = command.name === '(' ? '\\)' : '\\]';
      const closeStart = findUnescapedToken(source, closing, command.end);
      const end = closeStart === undefined ? source.length : closeStart + closing.length;
      protectMath(
        commandStart,
        end,
        command.name === '[' ? 'display-math' : 'inline-math',
      );
      index = end;
      continue;
    }

    if (DELIMITED_INLINE_COMMANDS.has(command.name)) {
      const end = skipDelimitedInlineCommand(source, command);
      if (end === undefined) {
        index = command.end;
        continue;
      }
      setProtected(editable, commandStart, end);
      index = end;
      continue;
    }

    if (command.name === 'begin' || command.name === 'end') {
      const group = parseBalancedGroup(source, command.end, '{');
      if (group === undefined) {
        index = command.end;
        continue;
      }
      setProtected(editable, command.end, group.end);
      const environmentName = groupValue(source, group);
      if (
        command.name === 'begin'
        && (!isEnvironment(environmentName, PROSE_ENVIRONMENTS)
          || isEnvironment(environmentName, MATH_ENVIRONMENTS)
          || isEnvironment(environmentName, VERBATIM_ENVIRONMENTS))
      ) {
        const end = isEnvironment(environmentName, VERBATIM_ENVIRONMENTS)
          ? findVerbatimEnvironmentEnd(source, group.end, environmentName)
          : findEnvironmentEnd(source, group.end, environmentName);
        if (isEnvironment(environmentName, MATH_ENVIRONMENTS)) {
          protectMath(
            commandStart,
            end,
            normalizedEnvironmentName(environmentName) === 'math'
              ? 'inline-math'
              : 'display-math',
          );
        } else {
          setProtected(editable, commandStart, end);
        }
        index = end;
      } else {
        if (command.name === 'begin') {
          const optional = parseBalancedGroup(source, group.end, '[');
          if (optional !== undefined) {
            setProtected(editable, group.end, optional.end);
          }
        }
        index = group.end;
      }
      continue;
    }

    if (LINK_COMMANDS.has(command.name)) {
      protectLinkTarget(source, editable, command);
      index = command.end;
      continue;
    }

    if (LINE_DEFINITION_COMMANDS.has(command.name)) {
      let end = command.end;
      while (end < source.length && source[end] !== '\n' && source[end] !== '\r') {
        end += 1;
      }
      setProtected(editable, commandStart, end);
      index = end;
      continue;
    }

    if (commandHasOpaqueArguments(command.name)) {
      index = protectCommandArguments(source, editable, command);
      continue;
    }

    if (PROSE_ARGUMENT_COMMANDS.has(command.name)) {
      markProseCommandGroups(source, editable, command);
      index = command.end;
      continue;
    }


    const opaqueMandatoryCount = TAIL_PROSE_ARGUMENT_COMMANDS.get(command.name);
    if (opaqueMandatoryCount !== undefined) {
      markTailProseCommandGroup(source, editable, command, opaqueMandatoryCount);
      index = command.end;
      continue;
    }

    // Unknown commands are data/control macros until explicitly allowlisted.
    // Mask every immediately following optional or mandatory argument so
    // package metadata and custom code cannot be sent as ordinary prose.
    index = protectCommandArguments(source, editable, command);
  }

  return { editable, placeholders };
}

function semanticMathPlaceholder(
  length: number,
  kind: AiProtectedPlaceholderKind,
): string {
  if (length <= 0) {
    return '';
  }
  // All markers use BMP characters only: JavaScript string length therefore
  // remains identical to the protected source range's UTF-16 length.
  const candidates = kind === 'display-math'
    ? ['⟦DISPLAYED_FORMULA⟧', '⟦DISPLAY_MATH⟧', '⟦FORMULA⟧', '⟦MATH⟧', '⟦M⟧']
    : ['⟦INLINE_FORMULA⟧', '⟦MATH_EXPRESSION⟧', '⟦FORMULA⟧', '⟦MATH⟧', '⟦M⟧'];
  const marker = candidates.find((candidate) => candidate.length <= length)
    ?? '¤'.repeat(Math.min(2, length));
  return marker.padEnd(length, ' ');
}

function maskedSource(
  source: string,
  editable: readonly boolean[],
  placeholders: readonly AiProtectedPlaceholderRange[],
): string {
  const result = Array.from<string>({ length: source.length }).fill(' ');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (editable[index] === true || char === '\r' || char === '\n') {
      result[index] = char;
    }
  }
  for (const placeholder of placeholders) {
    const replacement = semanticMathPlaceholder(
      placeholder.end - placeholder.start,
      placeholder.kind,
    );
    for (let index = 0; index < replacement.length; index += 1) {
      result[placeholder.start + index] = replacement[index] ?? ' ';
    }
  }
  return result.join('');
}

function containsEditableAlphaNumeric(
  text: string,
  editableRanges: readonly AiProseOffsetRange[],
): boolean {
  return editableRanges.some((range) => (
    /[\p{L}\p{N}]/u.test(text.slice(range.start, range.end))
  ));
}

function trimWhitespace(text: string, start: number, end: number): AiProseOffsetRange {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/u.test(text[trimmedStart] ?? '')) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && /\s/u.test(text[trimmedEnd - 1] ?? '')) {
    trimmedEnd -= 1;
  }
  return { start: trimmedStart, end: trimmedEnd };
}

function editableRangesForSegment(
  editable: readonly boolean[],
  sourceStart: number,
  sourceEnd: number,
): readonly AiProseOffsetRange[] {
  const ranges: AiProseOffsetRange[] = [];
  let cursor = sourceStart;
  while (cursor < sourceEnd) {
    while (cursor < sourceEnd && editable[cursor] !== true) {
      cursor += 1;
    }
    if (cursor >= sourceEnd) {
      break;
    }
    const runStart = cursor;
    while (cursor < sourceEnd && editable[cursor] === true) {
      cursor += 1;
    }
    ranges.push({ start: runStart - sourceStart, end: cursor - sourceStart });
  }
  return ranges;
}

function splitParagraphRanges(text: string): readonly AiProseOffsetRange[] {
  const ranges: AiProseOffsetRange[] = [];
  const separator = /(?:\r\n|\r|\n)[ \t\f\v]*(?:(?:\r\n|\r|\n))+/gu;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const matchStart = match.index;
    const matchText = match[0];
    if (matchStart === undefined || matchText === undefined) {
      continue;
    }
    ranges.push({ start, end: matchStart });
    start = matchStart + matchText.length;
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

/** Extract paragraph-sized natural-language segments from a LaTeX document. */
export function extractAiProseDocument(source: string): AiProseDocument {
  const mask = buildEditableMask(source);
  const { editable } = mask;
  const masked = maskedSource(source, editable, mask.placeholders);
  const segments: AiProseSegment[] = [];

  for (const candidate of splitParagraphRanges(masked)) {
    const range = trimWhitespace(masked, candidate.start, candidate.end);
    if (range.start >= range.end) {
      continue;
    }
    const text = masked.slice(range.start, range.end);
    const editableRanges = editableRangesForSegment(editable, range.start, range.end);
    if (!containsEditableAlphaNumeric(text, editableRanges)) {
      continue;
    }
    segments.push({
      id: `p${segments.length + 1}`,
      text,
      sourceStart: range.start,
      sourceEnd: range.end,
      editableRanges,
    });
  }

  return { sourceLength: source.length, segments };
}

/** Map a segment-relative UTF-16 boundary to its source document boundary. */
export function aiProseOffsetToSourceOffset(
  segment: AiProseSegment,
  segmentOffset: number,
): number | undefined {
  if (!Number.isInteger(segmentOffset) || segmentOffset < 0 || segmentOffset > segment.text.length) {
    return undefined;
  }
  return segment.sourceStart + segmentOffset;
}

/** Find the paragraph segment containing (or immediately ending at) a cursor. */
export function findAiProseParagraphAtOffset(
  document: AiProseDocument,
  sourceOffset: number,
): AiProseSelection | undefined {
  if (!Number.isInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > document.sourceLength) {
    return undefined;
  }
  const segment = document.segments.find((candidate) => (
    sourceOffset >= candidate.sourceStart && sourceOffset <= candidate.sourceEnd
  ));
  if (segment === undefined) {
    return undefined;
  }
  return {
    segmentId: segment.id,
    start: 0,
    end: segment.text.length,
    text: segment.text,
    sourceStart: segment.sourceStart,
    sourceEnd: segment.sourceEnd,
  };
}

/**
 * Choose the paragraph that an idle automatic review should check. When an
 * edit just added only line-ending/blank-space characters, the cursor may sit
 * immediately after the segment that was actually changed; retain that prior
 * paragraph without crossing TeX syntax or an unbounded gap.
 */
export function findAiProseSegmentForIdleReview(
  source: string,
  document: AiProseDocument,
  sourceOffset: number,
): AiProseSegment | undefined {
  if (
    source.length !== document.sourceLength ||
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset > source.length
  ) {
    return undefined;
  }
  const containing = document.segments.find(
    (segment) =>
      sourceOffset >= segment.sourceStart && sourceOffset <= segment.sourceEnd,
  );
  if (containing !== undefined) {
    return containing;
  }
  const previous = [...document.segments]
    .reverse()
    .find((segment) => segment.sourceEnd < sourceOffset);
  if (
    previous === undefined ||
    sourceOffset - previous.sourceEnd > 256 ||
    !/^\s*$/u.test(source.slice(previous.sourceEnd, sourceOffset))
  ) {
    return undefined;
  }
  return previous;
}

/** Split every paragraph into source-stable sentence-sized review segments. */
export function aiProseSentenceSegments(
  document: AiProseDocument,
): readonly AiProseSegment[] {
  const sentences: AiProseSegment[] = [];
  for (const paragraph of document.segments) {
    const ranges = sentenceOffsetRanges(paragraph.text);
    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      if (range === undefined) {
        continue;
      }
      const sliced = sliceAiProseSegment(
        paragraph,
        range.start,
        range.end,
        `${paragraph.id}-s${index + 1}`,
      );
      if (sliced !== undefined) {
        sentences.push(sliced);
      }
    }
  }
  return sentences;
}

/** Find the sentence containing a source offset, using UTF-16 offsets. */
export function findAiProseSentenceSegmentAtOffset(
  document: AiProseDocument,
  sourceOffset: number,
): AiProseSegment | undefined {
  if (
    !Number.isSafeInteger(sourceOffset) ||
    sourceOffset < 0 ||
    sourceOffset > document.sourceLength
  ) {
    return undefined;
  }
  const paragraph = document.segments.find(
    (candidate) =>
      sourceOffset >= candidate.sourceStart &&
      sourceOffset <= candidate.sourceEnd,
  );
  if (paragraph === undefined) {
    return undefined;
  }
  const relative = sourceOffset - paragraph.sourceStart;
  const ranges = sentenceOffsetRanges(paragraph.text);
  let selected = ranges.find((range) =>
    relative >= range.start && relative < range.end
  );
  if (selected === undefined) {
    selected = ranges.find((range) => relative < range.start);
  }
  if (selected === undefined && relative === paragraph.text.length) {
    selected = ranges.at(-1);
  }
  return selected === undefined
    ? undefined
    : sliceAiProseSegment(
        paragraph,
        selected.start,
        selected.end,
        `${paragraph.id}-at-${selected.start}-${selected.end}`,
      );
}

/**
 * Choose a sentence for an idle review while retaining the previous sentence
 * when an edit ends immediately after punctuation or trailing whitespace.
 */
export function findAiProseSentenceSegmentForIdleReview(
  source: string,
  document: AiProseDocument,
  sourceOffset: number,
): AiProseSegment | undefined {
  const paragraph = findAiProseSegmentForIdleReview(
    source,
    document,
    sourceOffset,
  );
  if (paragraph === undefined) {
    return undefined;
  }
  const clamped = Math.max(
    paragraph.sourceStart,
    Math.min(sourceOffset, paragraph.sourceEnd),
  );
  const previousOffset = clamped > paragraph.sourceStart ? clamped - 1 : clamped;
  return findAiProseSentenceSegmentAtOffset(document, previousOffset) ??
    findAiProseSentenceSegmentAtOffset(document, clamped);
}

/** Select a bounded number of paragraphs for one explicit whole-document run. */
export function selectAiProseSegmentsForDocumentReview(
  segments: readonly AiProseSegment[],
  maxParagraphCharacters: number,
  maxDocumentCharacters: number,
  maxSegments: number,
): AiProseDocumentReviewSelection {
  if (
    !Number.isSafeInteger(maxParagraphCharacters) ||
    maxParagraphCharacters < 1 ||
    !Number.isSafeInteger(maxDocumentCharacters) ||
    maxDocumentCharacters < 1 ||
    !Number.isSafeInteger(maxSegments) ||
    maxSegments < 1
  ) {
    return { segments: [], totalCharacters: 0, truncated: segments.length > 0 };
  }
  const selected: AiProseSegment[] = [];
  let totalCharacters = 0;
  let truncated = false;
  for (const segment of segments) {
    if (segment.text.length > maxParagraphCharacters) {
      truncated = true;
      continue;
    }
    if (
      selected.length >= maxSegments ||
      totalCharacters + segment.text.length > maxDocumentCharacters
    ) {
      truncated = true;
      break;
    }
    selected.push(segment);
    totalCharacters += segment.text.length;
  }
  return { segments: selected, totalCharacters, truncated };
}

function isSentenceTerminator(char: string | undefined): boolean {
  return char !== undefined && /[.!?。！？]/u.test(char);
}

function isCjkSentenceTerminator(char: string | undefined): boolean {
  return char !== undefined && /[。！？]/u.test(char);
}

/**
 * Characters which can close a quotation or parenthetical sentence after its
 * terminal punctuation. Keep this explicit instead of using a broad Unicode
 * punctuation class: opening punctuation must remain attached to the next
 * sentence, and every consumed UTF-16 code unit changes source mapping.
 */
function isSentenceClosingPunctuation(char: string | undefined): boolean {
  return char !== undefined && /["'\u2019\u201d\u00bb\)\]\}\u3009\u300b\u300d\u300f\u3011\u3015\u3017\u3019\u301b\uff09\uff3d\uff5d]/u.test(char);
}

function sentenceOffsetRanges(text: string): readonly AiProseOffsetRange[] {
  const ranges: AiProseOffsetRange[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (!isSentenceTerminator(text[index])) {
      index += 1;
      continue;
    }
    let hasCjkTerminator = false;
    let after = index + 1;
    hasCjkTerminator = isCjkSentenceTerminator(text[index]);
    while (after < text.length && isSentenceTerminator(text[after])) {
      hasCjkTerminator ||= isCjkSentenceTerminator(text[after]);
      after += 1;
    }
    while (after < text.length && isSentenceClosingPunctuation(text[after])) {
      after += 1;
    }
    // CJK prose conventionally has no whitespace between sentences. ASCII
    // terminators still require whitespace/end-of-text so decimal numbers,
    // dotted identifiers, and common intra-word periods are not split.
    if (
      !hasCjkTerminator &&
      after < text.length &&
      !/\s/u.test(text[after] ?? '')
    ) {
      index = after;
      continue;
    }
    const range = trimWhitespace(text, start, after);
    if (
      range.start < range.end &&
      /[\p{L}\p{N}]/u.test(text.slice(range.start, range.end))
    ) {
      ranges.push(range);
    }
    start = after;
    index = after;
  }
  const trailing = trimWhitespace(text, start, text.length);
  if (
    trailing.start < trailing.end &&
    /[\p{L}\p{N}]/u.test(text.slice(trailing.start, trailing.end))
  ) {
    ranges.push(trailing);
  }
  return ranges;
}

function sliceAiProseSegment(
  paragraph: AiProseSegment,
  relativeStart: number,
  relativeEnd: number,
  id: string,
): AiProseSegment | undefined {
  if (
    !Number.isSafeInteger(relativeStart) ||
    !Number.isSafeInteger(relativeEnd) ||
    relativeStart < 0 ||
    relativeEnd > paragraph.text.length ||
    relativeStart >= relativeEnd
  ) {
    return undefined;
  }
  const text = paragraph.text.slice(relativeStart, relativeEnd);
  if (!/[\p{L}\p{N}]/u.test(text)) {
    return undefined;
  }
  const editableRanges = paragraph.editableRanges
    .map((range) => ({
      start: Math.max(range.start, relativeStart) - relativeStart,
      end: Math.min(range.end, relativeEnd) - relativeStart,
    }))
    .filter((range) => range.start < range.end);
  if (
    editableRanges.length === 0 ||
    !containsEditableAlphaNumeric(text, editableRanges)
  ) {
    return undefined;
  }
  return {
    id,
    text,
    sourceStart: paragraph.sourceStart + relativeStart,
    sourceEnd: paragraph.sourceStart + relativeEnd,
    editableRanges,
  };
}

function sentenceRange(text: string, cursorOffset: number): AiProseOffsetRange {
  const cursor = Math.max(0, Math.min(cursorOffset, text.length));
  const ranges = sentenceOffsetRanges(text);
  const containing = ranges.find((range) =>
    cursor >= range.start && cursor < range.end
  );
  if (containing !== undefined) {
    return containing;
  }
  const following = ranges.find((range) => cursor < range.start);
  return following ?? ranges.at(-1) ?? { start: 0, end: 0 };
}

/** Return the sentence around a source cursor, retaining stable source offsets. */
export function findAiProseSentenceAtOffset(
  document: AiProseDocument,
  sourceOffset: number,
): AiProseSelection | undefined {
  const paragraph = findAiProseParagraphAtOffset(document, sourceOffset);
  if (paragraph === undefined) {
    return undefined;
  }
  const cursor = Math.max(0, Math.min(
    sourceOffset - paragraph.sourceStart,
    paragraph.text.length,
  ));
  const range = sentenceRange(paragraph.text, cursor);
  if (range.start >= range.end || !/[\p{L}\p{N}]/u.test(paragraph.text.slice(range.start, range.end))) {
    return undefined;
  }
  return {
    segmentId: paragraph.segmentId,
    start: range.start,
    end: range.end,
    text: paragraph.text.slice(range.start, range.end),
    sourceStart: paragraph.sourceStart + range.start,
    sourceEnd: paragraph.sourceStart + range.end,
  };
}

function rangeIsEditable(
  ranges: readonly AiProseOffsetRange[],
  start: number,
  end: number,
): boolean {
  return start < end
    && ranges.some((range) => start >= range.start && end <= range.end);
}

function insertionBoundaryIsEditable(
  ranges: readonly AiProseOffsetRange[],
  offset: number,
  textLength: number,
): boolean {
  const leftEditable = offset > 0 && ranges.some((range) => offset - 1 >= range.start && offset - 1 < range.end);
  const rightEditable = offset < textLength && ranges.some((range) => offset >= range.start && offset < range.end);
  if (offset === 0) {
    return rightEditable;
  }
  if (offset === textLength) {
    return leftEditable;
  }
  return leftEditable && rightEditable;
}

function unsafeReplacement(replacement: string, maxLength: number): boolean {
  return replacement.length > maxLength
    || /[\r\n]/u.test(replacement)
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/u.test(replacement)
    || /[\u202a-\u202e\u2066-\u2069]/u.test(replacement)
    || /[\\{}$%#&_~^]/u.test(replacement);
}

function issueShape(issue: AiProseIssue): boolean {
  return typeof issue === 'object'
    && issue !== null
    && typeof issue.start === 'number'
    && typeof issue.end === 'number'
    && typeof issue.original === 'string'
    && typeof issue.replacement === 'string';
}

/**
 * Return whether two issue edits cannot be applied safely in one transaction.
 * Insertions touch both boundaries of a non-empty replacement; two insertions
 * at the same offset also conflict. Non-empty half-open ranges may be adjacent.
 */
export function aiIssueRangesOverlap(
  first: AiProseOffsetRange,
  second: AiProseOffsetRange,
): boolean {
  if (first.start === first.end && second.start === second.end) {
    return first.start === second.start;
  }
  if (first.start === first.end) {
    return first.start >= second.start && first.start <= second.end;
  }
  if (second.start === second.end) {
    return second.start >= first.start && second.start <= first.end;
  }
  return first.start < second.end && second.start < first.end;
}

function plannedEdit(
  issue: AiProseIssue,
  issueIndex: number,
  segment: AiProseSegment,
): PlannedAiProseEdit {
  const common = {
    issueIndex,
    segmentId: segment.id,
    start: issue.start,
    end: issue.end,
    original: issue.original,
    replacement: issue.replacement,
    sourceStart: segment.sourceStart + issue.start,
    sourceEnd: segment.sourceStart + issue.end,
  };
  return {
    ...common,
    ...(issue.message === undefined ? {} : { message: issue.message }),
    ...(issue.explanation === undefined ? {} : { explanation: issue.explanation }),
    ...(issue.category === undefined ? {} : { category: issue.category }),
    ...(issue.severity === undefined ? {} : { severity: issue.severity }),
  };
}

/**
 * Validate model edits against an extracted segment and map them to source.
 * No caller should construct a WorkspaceEdit directly from model JSON.
 */
export function planAiProseIssues(
  source: string,
  segment: AiProseSegment,
  issues: readonly AiProseIssue[],
  options: AiProseIssuePlanOptions = {},
): AiProseIssuePlan {
  const rejected: RejectedAiProseIssue[] = [];
  const candidates: PlannedAiProseEdit[] = [];
  const maxReplacementLength = Number.isInteger(options.maxReplacementLength)
    && (options.maxReplacementLength ?? 0) >= 0
    ? options.maxReplacementLength ?? DEFAULT_MAX_REPLACEMENT_LENGTH
    : DEFAULT_MAX_REPLACEMENT_LENGTH;

  const validSegment = Number.isInteger(segment.sourceStart)
    && Number.isInteger(segment.sourceEnd)
    && segment.sourceStart >= 0
    && segment.sourceEnd >= segment.sourceStart
    && segment.sourceEnd <= source.length
    && segment.text.length === segment.sourceEnd - segment.sourceStart;
  if (!validSegment) {
    return {
      edits: [],
      rejected: issues.map((_issue, issueIndex) => ({ issueIndex, reason: 'invalid-segment' })),
    };
  }

  for (let issueIndex = 0; issueIndex < issues.length; issueIndex += 1) {
    const issue = issues[issueIndex];
    if (issue === undefined || !issueShape(issue)) {
      rejected.push({ issueIndex, reason: 'invalid-shape' });
      continue;
    }
    if (!Number.isInteger(issue.start) || !Number.isInteger(issue.end) || issue.start > issue.end) {
      rejected.push({ issueIndex, reason: 'invalid-offsets' });
      continue;
    }
    if (issue.start < 0 || issue.end > segment.text.length) {
      rejected.push({ issueIndex, reason: 'out-of-bounds' });
      continue;
    }
    if (segment.text.slice(issue.start, issue.end) !== issue.original) {
      rejected.push({ issueIndex, reason: 'original-mismatch' });
      continue;
    }
    const editable = issue.start === issue.end
      ? insertionBoundaryIsEditable(segment.editableRanges, issue.start, segment.text.length)
      : rangeIsEditable(segment.editableRanges, issue.start, issue.end);
    if (!editable) {
      rejected.push({ issueIndex, reason: 'protected-source' });
      continue;
    }
    const sourceStart = segment.sourceStart + issue.start;
    const sourceEnd = segment.sourceStart + issue.end;
    const sourceText = source.slice(sourceStart, sourceEnd);
    if (sourceText !== issue.original) {
      rejected.push({ issueIndex, reason: 'original-mismatch' });
      continue;
    }
    if (/[\r\n]/u.test(sourceText)) {
      rejected.push({ issueIndex, reason: 'multiline-source' });
      continue;
    }
    if (unsafeReplacement(issue.replacement, maxReplacementLength)) {
      rejected.push({ issueIndex, reason: 'unsafe-replacement' });
      continue;
    }
    if (issue.original === issue.replacement) {
      rejected.push({ issueIndex, reason: 'unchanged' });
      continue;
    }
    if (aiIssueReplacementAlreadyPresent(
      source,
      sourceStart,
      sourceEnd,
      issue.original,
      issue.replacement,
    )) {
      rejected.push({ issueIndex, reason: 'replacement-already-present' });
      continue;
    }
    candidates.push(plannedEdit(issue, issueIndex, segment));
  }

  candidates.sort((left, right) => (
    left.start - right.start || left.end - right.end || left.issueIndex - right.issueIndex
  ));
  const edits: PlannedAiProseEdit[] = [];
  for (const candidate of candidates) {
    if (edits.some((accepted) => aiIssueRangesOverlap(accepted, candidate))) {
      rejected.push({ issueIndex: candidate.issueIndex, reason: 'overlap' });
    } else {
      edits.push(candidate);
    }
  }
  rejected.sort((left, right) => left.issueIndex - right.issueIndex);
  return { edits, rejected };
}

/**
 * Detect a model range which selects only part of text that is already equal
 * to its proposed replacement.
 *
 * For example, a model can select `one take` from the existing `one takes`
 * and propose `one takes`. The selected slice is exact, so ordinary offset
 * validation succeeds, but applying it would create `one takess`. Treat the
 * replacement as already present whenever an occurrence of `original` inside
 * `replacement` can be aligned with the selected source range and the entire
 * replacement already exists at that aligned position.
 */
export function aiIssueReplacementAlreadyPresent(
  source: string,
  sourceStart: number,
  sourceEnd: number,
  original: string,
  replacement: string,
): boolean {
  if (
    !Number.isSafeInteger(sourceStart) ||
    !Number.isSafeInteger(sourceEnd) ||
    sourceStart < 0 ||
    sourceEnd < sourceStart ||
    sourceEnd > source.length ||
    original.length === 0 ||
    replacement.length === 0 ||
    original === replacement ||
    sourceEnd - sourceStart !== original.length ||
    source.slice(sourceStart, sourceEnd) !== original
  ) {
    return false;
  }

  let occurrence = replacement.indexOf(original);
  while (occurrence >= 0) {
    const candidateStart = sourceStart - occurrence;
    const candidateEnd = candidateStart + replacement.length;
    if (
      candidateStart >= 0 &&
      candidateEnd <= source.length &&
      source.slice(candidateStart, candidateEnd) === replacement
    ) {
      return true;
    }
    occurrence = replacement.indexOf(original, occurrence + 1);
  }
  return false;
}
