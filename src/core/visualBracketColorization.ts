/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

/*
 * TeXLeaf visual-editor bracket pair colorization.
 *
 * The Webview cannot inherit Monaco's bracket-highlighting decorations.  This
 * scanner supplies the small amount of structural data needed to paint the
 * same six editorBracketHighlight colours on top of the TextMate layer.  It is
 * deliberately line-incremental: ordinary edits re-scan the changed lines and
 * only the suffix whose bracket/opaque-environment state actually changed.
 */

const MAX_INCREMENTAL_BRACKET_LINES = 512;

const OPAQUE_ENVIRONMENTS = new Set([
  "Verbatim",
  "Verbatim*",
  "comment",
  "filecontents",
  "filecontents*",
  "lstlisting",
  "lstlisting*",
  "minted",
  "verbatim",
  "verbatim*",
]);

type VisualLatexBracketKind = "brace" | "round" | "square";

interface VisualLatexBracketState {
  readonly stack: readonly VisualLatexBracketKind[];
  readonly opaqueEnvironment?: string;
}

export interface VisualEditorBracketToken {
  readonly from: number;
  readonly to: number;
  /** Zero-based nesting depth; the Webview cycles this through six colours. */
  readonly depth: number;
}

export interface VisualBracketLineInput {
  readonly text: string;
  readonly eolLength: 0 | 1 | 2;
}

export interface VisualBracketIncrementalInput {
  readonly beforeText: string;
  readonly afterText: string;
  readonly startLine: number;
  readonly oldEndLine: number;
  readonly startOffset: number;
  readonly newLines: readonly VisualBracketLineInput[];
}

export interface VisualEditorBracketTokenPatch {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly tokens: readonly VisualEditorBracketToken[];
  /** False means the bracket state did not stabilize inside the safety cap. */
  readonly complete: boolean;
}

interface CachedBracketLine extends VisualBracketLineInput {
  /** Missing only on newly spliced lines that have not been re-scanned yet. */
  readonly state?: VisualLatexBracketState;
  readonly tokens: readonly VisualEditorBracketToken[];
}

interface BracketDocumentCache {
  readonly text: string;
  readonly lines: readonly CachedBracketLine[];
}

const EMPTY_BRACKET_STATE: VisualLatexBracketState = { stack: [] };

/**
 * Keep a per-document line cache for CodeMirror's optimistic edit stream.
 *
 * Opening brackets are coloured as soon as they are syntactically valid.
 * Mismatched closing brackets are intentionally omitted, allowing the active
 * theme's TextMate/unexpected-bracket presentation to remain visible.
 */
export class VisualBracketColorizationIndex {
  private readonly caches = new Map<string, BracketDocumentCache>();

  public invalidate(key?: string): void {
    if (key === undefined) {
      this.caches.clear();
      return;
    }
    this.caches.delete(key);
  }

  public tokenize(
    text: string,
    key: string,
  ): readonly VisualEditorBracketToken[] {
    const snapshot = tokenizeVisualBracketDocument(text);
    this.caches.set(key, snapshot.cache);
    return snapshot.tokens;
  }

  public tokenizeIncremental(
    input: VisualBracketIncrementalInput,
    key: string,
  ): VisualEditorBracketTokenPatch | undefined {
    const cache = this.caches.get(key);
    if (cache === undefined || cache.text !== input.beforeText) {
      return undefined;
    }
    if (!validIncrementalInput(input, cache.lines.length)) {
      return undefined;
    }

    const lines: CachedBracketLine[] = [...cache.lines];
    const replacement = input.newLines.map((line): CachedBracketLine => ({
      text: line.text,
      eolLength: line.eolLength,
      tokens: [],
    }));
    lines.splice(
      input.startLine,
      input.oldEndLine - input.startLine + 1,
      ...replacement,
    );

    const changedEndLine = input.startLine + replacement.length - 1;
    let incoming = input.startLine === 0
      ? EMPTY_BRACKET_STATE
      : lines[input.startLine - 1]?.state;
    if (incoming === undefined) {
      return undefined;
    }

    const tokens: VisualEditorBracketToken[] = [];
    let absoluteOffset = input.startOffset;
    let processedEndLine = input.startLine - 1;
    let complete = false;
    for (
      let lineIndex = input.startLine;
      lineIndex < lines.length &&
      lineIndex < input.startLine + MAX_INCREMENTAL_BRACKET_LINES;
      lineIndex += 1
    ) {
      const previous = lines[lineIndex];
      if (previous === undefined) {
        break;
      }
      const tokenized = tokenizeVisualBracketLine(previous.text, incoming);
      const next: CachedBracketLine = {
        text: previous.text,
        eolLength: previous.eolLength,
        state: tokenized.state,
        tokens: tokenized.tokens,
      };
      lines[lineIndex] = next;
      for (const token of tokenized.tokens) {
        tokens.push({
          ...token,
          from: absoluteOffset + token.from,
          to: absoluteOffset + token.to,
        });
      }
      absoluteOffset += previous.text.length + previous.eolLength;
      processedEndLine = lineIndex;

      const reachedDocumentEnd = lineIndex === lines.length - 1;
      const reachedStableSuffix = lineIndex >= changedEndLine &&
        previous.state !== undefined &&
        bracketStateEqual(tokenized.state, previous.state);
      if (reachedDocumentEnd || reachedStableSuffix) {
        complete = true;
        break;
      }
      incoming = tokenized.state;
    }
    if (processedEndLine < input.startLine) {
      return undefined;
    }

    // A non-stabilizing malformed construct is bounded to 512 lines. Clear the
    // stale suffix in the Webview and let the provider's normal idle snapshot
    // rebuild the complete index instead of blocking the typing transaction.
    const patchTo = complete ? absoluteOffset : input.afterText.length;
    if (complete) {
      this.caches.set(key, { text: input.afterText, lines });
    } else {
      this.caches.delete(key);
    }
    return {
      from: input.startOffset,
      to: patchTo,
      expectedText: input.afterText.slice(input.startOffset, patchTo),
      tokens,
      complete,
    };
  }
}

