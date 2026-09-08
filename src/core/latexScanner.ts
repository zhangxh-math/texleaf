/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import {
  LatexContext,
  LatexDelimiterFrame,
  LatexEnvironmentFrame,
  LatexMathRegion,
  LatexMathMode,
  LatexPendingSnippetSuppression,
  LatexPendingTextArgument,
  LatexScanState,
  LatexSnippetSuppressionCommand,
  LatexSnippetSuppressionFrame,
  LatexTextArgumentCommand,
  LatexTextArgumentFrame,
  OffsetRange,
} from './types';

const BLOCK_MATH_ENVIRONMENTS = new Set([
  'displaymath',
  'equation',
  'eqnarray',
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

const INLINE_MATH_ENVIRONMENTS = new Set(['math']);

const MATRIX_ENVIRONMENTS = new Set([
  'matrix',
  'pmatrix',
  'bmatrix',
  'Bmatrix',
  'vmatrix',
  'Vmatrix',
  'smallmatrix',
  'array',
  'align',
  'alignat',
  'aligned',
  'alignedat',
  'cases',
]);

const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim',
  'verbatim*',
  'Verbatim',
  'Verbatim*',
  'lstlisting',
  'minted',
  'comment',
  'filecontents',
  'filecontents*',
]);

/**
 * Match the physical closing syntax of an opaque LaTeX environment.
 *
 * Opaque bodies do not recursively parse nested `\\begin` text. The base
 * verbatim/filecontents implementations and the common verbatim packages use
 * the first exact `\\end{name}` marker. The comment package is stricter: its
 * marker must occupy a physical line by itself, with no leading or trailing
 * characters. Keeping that distinction here prevents literal body text from
 * becoming source-authoritative formulas, labels, or project includes.
 */
export function isLatexOpaqueEnvironmentEndAt(
  text: string,
  offset: number,
  environment: string,
): boolean {
  const marker = `\\end{${environment}}`;
  if (!text.startsWith(marker, offset)) {
    return false;
  }
  if (environment !== 'comment') {
    return true;
  }
  const before = offset === 0 ? undefined : text[offset - 1];
  const afterOffset = offset + marker.length;
  const after = afterOffset >= text.length ? undefined : text[afterOffset];
  return (before === undefined || before === '\n' || before === '\r') &&
    (after === undefined || after === '\n' || after === '\r');
}

export function findLatexOpaqueEnvironmentEnd(
  text: string,
  from: number,
  limit: number,
  environment: string,
): number | undefined {
  const marker = `\\end{${environment}}`;
  let candidate = text.indexOf(marker, Math.max(0, from));
  while (candidate >= 0 && candidate < limit) {
    const end = candidate + marker.length;
    if (end <= limit && isLatexOpaqueEnvironmentEndAt(text, candidate, environment)) {
      return end;
    }
    candidate = text.indexOf(marker, candidate + 1);
  }
  return undefined;
}