export function tokenizeVisualBracketDocument(text: string): {
  readonly tokens: readonly VisualEditorBracketToken[];
  readonly cache: BracketDocumentCache;
} {
  const tokens: VisualEditorBracketToken[] = [];
  const lines: CachedBracketLine[] = [];
  let state = EMPTY_BRACKET_STATE;
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const rawLineEnd = newline < 0 ? text.length : newline;
    const contentEnd = rawLineEnd > lineStart &&
        text.charCodeAt(rawLineEnd - 1) === 13
      ? rawLineEnd - 1
      : rawLineEnd;
    const lineText = text.slice(lineStart, contentEnd);
    const tokenized = tokenizeVisualBracketLine(lineText, state);
    state = tokenized.state;
    for (const token of tokenized.tokens) {
      tokens.push({
        ...token,
        from: lineStart + token.from,
        to: lineStart + token.to,
      });
    }
    const eolLength = newline < 0
      ? 0
      : rawLineEnd - contentEnd + 1;
    lines.push({
      text: lineText,
      eolLength: eolLength as 0 | 1 | 2,
      state,
      tokens: tokenized.tokens,
    });
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }
  return { tokens, cache: { text, lines } };
}

export function tokenizeVisualBracketLine(
  line: string,
  incoming: VisualLatexBracketState = EMPTY_BRACKET_STATE,
): {
  readonly state: VisualLatexBracketState;
  readonly tokens: readonly VisualEditorBracketToken[];
} {
  const stack = [...incoming.stack];
  const tokens: VisualEditorBracketToken[] = [];
  let opaqueEnvironment = incoming.opaqueEnvironment;
  let pendingOpaqueStart:
    | { readonly environment: string; readonly after: number }
    | undefined;

  for (let offset = 0; offset < line.length;) {
    if (
      pendingOpaqueStart !== undefined &&
      offset >= pendingOpaqueStart.after
    ) {
      opaqueEnvironment = pendingOpaqueStart.environment;
      pendingOpaqueStart = undefined;
      continue;
    }

    if (opaqueEnvironment !== undefined) {
      const endCommand = `\\end{${opaqueEnvironment}}`;
      const endOffset = findUnescapedLiteral(line, endCommand, offset);
      if (endOffset < 0) {
        break;
      }
      // Resume at the boundary itself so the braces in \end{...} receive the
      // same depth colour as an ordinary environment boundary.
      offset = endOffset;
      opaqueEnvironment = undefined;
      continue;
    }

    const character = line[offset];
    if (character === "%" && !isEscapedAt(line, offset)) {
      break;
    }

    if (character === "\\" && !isEscapedAt(line, offset)) {
      const verbEnd = latexInlineVerbatimEnd(line, offset);
      if (verbEnd !== undefined) {
        offset = verbEnd;
        continue;
      }
      const opaqueBoundary = opaqueEnvironmentBoundary(line, offset);
      if (opaqueBoundary !== undefined) {
        pendingOpaqueStart = opaqueBoundary;
      }
    }

    if (!isEscapedAt(line, offset)) {
      const kind = openingBracketKind(character);
      if (kind !== undefined) {
        tokens.push({ from: offset, to: offset + 1, depth: stack.length });
        stack.push(kind);
        offset += 1;
        continue;
      }
      if (isClosingBracket(character)) {
        const depth = stack.length - 1;
        const openingKind = stack[depth];
        if (
          depth >= 0 &&
          openingKind !== undefined &&
          closingBracketMatches(openingKind, character)
        ) {
          stack.pop();
          tokens.push({ from: offset, to: offset + 1, depth });
        }
        // A mismatched/unexpected closer deliberately keeps its TextMate colour.
        offset += 1;
        continue;
      }
    }
    offset += 1;
  }

  // A conventional \begin{verbatim} boundary commonly ends the physical
  // line. The loop has no next iteration at `after`, so carry the newly opened
  // opaque region explicitly into the following line.
  if (
    pendingOpaqueStart !== undefined &&
    pendingOpaqueStart.after <= line.length
  ) {
    opaqueEnvironment = pendingOpaqueStart.environment;
  }

  return {
    state: {
      stack,
      ...(opaqueEnvironment === undefined ? {} : { opaqueEnvironment }),
    },
    tokens,
  };
}