// These commands are known to parse their mandatory argument in text mode.
// Keep this as an exact allowlist: custom commands and math alphabet commands
// can have unrelated argument semantics and must retain the ambient mode.
const TEXT_ARGUMENT_COMMANDS = new Set<LatexTextArgumentCommand>([
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

interface MutableLatexScanState {
  environments: LatexEnvironmentFrame[];
  delimiter: LatexDelimiterFrame | undefined;
  inComment: boolean;
  verbatimDelimiter: string | undefined;
  verbatimEnvironment: string | undefined;
  pendingSnippetSuppression: LatexPendingSnippetSuppression | undefined;
  snippetSuppression: LatexSnippetSuppressionFrame | undefined;
  pendingTextArgument: LatexPendingTextArgument | undefined;
  textArguments: LatexTextArgumentFrame[];
}

export function createLatexScanState(): LatexScanState {
  return {
    environments: [],
    delimiter: undefined,
    inComment: false,
    verbatimDelimiter: undefined,
    verbatimEnvironment: undefined,
    pendingSnippetSuppression: undefined,
    snippetSuppression: undefined,
    pendingTextArgument: undefined,
    textArguments: [],
  };
}

function mutableCopy(state: LatexScanState | undefined): MutableLatexScanState {
  const source = state ?? createLatexScanState();
  return {
    environments: source.environments.map((frame) => ({ ...frame })),
    delimiter: source.delimiter === undefined ? undefined : { ...source.delimiter },
    inComment: source.inComment,
    verbatimDelimiter: source.verbatimDelimiter,
    verbatimEnvironment: source.verbatimEnvironment,
    pendingSnippetSuppression:
      source.pendingSnippetSuppression === undefined
        ? undefined
        : { ...source.pendingSnippetSuppression },
    snippetSuppression:
      source.snippetSuppression === undefined
        ? undefined
        : { ...source.snippetSuppression },
    pendingTextArgument:
      source.pendingTextArgument === undefined
        ? undefined
        : { ...source.pendingTextArgument },
    textArguments: source.textArguments.map((frame) => ({
      ...frame,
      delimiter: frame.delimiter === undefined ? undefined : { ...frame.delimiter },
    })),
  };
}

function freezeState(state: MutableLatexScanState): LatexScanState {
  return {
    environments: state.environments.map((frame) => ({ ...frame })),
    delimiter: state.delimiter === undefined ? undefined : { ...state.delimiter },
    inComment: state.inComment,
    verbatimDelimiter: state.verbatimDelimiter,
    verbatimEnvironment: state.verbatimEnvironment,
    pendingSnippetSuppression:
      state.pendingSnippetSuppression === undefined
        ? undefined
        : { ...state.pendingSnippetSuppression },
    snippetSuppression:
      state.snippetSuppression === undefined
        ? undefined
        : { ...state.snippetSuppression },
    pendingTextArgument:
      state.pendingTextArgument === undefined
        ? undefined
        : { ...state.pendingTextArgument },
    textArguments: state.textArguments.map((frame) => ({
      ...frame,
      delimiter: frame.delimiter === undefined ? undefined : { ...frame.delimiter },
    })),
  };
}

function snippetSuppressionCommand(command: string): LatexSnippetSuppressionCommand | undefined {
  return command === 'label' || command === 'tag' ? command : undefined;
}

function textArgumentCommand(command: string): LatexTextArgumentCommand | undefined {
  return TEXT_ARGUMENT_COMMANDS.has(command as LatexTextArgumentCommand)
    ? (command as LatexTextArgumentCommand)
    : undefined;
}

function normalizeEnvironmentName(name: string): string {
  return name.endsWith('*') ? name.slice(0, -1) : name;
}

function environmentIs(name: string, set: ReadonlySet<string>): boolean {
  return set.has(name) || set.has(normalizeEnvironmentName(name));
}

function delimiterMathMode(delimiter: LatexDelimiterFrame | undefined): LatexMathMode | undefined {
  if (delimiter?.kind === 'dollar-inline' || delimiter?.kind === 'paren') {
    return 'inline';
  }
  return delimiter === undefined ? undefined : 'block';
}

function activeTextArgument(
  state: Pick<LatexScanState, 'textArguments'>,
): LatexTextArgumentFrame | undefined {
  return state.textArguments[state.textArguments.length - 1];
}

function mathModeFromState(
  state: Pick<LatexScanState, 'delimiter' | 'environments' | 'textArguments'>,
): LatexMathMode {
  const textArgument = activeTextArgument(state);
  if (textArgument !== undefined) {
    return delimiterMathMode(textArgument.delimiter) ?? 'text';
  }

  const delimiterMode = delimiterMathMode(state.delimiter);
  if (delimiterMode !== undefined) {
    return delimiterMode;
  }
  if (state.environments.some((frame) => environmentIs(frame.name, BLOCK_MATH_ENVIRONMENTS))) {
    return 'block';
  }
  if (state.environments.some((frame) => environmentIs(frame.name, INLINE_MATH_ENVIRONMENTS))) {
    return 'inline';
  }
  return 'text';
}

function readCommand(text: string, slashOffset: number): { command: string; end: number } {
  const first = text[slashOffset + 1];
  if (first === undefined) {
    return { command: '', end: slashOffset + 1 };
  }
  if (!/[A-Za-z@]/.test(first)) {
    return { command: first, end: slashOffset + 2 };
  }
  let end = slashOffset + 2;
  while (end < text.length && /[A-Za-z@]/.test(text[end]!)) {
    end += 1;
  }
  return { command: text.slice(slashOffset + 1, end), end };
}

function readBracedValue(text: string, from: number): { value: string; end: number } | undefined {
  let open = from;
  while (open < text.length && /[ \t]/.test(text[open]!)) {
    open += 1;
  }
  if (text[open] !== '{') {
    return undefined;
  }
  const close = text.indexOf('}', open + 1);
  if (close < 0) {
    return undefined;
  }
  return { value: text.slice(open + 1, close).trim(), end: close + 1 };
}

function closeEnvironment(state: MutableLatexScanState, name: string): void {
  for (let index = state.environments.length - 1; index >= 0; index -= 1) {
    const frame = state.environments[index];
    if (frame?.name === name) {
      state.environments.splice(index, state.environments.length - index);
      return;
    }
  }
}

function openDelimiter(
  state: MutableLatexScanState,
  kind: LatexDelimiterFrame['kind'],
  startOffset: number,
): void {
  const frameIndex = state.textArguments.length - 1;
  const frame = state.textArguments[frameIndex];
  if (frame !== undefined) {
    if (frame.delimiter === undefined) {
      state.textArguments[frameIndex] = {
        ...frame,
        delimiter: { kind, startOffset },
      };
    }
    return;
  }
  if (state.delimiter === undefined) {
    state.delimiter = { kind, startOffset };
  }
}

function closeDelimiter(state: MutableLatexScanState, kind: LatexDelimiterFrame['kind']): void {
  const frameIndex = state.textArguments.length - 1;
  const frame = state.textArguments[frameIndex];
  if (frame !== undefined) {
    if (frame.delimiter?.kind === kind) {
      state.textArguments[frameIndex] = { ...frame, delimiter: undefined };
    }
    return;
  }
  if (state.delimiter?.kind === kind) {
    state.delimiter = undefined;
  }
}

function currentDelimiter(state: MutableLatexScanState): LatexDelimiterFrame | undefined {
  return activeTextArgument(state)?.delimiter ??
    (state.textArguments.length === 0 ? state.delimiter : undefined);
}

/**
 * Scan one segment while carrying state from a previous segment. This is the
 * primitive adapters can use for incremental, line-oriented caching.
 */
export function scanLatexSegment(
  text: string,
  initialState: LatexScanState = createLatexScanState(),
  baseOffset = 0,
): LatexScanState {
  const state = mutableCopy(initialState);
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (state.verbatimEnvironment !== undefined) {
      const endToken = `\\end{${state.verbatimEnvironment}}`;
      if (isLatexOpaqueEnvironmentEndAt(text, index, state.verbatimEnvironment)) {
        closeEnvironment(state, state.verbatimEnvironment);
        state.verbatimEnvironment = undefined;
        index += endToken.length;
      } else {
        index += 1;
      }
      continue;
    }

    if (state.verbatimDelimiter !== undefined) {
      if (char === state.verbatimDelimiter || char === '\n' || char === '\r') {
        state.verbatimDelimiter = undefined;
      }
      index += 1;
      continue;
    }

    if (state.inComment) {
      if (char === '\n' || char === '\r') {
        state.inComment = false;
      }
      index += 1;
      continue;
    }

    // `\\label{...}` and `\\tag{...}` contain identifiers/presentation text,
    // not equation input. Keep their mandatory arguments opaque to the math
    // scanner while still counting nested, unescaped braces. In particular,
    // commands and dollar signs in a label must not corrupt the surrounding
    // equation's delimiter/environment state.
    if (state.snippetSuppression !== undefined) {
      if (char === '%') {
        state.inComment = true;
        index += 1;
        continue;
      }
      if (char === '\\') {
        const { end } = readCommand(text, index);
        index = Math.max(index + 1, end);
        continue;
      }
      if (char === '{') {
        state.snippetSuppression = {
          ...state.snippetSuppression,
          braceDepth: state.snippetSuppression.braceDepth + 1,
        };
        index += 1;
        continue;
      }
      if (char === '}') {
        const braceDepth = state.snippetSuppression.braceDepth - 1;
        state.snippetSuppression =
          braceDepth === 0
            ? undefined
            : { ...state.snippetSuppression, braceDepth };
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    // Whitespace and comments may separate a command from its mandatory
    // argument. `\\tag` additionally accepts one optional star. Any other
    // token means the command did not begin the protected braced argument.
    if (state.pendingSnippetSuppression !== undefined) {
      if (/\s/.test(char!)) {
        index += 1;
        continue;
      }
      if (char === '%') {
        state.inComment = true;
        index += 1;
        continue;
      }
      if (
        char === '*' &&
        state.pendingSnippetSuppression.command === 'tag' &&
        !state.pendingSnippetSuppression.starConsumed
      ) {
        state.pendingSnippetSuppression = {
          command: 'tag',
          starConsumed: true,
        };
        index += 1;
        continue;
      }
      if (char === '{') {
        state.snippetSuppression = {
          command: state.pendingSnippetSuppression.command,
          braceDepth: 1,
        };
        state.pendingSnippetSuppression = undefined;
        index += 1;
        continue;
      }
      state.pendingSnippetSuppression = undefined;
    }

    // A closed set of text-producing commands locally leaves ambient math
    // mode for its mandatory argument. Whitespace and comments may separate
    // the command from `{`; any other token cancels the pending argument.
    if (state.pendingTextArgument !== undefined) {
      if (/\s/.test(char!)) {
        index += 1;
        continue;
      }
      if (char === '%') {
        state.inComment = true;
        index += 1;
        continue;
      }
      if (char === '{') {
        state.textArguments.push({
          command: state.pendingTextArgument.command,
          braceDepth: 1,
          delimiter: undefined,
        });
        state.pendingTextArgument = undefined;
        index += 1;
        continue;
      }
      state.pendingTextArgument = undefined;
    }

    if (char === '%') {
      state.inComment = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const { command, end } = readCommand(text, index);
      const absoluteOffset = baseOffset + index;

      const suppressedCommand = snippetSuppressionCommand(command);
      if (suppressedCommand !== undefined) {
        state.pendingSnippetSuppression = {
          command: suppressedCommand,
          starConsumed: false,
        };
        index = end;
        continue;
      }

      const textCommand = textArgumentCommand(command);
      if (textCommand !== undefined && mathModeFromState(state) !== 'text') {
        state.pendingTextArgument = { command: textCommand };
        index = end;
        continue;
      }

      if (command === '(') {
        openDelimiter(state, 'paren', absoluteOffset);
        index = end;
        continue;
      }
      if (command === ')') {
        closeDelimiter(state, 'paren');
        index = end;
        continue;
      }
      if (command === '[') {
        openDelimiter(state, 'bracket', absoluteOffset);
        index = end;
        continue;
      }
      if (command === ']') {
        closeDelimiter(state, 'bracket');
        index = end;
        continue;
      }

      if (command === 'verb') {
        let delimiterOffset = end;
        if (text[delimiterOffset] === '*') {
          delimiterOffset += 1;
        }
        const delimiter = text[delimiterOffset];
        if (delimiter !== undefined && delimiter !== '\n' && delimiter !== '\r') {
          state.verbatimDelimiter = delimiter;
          index = delimiterOffset + 1;
        } else {
          index = end;
        }
        continue;
      }

      if (command === 'begin' || command === 'end') {
        const braced = readBracedValue(text, end);
        if (braced !== undefined && braced.value.length > 0) {
          if (command === 'begin') {
            state.environments.push({ name: braced.value, startOffset: absoluteOffset });
            if (environmentIs(braced.value, VERBATIM_ENVIRONMENTS)) {
              state.verbatimEnvironment = braced.value;
            }
          } else {
            closeEnvironment(state, braced.value);
          }
          index = braced.end;
          continue;
        }
      }

      // Non-letter commands such as \$, \%, and \\ consume the escaped
      // character here, so it cannot be mistaken for syntax on the next loop.
      index = Math.max(index + 1, end);
      continue;
    }

    const textArgumentIndex = state.textArguments.length - 1;
    const textArgument = state.textArguments[textArgumentIndex];
    if (textArgument !== undefined && char === '{') {
      state.textArguments[textArgumentIndex] = {
        ...textArgument,
        braceDepth: textArgument.braceDepth + 1,
      };
      index += 1;
      continue;
    }
    if (textArgument !== undefined && char === '}') {
      if (textArgument.braceDepth === 1) {
        state.textArguments.pop();
      } else {
        state.textArguments[textArgumentIndex] = {
          ...textArgument,
          braceDepth: textArgument.braceDepth - 1,
        };
      }
      index += 1;
      continue;
    }

    if (char === '$') {
      const isDouble = text[index + 1] === '$';
      const absoluteOffset = baseOffset + index;
      const delimiter = currentDelimiter(state);
      if (isDouble) {
        if (delimiter?.kind === 'dollar-block') {
          closeDelimiter(state, 'dollar-block');
        } else if (delimiter === undefined) {
          openDelimiter(state, 'dollar-block', absoluteOffset);
        }
        index += 2;
      } else {
        if (delimiter?.kind === 'dollar-inline') {
          closeDelimiter(state, 'dollar-inline');
        } else if (delimiter === undefined) {
          openDelimiter(state, 'dollar-inline', absoluteOffset);
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  return freezeState(state);
}

export function latexContextFromState(state: LatexScanState): LatexContext {
  const mathMode = mathModeFromState(state);

  let matrixEnvironment: string | undefined;
  if (mathMode !== 'text' && state.textArguments.length === 0) {
    for (let index = state.environments.length - 1; index >= 0; index -= 1) {
      const frame = state.environments[index];
      if (frame !== undefined && environmentIs(frame.name, MATRIX_ENVIRONMENTS)) {
        matrixEnvironment = frame.name;
        break;
      }
    }
  }

  return {
    mathMode,
    inComment: state.inComment,
    inVerbatim: state.verbatimDelimiter !== undefined || state.verbatimEnvironment !== undefined,
    inTextCommandArgument: state.textArguments.length > 0,
    inSnippetSuppressedArgument: state.snippetSuppression !== undefined,
    snippetSuppressionCommand: state.snippetSuppression?.command,
    environments: state.environments.map((frame) => frame.name),
    matrixEnvironment,
  };
}

/** Scan text from the beginning and return context at a UTF-16 offset. */
export function scanLatexContext(text: string, offset = text.length): LatexContext {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  return latexContextFromState(scanLatexSegment(text.slice(0, boundedOffset)));
}

export function isMathEnvironment(name: string): boolean {
  return environmentIs(name, BLOCK_MATH_ENVIRONMENTS) || environmentIs(name, INLINE_MATH_ENVIRONMENTS);
}

export function isMatrixEnvironment(name: string): boolean {
  return environmentIs(name, MATRIX_ENVIRONMENTS);
}

interface RegionEnvironmentFrame {
  readonly name: string;
  readonly outerStart: number;
  readonly innerStart: number;
  readonly mode: 'inline' | 'block' | undefined;
}

interface RegionDelimiterFrame {
  readonly kind: LatexDelimiterFrame['kind'];
  readonly outerStart: number;
  readonly innerStart: number;
  readonly mode: 'inline' | 'block';
}

function mathEnvironmentMode(name: string): 'inline' | 'block' | undefined {
  if (environmentIs(name, BLOCK_MATH_ENVIRONMENTS)) {
    return 'block';
  }
  if (environmentIs(name, INLINE_MATH_ENVIRONMENTS)) {
    return 'inline';
  }
  return undefined;
}

/**
 * Find every LaTeX math region in one O(n) pass. The result contains closed
 * regions as well as regions whose opening syntax remains open at EOF. This is
 * intended for adapters that need to decorate all math spans without rescanning
 * the document once per bracket.
 */
export interface LatexEnvironmentAlias {
  readonly command: "begin" | "end";
  readonly name: string;
}

export function scanLatexRegions(
  text: string,
  environmentAliases?: ReadonlyMap<number, LatexEnvironmentAlias>,
  ignoredRanges: readonly OffsetRange[] = [],
): readonly LatexMathRegion[] {
  const regions: LatexMathRegion[] = [];
  const environments: RegionEnvironmentFrame[] = [];
  let delimiter: RegionDelimiterFrame | undefined;
  let pendingSnippetSuppression: LatexPendingSnippetSuppression | undefined;
  let snippetSuppression: LatexSnippetSuppressionFrame | undefined;
  let pendingTextArgument: LatexPendingTextArgument | undefined;
  const textArguments: LatexTextArgumentFrame[] = [];
  let inComment = false;
  let verbatimDelimiter: string | undefined;
  let verbatimEnvironment: string | undefined;
  let index = 0;
  let ignoredIndex = 0;

  const closeDelimiterRegion = (closeStart: number, closeEnd: number): void => {
    if (delimiter === undefined) {
      return;
    }
    regions.push({
      outerStart: delimiter.outerStart,
      innerStart: delimiter.innerStart,
      innerEnd: closeStart,
      outerEnd: closeEnd,
      mode: delimiter.mode,
      closed: true,
    });
    delimiter = undefined;
  };

  const effectiveRegionMathMode = (): LatexMathMode => {
    const textArgument = textArguments[textArguments.length - 1];
    if (textArgument !== undefined) {
      return delimiterMathMode(textArgument.delimiter) ?? 'text';
    }
    if (delimiter !== undefined) {
      return delimiter.mode;
    }
    for (let frameIndex = environments.length - 1; frameIndex >= 0; frameIndex -= 1) {
      const mode = environments[frameIndex]?.mode;
      if (mode !== undefined) {
        return mode;
      }
    }
    return 'text';
  };

  const openLocalDelimiter = (
    kind: LatexDelimiterFrame['kind'],
    startOffset: number,
  ): boolean => {
    const frameIndex = textArguments.length - 1;
    const frame = textArguments[frameIndex];
    if (frame === undefined) {
      return false;
    }
    if (frame.delimiter === undefined) {
      textArguments[frameIndex] = {
        ...frame,
        delimiter: { kind, startOffset },
      };
    }
    return true;
  };

  const closeLocalDelimiter = (kind: LatexDelimiterFrame['kind']): boolean => {
    const frameIndex = textArguments.length - 1;
    const frame = textArguments[frameIndex];
    if (frame === undefined) {
      return false;
    }
    if (frame.delimiter?.kind === kind) {
      textArguments[frameIndex] = { ...frame, delimiter: undefined };
    }
    return true;
  };

  while (index < text.length) {
    const ignored = ignoredRanges[ignoredIndex];
    if (ignored !== undefined && ignored.start <= index) {
      index = Math.max(index, ignored.end);
      ignoredIndex += 1;
      continue;
    }
    const char = text[index];

    if (verbatimEnvironment !== undefined) {
      const endToken = `\\end{${verbatimEnvironment}}`;
      if (isLatexOpaqueEnvironmentEndAt(text, index, verbatimEnvironment)) {
        for (let frameIndex = environments.length - 1; frameIndex >= 0; frameIndex -= 1) {
          if (environments[frameIndex]?.name === verbatimEnvironment) {
            environments.splice(frameIndex, 1);
            break;
          }
        }
        verbatimEnvironment = undefined;
        index += endToken.length;
      } else {
        index += 1;
      }
      continue;
    }

    if (verbatimDelimiter !== undefined) {
      if (char === verbatimDelimiter || char === '\n' || char === '\r') {
        verbatimDelimiter = undefined;
      }
      index += 1;
      continue;
    }

    if (inComment) {
      if (char === '\n' || char === '\r') {
        inComment = false;
      }
      index += 1;
      continue;
    }

    if (snippetSuppression !== undefined) {
      if (char === '%') {
        inComment = true;
        index += 1;
        continue;
      }
      if (char === '\\') {
        const { end } = readCommand(text, index);
        index = Math.max(index + 1, end);
        continue;
      }
      if (char === '{') {
        snippetSuppression = {
          ...snippetSuppression,
          braceDepth: snippetSuppression.braceDepth + 1,
        };
        index += 1;
        continue;
      }
      if (char === '}') {
        const braceDepth = snippetSuppression.braceDepth - 1;
        snippetSuppression = braceDepth === 0
          ? undefined
          : { ...snippetSuppression, braceDepth };
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }

    if (pendingSnippetSuppression !== undefined) {
      if (/\s/.test(char!)) {
        index += 1;
        continue;
      }
      if (char === '%') {
        inComment = true;
        index += 1;
        continue;
      }
      if (
        char === '*' &&
        pendingSnippetSuppression.command === 'tag' &&
        !pendingSnippetSuppression.starConsumed
      ) {
        pendingSnippetSuppression = { command: 'tag', starConsumed: true };
        index += 1;
        continue;
      }
      if (char === '{') {
        snippetSuppression = {
          command: pendingSnippetSuppression.command,
          braceDepth: 1,
        };
        pendingSnippetSuppression = undefined;
        index += 1;
        continue;
      }
      pendingSnippetSuppression = undefined;
    }

    if (pendingTextArgument !== undefined) {
      if (/\s/.test(char!)) {
        index += 1;
        continue;
      }
      if (char === '%') {
        inComment = true;
        index += 1;
        continue;
      }
      if (char === '{') {
        textArguments.push({
          command: pendingTextArgument.command,
          braceDepth: 1,
          delimiter: undefined,
        });
        pendingTextArgument = undefined;
        index += 1;
        continue;
      }
      pendingTextArgument = undefined;
    }

    if (char === '%') {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === '\\') {
      const token = readCommand(text, index);
      const alias = environmentAliases?.get(index);
      const command = alias?.command ?? token.command;
      const end = token.end;

      const suppressedCommand = snippetSuppressionCommand(command);
      if (suppressedCommand !== undefined) {
        pendingSnippetSuppression = {
          command: suppressedCommand,
          starConsumed: false,
        };
        index = end;
        continue;
      }

      const textCommand = textArgumentCommand(command);
      if (textCommand !== undefined && effectiveRegionMathMode() !== 'text') {
        pendingTextArgument = { command: textCommand };
        index = end;
        continue;
      }

      if (command === '(') {
        if (openLocalDelimiter('paren', index)) {
          index = end;
          continue;
        }
        if (delimiter === undefined) {
          delimiter = {
            kind: 'paren',
            outerStart: index,
            innerStart: end,
            mode: 'inline',
          };
        }
        index = end;
        continue;
      }
      if (command === ')') {
        if (closeLocalDelimiter('paren')) {
          index = end;
          continue;
        }
        if (delimiter?.kind === 'paren') {
          closeDelimiterRegion(index, end);
        }
        index = end;
        continue;
      }
      if (command === '[') {
        if (openLocalDelimiter('bracket', index)) {
          index = end;
          continue;
        }
        if (delimiter === undefined) {
          delimiter = {
            kind: 'bracket',
            outerStart: index,
            innerStart: end,
            mode: 'block',
          };
        }
        index = end;
        continue;
      }
      if (command === ']') {
        if (closeLocalDelimiter('bracket')) {
          index = end;
          continue;
        }
        if (delimiter?.kind === 'bracket') {
          closeDelimiterRegion(index, end);
        }
        index = end;
        continue;
      }

      if (command === 'verb') {
        let delimiterOffset = end;
        if (text[delimiterOffset] === '*') {
          delimiterOffset += 1;
        }
        const verbDelimiter = text[delimiterOffset];
        if (verbDelimiter !== undefined && verbDelimiter !== '\n' && verbDelimiter !== '\r') {
          verbatimDelimiter = verbDelimiter;
          index = delimiterOffset + 1;
        } else {
          index = end;
        }
        continue;
      }

      if (command === 'begin' || command === 'end') {
        const braced = alias === undefined
          ? readBracedValue(text, end)
          : { value: alias.name, end };
        if (braced !== undefined && braced.value.length > 0) {
          if (command === 'begin') {
            const frame: RegionEnvironmentFrame = {
              name: braced.value,
              outerStart: index,
              innerStart: braced.end,
              mode: mathEnvironmentMode(braced.value),
            };
            environments.push(frame);
            if (environmentIs(braced.value, VERBATIM_ENVIRONMENTS)) {
              verbatimEnvironment = braced.value;
            }
          } else {
            for (let frameIndex = environments.length - 1; frameIndex >= 0; frameIndex -= 1) {
              const frame = environments[frameIndex];
              if (frame === undefined || frame.name !== braced.value) {
                continue;
              }
              environments.splice(frameIndex, 1);
              if (frame.mode !== undefined) {
                regions.push({
                  outerStart: frame.outerStart,
                  innerStart: frame.innerStart,
                  innerEnd: index,
                  outerEnd: braced.end,
                  mode: frame.mode,
                  environmentName: frame.name,
                  closed: true,
                });
              }
              break;
            }
          }
          index = braced.end;
          continue;
        }
      }

      // Escaped punctuation is consumed with the command so it cannot open a
      // dollar/comment region on the next iteration.
      index = Math.max(index + 1, end);
      continue;
    }

    const textArgumentIndex = textArguments.length - 1;
    const textArgument = textArguments[textArgumentIndex];
    if (textArgument !== undefined && char === '{') {
      textArguments[textArgumentIndex] = {
        ...textArgument,
        braceDepth: textArgument.braceDepth + 1,
      };
      index += 1;
      continue;
    }
    if (textArgument !== undefined && char === '}') {
      if (textArgument.braceDepth === 1) {
        textArguments.pop();
      } else {
        textArguments[textArgumentIndex] = {
          ...textArgument,
          braceDepth: textArgument.braceDepth - 1,
        };
      }
      index += 1;
      continue;
    }

    if (char === '$') {
      const isDouble = text[index + 1] === '$';
      const localDelimiter = textArguments[textArguments.length - 1]?.delimiter;
      if (textArguments.length > 0) {
        if (isDouble) {
          if (localDelimiter?.kind === 'dollar-block') {
            closeLocalDelimiter('dollar-block');
          } else if (localDelimiter === undefined) {
            openLocalDelimiter('dollar-block', index);
          }
          index += 2;
        } else {
          if (localDelimiter?.kind === 'dollar-inline') {
            closeLocalDelimiter('dollar-inline');
          } else if (localDelimiter === undefined) {
            openLocalDelimiter('dollar-inline', index);
          }
          index += 1;
        }
        continue;
      }
      if (isDouble) {
        if (delimiter?.kind === 'dollar-block') {
          closeDelimiterRegion(index, index + 2);
        } else if (delimiter === undefined) {
          delimiter = {
            kind: 'dollar-block',
            outerStart: index,
            innerStart: index + 2,
            mode: 'block',
          };
        }
        index += 2;
      } else {
        if (delimiter?.kind === 'dollar-inline') {
          closeDelimiterRegion(index, index + 1);
        } else if (delimiter === undefined) {
          delimiter = {
            kind: 'dollar-inline',
            outerStart: index,
            innerStart: index + 1,
            mode: 'inline',
          };
        }
        index += 1;
      }
      continue;
    }

    index += 1;
  }

  if (delimiter !== undefined) {
    regions.push({
      outerStart: delimiter.outerStart,
      innerStart: delimiter.innerStart,
      innerEnd: text.length,
      outerEnd: text.length,
      mode: delimiter.mode,
      closed: false,
    });
  }

  for (const frame of environments) {
    if (frame.mode === undefined) {
      continue;
    }
    regions.push({
      outerStart: frame.outerStart,
      innerStart: frame.innerStart,
      innerEnd: text.length,
      outerEnd: text.length,
      mode: frame.mode,
      environmentName: frame.name,
      closed: false,
    });
  }

  regions.sort((left, right) =>
    left.outerStart - right.outerStart || right.outerEnd - left.outerEnd,
  );
  return regions;
}