function validIncrementalInput(
  input: VisualBracketIncrementalInput,
  cachedLineCount: number,
): boolean {
  return Number.isSafeInteger(input.startLine) &&
    Number.isSafeInteger(input.oldEndLine) &&
    Number.isSafeInteger(input.startOffset) &&
    input.startLine >= 0 &&
    input.oldEndLine >= input.startLine &&
    input.oldEndLine < cachedLineCount &&
    input.startOffset >= 0 &&
    input.startOffset <= input.afterText.length &&
    input.newLines.length > 0 &&
    input.newLines.every((line) =>
      line.eolLength === 0 || line.eolLength === 1 || line.eolLength === 2
    );
}

function bracketStateEqual(
  left: VisualLatexBracketState,
  right: VisualLatexBracketState,
): boolean {
  return left.opaqueEnvironment === right.opaqueEnvironment &&
    left.stack.length === right.stack.length &&
    left.stack.every((kind, index) => kind === right.stack[index]);
}

function openingBracketKind(
  character: string | undefined,
): VisualLatexBracketKind | undefined {
  if (character === "{") {
    return "brace";
  }
  if (character === "[") {
    return "square";
  }
  return character === "(" ? "round" : undefined;
}

function isClosingBracket(
  character: string | undefined,
): character is ")" | "]" | "}" {
  return character === ")" || character === "]" || character === "}";
}

function closingBracketMatches(
  openingKind: VisualLatexBracketKind,
  closing: ")" | "]" | "}",
): boolean {
  if (openingKind === "brace") {
    return closing === "}";
  }
  // LaTeX Workshop declares both interval forms `[...)` and `(...]` in
  // addition to ordinary square/round pairs. Command-form delimiters such as
  // `\left(` ... `\right)` are outside this lightweight character scanner.
  return closing === ")" || closing === "]";
}

function isEscapedAt(text: string, offset: number): boolean {
  let slashCount = 0;
  for (
    let cursor = offset - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function findUnescapedLiteral(
  text: string,
  literal: string,
  from: number,
): number {
  for (let offset = text.indexOf(literal, from); offset >= 0;) {
    if (!isEscapedAt(text, offset)) {
      return offset;
    }
    offset = text.indexOf(literal, offset + literal.length);
  }
  return -1;
}

function latexInlineVerbatimEnd(
  line: string,
  offset: number,
): number | undefined {
  const suffix = line.slice(offset);
  const command = /^(?:\\verb\*?|\\lstinline\*?)(?![A-Za-z@])/u.exec(suffix)?.[0];
  if (command === undefined) {
    return undefined;
  }
  const delimiterOffset = offset + command.length;
  const delimiter = line[delimiterOffset];
  if (delimiter === undefined || /\s/u.test(delimiter)) {
    return line.length;
  }
  const closingOffset = line.indexOf(delimiter, delimiterOffset + 1);
  return closingOffset < 0 ? line.length : closingOffset + 1;
}

function opaqueEnvironmentBoundary(
  line: string,
  offset: number,
): { readonly environment: string; readonly after: number } | undefined {
  const match = /^\\begin\s*\{([^{}\r\n]+)\}/u.exec(line.slice(offset));
  if (match === null) {
    return undefined;
  }
  const environment = match[1]?.trim();
  if (environment === undefined || !OPAQUE_ENVIRONMENTS.has(environment)) {
    return undefined;
  }
  return { environment, after: offset + match[0].length };
}
