/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { findFractionNumerator } from "./fraction";
import {
  isMatrixEnvironment,
  scanLatexContext,
  scanLatexRegions,
} from "./latexScanner";
import { planTabout } from "./tabout";
import type {
  LatexContext,
  LatexMathRegion,
  OffsetRange,
  ReplacementPart,
} from "./types";

export interface VisualSnippetPlan {
  readonly range: OffsetRange;
  readonly parts: readonly ReplacementPart[];
}

export interface VisualAutoFractionOptions {
  readonly command: string;
  readonly breakingCharacters: string;
}

export interface CodeMirrorSnippetEncoding {
  readonly template: string;
  readonly openBraceMarker: string;
  readonly closeBraceMarker: string;
}

export interface CodeMirrorCompletionSnippet extends CodeMirrorSnippetEncoding {
  readonly insertedText: string;
}

export interface VisualInlineStyleTogglePlan {
  readonly range: OffsetRange;
  readonly insert: string;
  readonly selection: OffsetRange;
  readonly action: "wrap" | "unwrap" | "replace";
}

export interface VirtualSnippetRange {
  readonly from: number;
  readonly to: number;
}

/**
 * One logical placeholder in a lightweight LaTeX input. Repeated ranges are
 * mirrors of the same field and are kept together so the Webview can update
 * them atomically without creating a full CodeMirror instance per table cell.
 */
export interface VirtualSnippetField {
  readonly index: number;
  readonly ranges: readonly VirtualSnippetRange[];
}

export interface VirtualSnippetEncoding {
  readonly text: string;
  readonly fields: readonly VirtualSnippetField[];
}

export interface VisualEnvironmentChangedRange {
  readonly start: number;
  readonly end: number;
}

export interface VisualEnvironmentSyncChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface VisualListEnterPlan {
  readonly range: OffsetRange;
  readonly insert: string;
  readonly cursorOffset: number;
  readonly action: "insert-item" | "remove-empty-item";
}

export interface VisualAlignTabPlan {
  readonly range: OffsetRange;
  readonly insert: string;
  readonly cursorOffset: number;
  readonly action: "insert-alignment";
}

export interface VisualEnvironmentExitPlan {
  readonly range: OffsetRange;
  readonly insert: string;
  readonly cursorOffset: number;
  readonly boundaryKind: "environment" | "display-bracket" | "display-dollar";
  readonly environmentName?: string;
}

/** One physical LaTeX source line, excluding its line break. */
export interface VisualLogicalLineTarget {
  readonly from: number;
  readonly to: number;
}

/** The subset of a visual formula record needed by logical-line navigation. */
export interface VisualLogicalLineFormulaRange {
  readonly from: number;
  readonly to: number;
  readonly display: boolean;
}

export type VisualLogicalLineRevealPlan =
  | {
      readonly kind: "line";
      readonly ranges: readonly [VisualLogicalLineTarget];
      readonly scopeFrom: number;
      readonly scopeTo: number;
    }
  | {
      readonly kind: "formula";
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly kind: "environment-boundary";
      readonly ranges: readonly [
        VisualLogicalLineTarget,
        VisualLogicalLineTarget,
      ];
      readonly scopeFrom: number;
      readonly scopeTo: number;
      readonly environmentName: string;
    };

export interface VisualLogicalLineNavigationPlan {
  readonly cursorOffset: number;
  /** Sticky UTF-16 source column retained across repeated Up/Down presses. */
  readonly goalColumn: number;
  readonly reveal: VisualLogicalLineRevealPlan;
}

export interface VisualProviderCompletionActivation {
  readonly explicit: boolean;
  readonly query: string;
  readonly characterBefore: string;
  /** The LaTeX construct owning the token at the caret. */
  readonly contextKind?: VisualLatexCompletionContextKind;
  /** @deprecated Kept for callers compiled against the pre-context bridge. */
  readonly inCitationContext?: boolean;
}

export type VisualLatexCompletionContextKind =
  | "citation"
  | "reference"
  | "label-definition"
  | "environment"
  | "argument"
  | "command"
  | "snippet";

export interface VisualLatexCompletionContext {
  readonly kind: VisualLatexCompletionContextKind;
  readonly from: number;
  readonly to: number;
  readonly query: string;
  /** Owning command without the leading backslash, when there is one. */
  readonly command?: string;
  /** One-based required/optional argument position when it can be recovered. */
  readonly argumentIndex?: number;
}

export interface VisualSelectionSourceRange {
  readonly from: number;
  readonly to: number;
  readonly head: number;
}

export interface VisualSourceActivationRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Match the strict source-range rule used by collapsed visual replacements.
 * A caret at either boundary is outside; a non-empty selection touches the
 * range only when the two half-open intervals overlap.
 */
export function visualSelectionTouchesSourceRange(
  ranges: readonly VisualSelectionSourceRange[],
  from: number,
  to: number,
): boolean {
  return ranges.some((range) =>
    range.from === range.to
      ? range.head > from && range.head < to
      : range.from < to && range.to > from
  );
}

/**
 * Whether a visual replacement's source is still deliberately exposed. A
 * paired/manual reveal can keep source visible while the caret sits at an exact
 * boundary, so consumers such as citation detail cards must honor both inputs.
 */
export function visualSourceRangeRemainsExpanded(
  selections: readonly VisualSelectionSourceRange[],
  reveals: readonly VisualSourceActivationRange[],
  from: number,
  to: number,
): boolean {
  return visualSelectionTouchesSourceRange(selections, from, to) ||
    reveals.some((range) => range.from < to && range.to > from);
}

export interface VisualCompletedArgumentCursorOptions {
  readonly citationCommands?: readonly string[];
  /**
   * A provider-owned follow-up still needs to resolve the citation at the
   * post-edit caret. Keep that caret before the existing closing brace until
   * the opaque completion action has finished.
   */
  readonly completionActionPending?: boolean;
}

/**
 * Return the post-edit caret for a completed citation/label argument value.
 * The existing closing brace is not part of the provider edit, so accepting a
 * plain key may explicitly move across it. Command snippets such as
 * `\\ref{${1}}` and completion items with a pending citation action are
 * excluded because their caret still belongs inside the argument.
 */
export function visualCompletedArgumentCursor(
  source: string,
  from: number,
  to: number,
  insertedText: string,
  options: VisualCompletedArgumentCursorOptions = {},
): number | undefined {
  if (
    options.completionActionPending === true ||
    from < 0 ||
    to < from ||
    to >= source.length ||
    source[to] !== "}" ||
    /[{}\r\n]/u.test(insertedText)
  ) {
    return undefined;
  }
  const context = visualLatexCompletionContextAt(
    source,
    to,
    options.citationCommands ?? VISUAL_DEFAULT_CITATION_COMMANDS,
  );
  if (
    context.to !== to ||
    from < context.from ||
    (
      context.kind !== "citation" &&
      context.kind !== "reference" &&
      context.kind !== "label-definition"
    )
  ) {
    return undefined;
  }
  return from + insertedText.length + 1;
}

/**
 * Recover the caret owned by a completion follow-up from the exact inserted
 * range rather than from mutable UI focus/selection state.
 */
export function visualCompletionFollowUpCursor(
  source: string,
  from: number,
  insertedText: string,
): number | undefined {
  if (
    !Number.isSafeInteger(from) ||
    from < 0 ||
    insertedText.length > source.length - from
  ) {
    return undefined;
  }
  const cursor = from + insertedText.length;
  return source.slice(from, cursor) === insertedText ? cursor : undefined;
}

/**
 * Describe the smallest single replacement that turns one document snapshot
 * into another. Applying this replacement through CodeMirror lets its native
 * change mapping keep carets attached to the surrounding text; replacing the
 * whole document while reusing a numeric offset cannot do that.
 */
export function visualSingleTextDifference(
  before: string,
  after: string,
): { readonly from: number; readonly to: number; readonly insert: string } | undefined {
  if (before === after) {
    return undefined;
  }
  let from = 0;
  while (
    from < before.length &&
    from < after.length &&
    before[from] === after[from]
  ) {
    from += 1;
  }
  let beforeTo = before.length;
  let afterTo = after.length;
  while (
    beforeTo > from &&
    afterTo > from &&
    before[beforeTo - 1] === after[afterTo - 1]
  ) {
    beforeTo -= 1;
    afterTo -= 1;
  }
  return { from, to: beforeTo, insert: after.slice(from, afterTo) };
}

const VISUAL_REFERENCE_COMPLETION_COMMANDS = new Set([
  "ref",
  "pageref",
  "eqref",
  "autoref",
  "Autoref",
  "cref",
  "Cref",
  "cpageref",
  "Cpageref",
  "vref",
  "Vref",
  "nameref",
  "prettyref",
  "fref",
  "Fref",
  "sref",
]);

const VISUAL_DEFAULT_CITATION_COMMANDS = [
  "cite",
  "Cite",
  "citep",
  "Citep",
  "citet",
  "Citet",
  "citealp",
  "citealt",
  "citeauthor",
  "Citeauthor",
  "citeyear",
  "citeyearpar",
  "autocite",
  "Autocite",
  "parencite",
  "Parencite",
  "textcite",
  "Textcite",
  "footcite",
  "footcitetext",
  "smartcite",
  "Smartcite",
  "supercite",
  "fullcite",
  "footfullcite",
  "citetitle",
  "citedate",
  "nocite",
  "cites",
  "Cites",
  "autocites",
  "Autocites",
  "parencites",
  "Parencites",
  "textcites",
  "Textcites",
  "footcites",
  "footcitetexts",
  "smartcites",
  "Smartcites",
  "bibentry",
  "cquote",
] as const;

interface VisualOwningArgument {
  readonly opening: number;
  readonly command?: string;
  readonly commandStart?: number;
  readonly argumentIndex?: number;
  readonly delimiter: "{" | "[";
}

/**
 * Classify the token at a visual-editor caret once, before any provider is
 * queried.  This is the shared replacement-range contract for CodeMirror,
 * TeXLeaf, VS Code completion providers and the LaTeX Workshop adapter.
 *
 * The scan is deliberately bounded and walks balanced delimiters backwards.
 * It therefore handles wrapped arguments and nested macros without doing an
 * O(document length) citation scan on every typed character in a thesis.
 */
export function visualLatexCompletionContextAt(
  source: string,
  requestedPosition: number,
  citationCommands: readonly string[] = VISUAL_DEFAULT_CITATION_COMMANDS,
): VisualLatexCompletionContext {
  const to = Math.max(0, Math.min(Math.trunc(requestedPosition), source.length));
  const lowerBound = Math.max(0, to - 65_536);
  const owning = visualOwningArgument(source, to, lowerBound);
  if (owning !== undefined) {
    const command = owning.command;
    const citationNames = new Set(
      [...VISUAL_DEFAULT_CITATION_COMMANDS, ...citationCommands]
        .map((value) => value.trim().replace(/^\\+/u, "").replace(/\*$/u, ""))
        .filter((value) => value.length > 0),
    );
    const kind: VisualLatexCompletionContextKind = command !== undefined &&
        citationNames.has(command.replace(/\*$/u, ""))
      ? "citation"
      : command !== undefined && VISUAL_REFERENCE_COMPLETION_COMMANDS.has(command)
        ? "reference"
        : command === "label"
          ? "label-definition"
          : command === "begin" || command === "end"
            ? "environment"
            : "argument";
    const argumentStart = owning.opening + 1;
    const tokenStart = kind === "citation" || kind === "reference"
      ? visualTopLevelSegmentStart(source, argumentStart, to)
      : visualArgumentTokenStart(source, argumentStart, to);
    const from = visualSkipWhitespaceForward(source, tokenStart, to);
    return {
      kind,
      from,
      to,
      query: source.slice(from, to),
      ...(command === undefined ? {} : { command }),
      ...(owning.argumentIndex === undefined
        ? {}
        : { argumentIndex: owning.argumentIndex }),
    };
  }

  const local = source.slice(lowerBound, to);
  const commandMatch = /\\(?:\+?[A-Za-z_@]*(?::[A-Za-z]*)?)$/u.exec(local);
  if (commandMatch !== null) {
    const from = lowerBound + commandMatch.index;
    return {
      kind: "command",
      from,
      to,
      query: source.slice(from, to),
    };
  }

  const snippetMatch = /[\p{L}\p{N}_:@.-]+$/u.exec(local);
  const from = snippetMatch === null ? to : lowerBound + snippetMatch.index;
  return {
    kind: "snippet",
    from,
    to,
    query: source.slice(from, to),
  };
}

function visualOwningArgument(
  source: string,
  position: number,
  lowerBound: number,
): VisualOwningArgument | undefined {
  const closing: string[] = [];
  let opening = -1;
  let delimiter: "{" | "[" | undefined;
  for (let index = position - 1; index >= lowerBound; index -= 1) {
    const char = source[index];
    if (char === undefined || visualEscapedAt(source, index)) {
      continue;
    }
    if (char === "}" || char === "]") {
      closing.push(char);
      continue;
    }
    if (char !== "{" && char !== "[") {
      continue;
    }
    const expected = char === "{" ? "}" : "]";
    if (closing[closing.length - 1] === expected) {
      closing.pop();
      continue;
    }
    if (closing.length > 0) {
      continue;
    }
    opening = index;
    delimiter = char;
    break;
  }
  if (opening < 0 || delimiter === undefined) {
    return undefined;
  }

  const owner = visualArgumentOwner(source, opening, lowerBound);
  if (owner === undefined) {
    const marker = source.slice(Math.max(lowerBound, opening - 2), opening).trimEnd();
    if (!marker.endsWith("_") && !marker.endsWith("^")) {
      return undefined;
    }
    return { opening, delimiter };
  }
  return {
    opening,
    delimiter,
    command: owner.command,
    commandStart: owner.commandStart,
    argumentIndex: owner.argumentIndex,
  };
}

function visualArgumentOwner(
  source: string,
  opening: number,
  lowerBound: number,
): { readonly command: string; readonly commandStart: number; readonly argumentIndex: number } | undefined {
  let cursor = visualSkipWhitespaceBackward(source, opening - 1, lowerBound);
  let argumentIndex = 1;
  while (cursor >= lowerBound && (source[cursor] === "}" || source[cursor] === "]")) {
    const close = source[cursor] ?? "";
    const open = close === "}" ? "{" : "[";
    let depth = 1;
    cursor -= 1;
    while (cursor >= lowerBound && depth > 0) {
      if (!visualEscapedAt(source, cursor)) {
        if (source[cursor] === close) {
          depth += 1;
        } else if (source[cursor] === open) {
          depth -= 1;
        }
      }
      cursor -= 1;
    }
    if (depth !== 0) {
      return undefined;
    }
    argumentIndex += 1;
    cursor = visualSkipWhitespaceBackward(source, cursor, lowerBound);
  }
  if (source[cursor] === "*") {
    cursor = visualSkipWhitespaceBackward(source, cursor - 1, lowerBound);
  }
  const end = cursor + 1;
  while (cursor >= lowerBound && /[A-Za-z@]/u.test(source[cursor] ?? "")) {
    cursor -= 1;
  }
  if (cursor < lowerBound || source[cursor] !== "\\" || end <= cursor + 1) {
    return undefined;
  }
  return {
    command: source.slice(cursor + 1, end),
    commandStart: cursor,
    argumentIndex,
  };
}

function visualTopLevelSegmentStart(source: string, start: number, end: number): number {
  let curly = 0;
  let square = 0;
  let segment = start;
  for (let index = start; index < end; index += 1) {
    if (visualEscapedAt(source, index)) {
      continue;
    }
    switch (source[index]) {
      case "{": curly += 1; break;
      case "}": curly = Math.max(0, curly - 1); break;
      case "[": square += 1; break;
      case "]": square = Math.max(0, square - 1); break;
      case ",":
        if (curly === 0 && square === 0) {
          segment = index + 1;
        }
        break;
    }
  }
  return segment;
}

function visualArgumentTokenStart(source: string, start: number, end: number): number {
  const match = /[\p{L}\p{N}_:@./+*=-]*$/u.exec(source.slice(start, end));
  return match === null ? end : start + match.index;
}

function visualSkipWhitespaceForward(source: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && /\s/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function visualSkipWhitespaceBackward(source: string, start: number, lowerBound: number): number {
  let cursor = start;
  while (cursor >= lowerBound && /\s/u.test(source[cursor] ?? "")) {
    cursor -= 1;
  }
  return cursor;
}

function visualEscapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/**
 * Decide whether an editor-side provider completion should start after one
 * typed character. CodeMirror asks every completion source after every input;
 * punctuation therefore needs an explicit boundary. In particular, a comma
 * is meaningful after one citation key, but an ordinary prose/math comma must
 * not open the entire LaTeX/snippet catalogue.
 */
export function shouldActivateVisualProviderCompletion(
  activation: VisualProviderCompletionActivation,
): boolean {
  if (activation.explicit || activation.query.length >= 2) {
    return true;
  }
  const citation = activation.contextKind === "citation" ||
    activation.inCitationContext === true;
  if (
    activation.contextKind === "reference" ||
    activation.contextKind === "label-definition" ||
    activation.contextKind === "environment" ||
    activation.contextKind === "argument"
  ) {
    return true;
  }
  // An empty (or whitespace-only) cite segment is itself a meaningful
  // completion request: it opens the collected `.bib` bibliography. This is
  // intentionally narrower than treating arbitrary whitespace as a trigger.
  if (citation && activation.query.trim().length === 0) {
    return true;
  }
  if (activation.characterBefore === ",") {
    return citation;
  }
  return /^[\\{[@:]$/u.test(activation.characterBefore);
}

export interface VisualHiddenEnvironmentBoundary {
  /** Full replacement range, including a standalone boundary line's newline. */
  readonly from: number;
  readonly to: number;
  /** Exact `\\begin...` or `\\end...` command source range. */
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

export interface VisualHiddenEnvironmentBoundaryRevealPlan {
  readonly sourceFrom: number;
  readonly sourceTo: number;
}

/**
 * Reveal, rather than delete, a collapsed environment boundary immediately
 * before Backspace. A visual replacement may include the whole standalone
 * `\\begin`/`\\end` line, so deleting backward at its post-replacement edge
 * can otherwise remove source the user never saw. The caller passes only
 * boundaries that are currently hidden; once revealed, normal explicit source
 * editing is left untouched.
 */
export function planVisualHiddenEnvironmentBoundaryBackspace(
  selection: number | OffsetRange,
  boundaries: readonly VisualHiddenEnvironmentBoundary[],
): VisualHiddenEnvironmentBoundaryRevealPlan | undefined {
  const start = typeof selection === "number" ? selection : selection.start;
  const end = typeof selection === "number" ? selection : selection.end;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return undefined;
  }
  return boundaries
    .filter((boundary) =>
      Number.isSafeInteger(boundary.from) &&
      Number.isSafeInteger(boundary.to) &&
      Number.isSafeInteger(boundary.sourceFrom) &&
      Number.isSafeInteger(boundary.sourceTo) &&
      boundary.from >= 0 &&
      boundary.to > boundary.from &&
      boundary.sourceFrom >= boundary.from &&
      boundary.sourceTo > boundary.sourceFrom &&
      boundary.sourceTo <= boundary.to &&
      (
        (start === end && boundary.to === end) ||
        (start < end && start < boundary.to && end > boundary.from)
      )
    )
    .sort((left, right) =>
      (left.to - left.from) - (right.to - right.from) ||
      right.sourceFrom - left.sourceFrom
    )
    .map((boundary) => ({
      sourceFrom: boundary.sourceFrom,
      sourceTo: boundary.sourceTo,
    }))[0];
}

type ParsedVsCodeSnippetNode =
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "field";
      readonly index: number;
      readonly children: readonly ParsedVsCodeSnippetNode[] | undefined;
      readonly choices: readonly string[] | undefined;
    }
  | {
      readonly kind: "variable";
      readonly name: string;
      readonly children: readonly ParsedVsCodeSnippetNode[] | undefined;
    };

interface ParsedVsCodeSnippetSequence {
  readonly nodes: readonly ParsedVsCodeSnippetNode[];
  readonly next: number;
}

/**
 * Encode TeXLeaf replacement parts for CodeMirror's snippet parser.
 *
 * CodeMirror orders numbered fields numerically and deactivates the snippet
 * when the last field is reached. Snippet Leaf already uses zero-based field
 * order, so adding one preserves @0, @1, ... without VS Code's special `$0`
 * remapping. CodeMirror's brace-escape parser shifts later field ranges in
 * brace-heavy LaTeX, so literal braces use two collision-free private-use
 * markers. The Webview replaces those markers inside CodeMirror's generated
 * transaction before dispatch, so field ranges stay exact and one undo removes
 * the complete snippet without leaving `{}` behind.
 */
export function replacementPartsToCodeMirrorSnippet(
  parts: readonly ReplacementPart[],
): CodeMirrorSnippetEncoding {
  const { openBraceMarker, closeBraceMarker } = codeMirrorBraceMarkers(
    parts.map((part) =>
      part.kind === "text" ? part.value : part.placeholder ?? ""
    ),
  );
  const encodeBraces = (value: string): string => value
    .replaceAll("{", openBraceMarker)
    .replaceAll("}", closeBraceMarker);
  const template = parts.map((part) => {
    if (part.kind === "text") {
      return encodeBraces(part.value);
    }
    const index = part.index + 1;
    if (part.placeholder === undefined) {
      return `\${${index}}`;
    }
    const placeholder = encodeBraces(part.placeholder);
    return `\${${index}:${placeholder}}`;
  }).join("");
  return { template, openBraceMarker, closeBraceMarker };
}

/** Materialize a TeXLeaf snippet for an HTML input while retaining fields. */
export function replacementPartsToVirtualSnippet(
  parts: readonly ReplacementPart[],
): VirtualSnippetEncoding {
  let text = "";
  const fields = new Map<number, VirtualSnippetRange[]>();
  for (const part of parts) {
    if (part.kind === "text") {
      text += part.value;
      continue;
    }
    const value = part.placeholder ?? "";
    const ranges = fields.get(part.index) ?? [];
    ranges.push({ from: text.length, to: text.length + value.length });
    fields.set(part.index, ranges);
    text += value;
  }
  return {
    text,
    fields: [...fields.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, ranges]) => ({ index, ranges })),
  };
}

/**
 * Convert the safe, commonly emitted subset of VS Code SnippetString syntax
 * into CodeMirror's numbered-field syntax. Literal LaTeX braces are encoded
 * with the same collision-free markers used by TeXLeaf snippets so the
 * Webview can restore them after CodeMirror establishes its field ranges.
 *
 * Regex transforms are deliberately rejected: executing or approximating an
 * arbitrary third-party transform in the Webview would make the inserted text
 * differ from the provider's contract. Choices use their first value, which is
 * the value VS Code initially inserts before the user cycles the choice.
 */
export function vscodeSnippetToCodeMirrorSnippet(
  value: string,
  variables: Readonly<Record<string, string>> = {},
): CodeMirrorCompletionSnippet | undefined {
  if (value.length > 100_000 || /[\u0000]/u.test(value)) {
    return undefined;
  }
  const parsed = parseVsCodeSnippetSequence(value, 0, false, 0);
  if (parsed === undefined || parsed.next !== value.length) {
    return undefined;
  }
  let maximumPositiveField = 0;
  visitVsCodeSnippetNodes(parsed.nodes, (node) => {
    if (node.kind === "field" && node.index > maximumPositiveField) {
      maximumPositiveField = node.index;
    }
  });
  const finalField = maximumPositiveField + 1;
  const { openBraceMarker, closeBraceMarker } = codeMirrorBraceMarkers([
    value,
    ...Object.values(variables),
  ]);
  const fieldValues = new Map<number, string>();

  const encodeLiteral = (text: string): string => text
    .replaceAll("{", openBraceMarker)
    .replaceAll("}", closeBraceMarker);
  const render = (
    nodes: readonly ParsedVsCodeSnippetNode[],
  ): { readonly template: string; readonly text: string } => {
    let template = "";
    let text = "";
    for (const node of nodes) {
      if (node.kind === "text") {
        template += encodeLiteral(node.value);
        text += node.value;
        continue;
      }
      if (node.kind === "variable") {
        const resolved = variables[node.name];
        const fallback = node.children === undefined
          ? undefined
          : render(node.children).text;
        const variableText = resolved !== undefined && resolved.length > 0
          ? resolved
          : fallback ?? (resolved === undefined ? node.name : "");
        template += encodeLiteral(variableText);
        text += variableText;
        continue;
      }

      const field = node.index === 0 ? finalField : node.index;
      const existing = fieldValues.get(field);
      if (existing !== undefined) {
        template += `\${${field}}`;
        text += existing;
        continue;
      }
      const defaultText = node.choices?.[0] ??
        (node.children === undefined ? "" : render(node.children).text);
      fieldValues.set(field, defaultText);
      template += defaultText.length === 0
        ? `\${${field}}`
        : `\${${field}:${encodeLiteral(defaultText)}}`;
      text += defaultText;
    }
    return { template, text };
  };

  const rendered = render(parsed.nodes);
  return {
    template: rendered.template,
    insertedText: rendered.text,
    openBraceMarker,
    closeBraceMarker,
  };
}

/**
 * Plan a safe toolbar-style toggle. A complete command selection and a
 * selection containing only that command's argument are deliberately treated
 * the same way. Partial argument selections are wrapped instead of removing a
 * wider style that the user did not select.
 */
export function planVisualInlineStyleToggle(
  source: string,
  selection: OffsetRange,
  canonicalCommand: string,
  aliases: readonly string[],
  placeholder = "正文",
): VisualInlineStyleTogglePlan | undefined {
  if (
    !validSourceRange(source, selection) ||
    !validLatexCommandName(canonicalCommand) ||
    aliases.length === 0 ||
    aliases.some((alias) => !validLatexCommandName(alias))
  ) {
    return undefined;
  }
  const commands = [...new Set([canonicalCommand, ...aliases])]
    .sort((left, right) => right.length - left.length);
  const wrapper = selectedCommandWrapper(source, selection, commands);
  if (wrapper !== undefined) {
    const body = source.slice(wrapper.body.start, wrapper.body.end);
    return {
      range: wrapper.range,
      insert: body,
      selection: {
        start: wrapper.range.start,
        end: wrapper.range.start + body.length,
      },
      action: "unwrap",
    };
  }

  const body = source.slice(selection.start, selection.end) || placeholder;
  const prefix = `\\${canonicalCommand}{`;
  return {
    range: selection,
    insert: `${prefix}${body}}`,
    selection: {
      start: selection.start + prefix.length,
      end: selection.start + prefix.length + body.length,
    },
    action: "wrap",
  };
}

/** Apply, replace, or remove the HTML color surrounding an exact selection. */
export function planVisualTextColorApply(
  source: string,
  selection: OffsetRange,
  htmlColor: string,
  placeholder = "正文",
): VisualInlineStyleTogglePlan | undefined {
  if (!validSourceRange(source, selection)) {
    return undefined;
  }
  const normalized = htmlColor.replace(/^#/u, "").toUpperCase();
  if (!/^[0-9A-F]{6}$/u.test(normalized)) {
    return undefined;
  }
  const wrapper = selectedTextColorWrapper(source, selection);
  const body = wrapper === undefined
    ? source.slice(selection.start, selection.end) || placeholder
    : source.slice(wrapper.body.start, wrapper.body.end);
  if (wrapper?.htmlColor === normalized) {
    return {
      range: wrapper.range,
      insert: body,
      selection: {
        start: wrapper.range.start,
        end: wrapper.range.start + body.length,
      },
      action: "unwrap",
    };
  }
  const range = wrapper?.range ?? selection;
  const prefix = `\\textcolor[HTML]{${normalized}}{`;
  return {
    range,
    insert: `${prefix}${body}}`,
    selection: {
      start: range.start + prefix.length,
      end: range.start + prefix.length + body.length,
    },
    action: wrapper === undefined ? "wrap" : "replace",
  };
}

interface SelectedLatexWrapper {
  readonly range: OffsetRange;
  readonly body: OffsetRange;
}

interface SelectedTextColorWrapper extends SelectedLatexWrapper {
  readonly htmlColor: string | undefined;
}

function selectedCommandWrapper(
  source: string,
  selection: OffsetRange,
  commands: readonly string[],
): SelectedLatexWrapper | undefined {
  for (const command of commands) {
    const whole = commandWrapperAt(source, selection.start, command);
    if (whole?.range.end === selection.end) {
      return whole;
    }
    const prefix = `\\${command}{`;
    const wrapperStart = selection.start - prefix.length;
    if (wrapperStart < 0 || source.slice(wrapperStart, selection.start) !== prefix) {
      continue;
    }
    const inner = commandWrapperAt(source, wrapperStart, command);
    if (
      inner?.body.start === selection.start &&
      inner.body.end === selection.end
    ) {
      return inner;
    }
  }
  return undefined;
}

function commandWrapperAt(
  source: string,
  start: number,
  command: string,
): SelectedLatexWrapper | undefined {
  const prefix = `\\${command}{`;
  if (!source.startsWith(prefix, start)) {
    return undefined;
  }
  const open = start + prefix.length - 1;
  const close = matchingLatexBrace(source, open);
  return close === undefined
    ? undefined
    : {
        range: { start, end: close + 1 },
        body: { start: open + 1, end: close },
      };
}

function selectedTextColorWrapper(
  source: string,
  selection: OffsetRange,
): SelectedTextColorWrapper | undefined {
  const whole = textColorWrapperAt(source, selection.start);
  if (whole?.range.end === selection.end) {
    return whole;
  }
  const lowerBound = Math.max(0, selection.start - 256);
  let candidate = source.lastIndexOf("\\textcolor", selection.start);
  while (candidate >= lowerBound) {
    const wrapper = textColorWrapperAt(source, candidate);
    if (
      wrapper?.body.start === selection.start &&
      wrapper.body.end === selection.end
    ) {
      return wrapper;
    }
    candidate = source.lastIndexOf("\\textcolor", candidate - 1);
  }
  return undefined;
}

function textColorWrapperAt(
  source: string,
  start: number,
): SelectedTextColorWrapper | undefined {
  const command = "\\textcolor";
  if (!source.startsWith(command, start)) {
    return undefined;
  }
  let cursor = start + command.length;
  let model: string | undefined;
  if (source[cursor] === "[") {
    const optionEnd = source.indexOf("]", cursor + 1);
    if (optionEnd < 0 || /[\r\n]/u.test(source.slice(cursor, optionEnd + 1))) {
      return undefined;
    }
    model = source.slice(cursor + 1, optionEnd).trim();
    cursor = optionEnd + 1;
  }
  if (source[cursor] !== "{") {
    return undefined;
  }
  const colorClose = matchingLatexBrace(source, cursor);
  if (colorClose === undefined || source[colorClose + 1] !== "{") {
    return undefined;
  }
  const color = source.slice(cursor + 1, colorClose).trim();
  const bodyOpen = colorClose + 1;
  const bodyClose = matchingLatexBrace(source, bodyOpen);
  if (bodyClose === undefined) {
    return undefined;
  }
  return {
    range: { start, end: bodyClose + 1 },
    body: { start: bodyOpen + 1, end: bodyClose },
    htmlColor: model?.toUpperCase() === "HTML" && /^[0-9A-F]{6}$/iu.test(color)
      ? color.toUpperCase()
      : undefined,
  };
}

function matchingLatexBrace(source: string, open: number): number | undefined {
  if (source[open] !== "{" || latexCharacterEscaped(source, open)) {
    return undefined;
  }
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (character === "%" && !latexCharacterEscaped(source, index)) {
      const newline = source.indexOf("\n", index + 1);
      if (newline < 0) {
        return undefined;
      }
      index = newline;
      continue;
    }
    if (latexCharacterEscaped(source, index)) {
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
      if (depth < 0) {
        return undefined;
      }
    }
  }
  return undefined;
}

function latexCharacterEscaped(source: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function validSourceRange(source: string, range: OffsetRange): boolean {
  return Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
    range.start >= 0 && range.start <= range.end && range.end <= source.length;
}

function validLatexCommandName(value: string): boolean {
  return /^[A-Za-z@]+$/u.test(value);
}

/**
 * Convert the same safe VS Code snippet subset into a lightweight-input
 * representation. Positive VS Code fields retain their order and `$0` is
 * placed last. Mirrored fields share one logical index.
 */
export function vscodeSnippetToVirtualSnippet(
  value: string,
  variables: Readonly<Record<string, string>> = {},
): VirtualSnippetEncoding | undefined {
  if (value.length > 100_000 || /[\u0000]/u.test(value)) {
    return undefined;
  }
  const parsed = parseVsCodeSnippetSequence(value, 0, false, 0);
  if (parsed === undefined || parsed.next !== value.length) {
    return undefined;
  }
  let maximumPositiveField = 0;
  visitVsCodeSnippetNodes(parsed.nodes, (node) => {
    if (node.kind === "field" && node.index > maximumPositiveField) {
      maximumPositiveField = node.index;
    }
  });
  const finalField = maximumPositiveField + 1;
  const fieldValues = new Map<number, string>();
  const fieldRanges = new Map<number, VirtualSnippetRange[]>();
  let text = "";

  const renderPlain = (nodes: readonly ParsedVsCodeSnippetNode[]): string => {
    let rendered = "";
    for (const node of nodes) {
      if (node.kind === "text") {
        rendered += node.value;
      } else if (node.kind === "variable") {
        const resolved = variables[node.name];
        const fallback = node.children === undefined
          ? undefined
          : renderPlain(node.children);
        rendered += resolved !== undefined && resolved.length > 0
          ? resolved
          : fallback ?? (resolved === undefined ? node.name : "");
      } else {
        rendered += node.choices?.[0] ??
          (node.children === undefined ? "" : renderPlain(node.children));
      }
    }
    return rendered;
  };

  const render = (nodes: readonly ParsedVsCodeSnippetNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "text") {
        text += node.value;
        continue;
      }
      if (node.kind === "variable") {
        const resolved = variables[node.name];
        const fallback = node.children === undefined
          ? undefined
          : renderPlain(node.children);
        text += resolved !== undefined && resolved.length > 0
          ? resolved
          : fallback ?? (resolved === undefined ? node.name : "");
        continue;
      }

      const field = node.index === 0 ? finalField : node.index;
      const defaultText = fieldValues.get(field) ?? node.choices?.[0] ??
        (node.children === undefined ? "" : renderPlain(node.children));
      fieldValues.set(field, defaultText);
      const ranges = fieldRanges.get(field) ?? [];
      ranges.push({ from: text.length, to: text.length + defaultText.length });
      fieldRanges.set(field, ranges);
      text += defaultText;
    }
  };
  render(parsed.nodes);
  return {
    text,
    fields: [...fieldRanges.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, ranges]) => ({ index, ranges })),
  };
}

function codeMirrorBraceMarkers(values: readonly string[]): {
  readonly openBraceMarker: string;
  readonly closeBraceMarker: string;
} {
  const unavailable = new Set<string>();
  for (const value of values) {
    for (const character of value) {
      unavailable.add(character);
    }
  }
  const markers: string[] = [];
  for (let code = 0xe000; code <= 0xf8ff && markers.length < 2; code += 1) {
    const candidate = String.fromCharCode(code);
    if (!unavailable.has(candidate)) {
      markers.push(candidate);
    }
  }
  const [openBraceMarker, closeBraceMarker] = markers;
  if (openBraceMarker === undefined || closeBraceMarker === undefined) {
    throw new Error("No collision-free CodeMirror snippet brace markers remain.");
  }
  return { openBraceMarker, closeBraceMarker };
}

function parseVsCodeSnippetSequence(
  source: string,
  start: number,
  stopAtBrace: boolean,
  depth: number,
): ParsedVsCodeSnippetSequence | undefined {
  if (depth > 32) {
    return undefined;
  }
  const nodes: ParsedVsCodeSnippetNode[] = [];
  let text = "";
  let index = start;
  const flushText = (): void => {
    if (text.length > 0) {
      nodes.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (index < source.length) {
    const character = source[index];
    if (stopAtBrace && character === "}") {
      flushText();
      return { nodes, next: index + 1 };
    }
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped !== undefined && ["$", "}", "\\", ",", "|"].includes(escaped)) {
        text += escaped;
        index += 2;
      } else {
        text += "\\";
        index += 1;
      }
      continue;
    }
    if (character !== "$") {
      text += character;
      index += 1;
      continue;
    }

    const simple = parseSimpleVsCodeSnippetReference(source, index + 1);
    if (simple !== undefined) {
      flushText();
      nodes.push(simple.node);
      index = simple.next;
      continue;
    }
    if (source[index + 1] !== "{") {
      text += "$";
      index += 1;
      continue;
    }
    const braced = parseBracedVsCodeSnippetReference(
      source,
      index + 2,
      depth + 1,
    );
    if (braced === undefined) {
      return undefined;
    }
    flushText();
    nodes.push(braced.node);
    index = braced.next;
  }
  if (stopAtBrace) {
    return undefined;
  }
  flushText();
  return { nodes, next: index };
}

function parseSimpleVsCodeSnippetReference(
  source: string,
  start: number,
): { readonly node: ParsedVsCodeSnippetNode; readonly next: number } | undefined {
  const field = /^[0-9]+/u.exec(source.slice(start));
  if (field !== null) {
    const index = Number(field[0]);
    return Number.isSafeInteger(index) && index <= 10_000
      ? {
          node: { kind: "field", index, children: undefined, choices: undefined },
          next: start + field[0].length,
        }
      : undefined;
  }
  const variable = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(source.slice(start));
  return variable === null
    ? undefined
    : {
        node: { kind: "variable", name: variable[0], children: undefined },
        next: start + variable[0].length,
      };
}

function parseBracedVsCodeSnippetReference(
  source: string,
  start: number,
  depth: number,
): { readonly node: ParsedVsCodeSnippetNode; readonly next: number } | undefined {
  const identifier = /^(?:[0-9]+|[A-Za-z_][A-Za-z0-9_]*)/u.exec(
    source.slice(start),
  )?.[0];
  if (identifier === undefined) {
    return undefined;
  }
  const numeric = /^[0-9]+$/u.test(identifier);
  const fieldIndex = numeric ? Number(identifier) : undefined;
  if (fieldIndex !== undefined && (!Number.isSafeInteger(fieldIndex) || fieldIndex > 10_000)) {
    return undefined;
  }
  let index = start + identifier.length;
  const separator = source[index];
  if (separator === "}") {
    return {
      node: numeric
        ? { kind: "field", index: fieldIndex!, children: undefined, choices: undefined }
        : { kind: "variable", name: identifier, children: undefined },
      next: index + 1,
    };
  }
  if (separator === "/") {
    return undefined;
  }
  if (separator === "|" && numeric) {
    const choice = parseVsCodeSnippetChoice(source, index + 1);
    return choice === undefined
      ? undefined
      : {
          node: {
            kind: "field",
            index: fieldIndex!,
            children: undefined,
            choices: choice.values,
          },
          next: choice.next,
        };
  }
  if (separator !== ":") {
    return undefined;
  }
  const children = parseVsCodeSnippetSequence(source, index + 1, true, depth);
  if (children === undefined) {
    return undefined;
  }
  return {
    node: numeric
      ? {
          kind: "field",
          index: fieldIndex!,
          children: children.nodes,
          choices: undefined,
        }
      : { kind: "variable", name: identifier, children: children.nodes },
    next: children.next,
  };
}

function parseVsCodeSnippetChoice(
  source: string,
  start: number,
): { readonly values: readonly string[]; readonly next: number } | undefined {
  const values: string[] = [];
  let value = "";
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      const escaped = source[index + 1];
      if (escaped !== undefined && [",", "|", "\\"].includes(escaped)) {
        value += escaped;
        index += 2;
        continue;
      }
      return undefined;
    }
    if (character === ",") {
      values.push(value);
      value = "";
      index += 1;
      continue;
    }
    if (character === "|" && source[index + 1] === "}") {
      values.push(value);
      return { values, next: index + 2 };
    }
    value += character;
    index += 1;
  }
  return undefined;
}

function visitVsCodeSnippetNodes(
  nodes: readonly ParsedVsCodeSnippetNode[],
  visit: (node: ParsedVsCodeSnippetNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    if (node.kind !== "text" && node.children !== undefined) {
      visitVsCodeSnippetNodes(node.children, visit);
    }
  }
}

interface VisualEnvironmentToken {
  readonly kind: "begin" | "end";
  readonly name: string;
  readonly commandFrom: number;
  readonly commandTo: number;
  readonly nameFrom: number;
  readonly nameTo: number;
}

const VISUAL_LIST_ENVIRONMENTS = new Set([
  "itemize",
  "itemize*",
  "compactitem",
  "inparaitem",
  "asparaitem",
  "enumerate",
  "enumerate*",
  "compactenum",
  "inparaenum",
  "asparaenum",
  "description",
  "description*",
  "compactdesc",
  "inparadesc",
  "asparadesc",
]);

interface VisualLineItemCommand {
  readonly itemFrom: number;
  /** End of the visible item marker (`\\item` plus an optional `[label]`). */
  readonly markerTo: number;
  readonly contentFrom: number;
  readonly indentation: string;
}

/**
 * Mirror edits between structurally paired `\begin{...}` and `\end{...}`
 * names. Pairing follows nesting rather than current name equality so a
 * partially edited pair such as `proof` / `pr` remains recoverable.
 */
export function planVisualEnvironmentNameSync(
  source: string,
  changedRanges: readonly VisualEnvironmentChangedRange[],
): readonly VisualEnvironmentSyncChange[] {
  if (changedRanges.length === 0 || source.length === 0) {
    return [];
  }
  const tokens = scanVisualEnvironmentTokens(source);
  const stack: VisualEnvironmentToken[] = [];
  const changes = new Map<string, VisualEnvironmentSyncChange>();
  for (const token of tokens) {
    if (token.kind === "begin") {
      stack.push(token);
      continue;
    }
    const begin = stack.pop();
    if (begin === undefined || begin.name === token.name) {
      continue;
    }
    const beginTouched = changedRanges.some((range) =>
      changedRangeTouchesEnvironmentName(range, begin)
    );
    const endTouched = changedRanges.some((range) =>
      changedRangeTouchesEnvironmentName(range, token)
    );
    if (beginTouched === endTouched) {
      continue;
    }
    const target = beginTouched ? token : begin;
    const insert = beginTouched ? begin.name : token.name;
    if (!/^[A-Za-z0-9@*:_-]{0,128}$/u.test(insert)) {
      continue;
    }
    changes.set(`${target.nameFrom}:${target.nameTo}`, {
      from: target.nameFrom,
      to: target.nameTo,
      insert,
    });
  }
  return [...changes.values()].sort((left, right) => left.from - right.from);
}

function changedRangeTouchesEnvironmentName(
  range: VisualEnvironmentChangedRange,
  token: VisualEnvironmentToken,
): boolean {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.start > range.end
  ) {
    return false;
  }
  return range.start === range.end
    ? range.start >= token.nameFrom && range.start <= token.nameTo
    : range.start <= token.nameTo && range.end >= token.nameFrom;
}

function scanVisualEnvironmentTokens(source: string): readonly VisualEnvironmentToken[] {
  const tokens: VisualEnvironmentToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "%" && !isEscapedAt(source, index)) {
      const newline = source.indexOf("\n", index + 1);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (character !== "\\") {
      index += 1;
      continue;
    }
    let commandEnd = index + 1;
    while (commandEnd < source.length && /[A-Za-z@]/u.test(source[commandEnd] ?? "")) {
      commandEnd += 1;
    }
    const command = source.slice(index + 1, commandEnd);
    if (command === "verb") {
      if (source[commandEnd] === "*") {
        commandEnd += 1;
      }
      const delimiter = source[commandEnd];
      if (delimiter !== undefined && !/\s/u.test(delimiter)) {
        const close = source.indexOf(delimiter, commandEnd + 1);
        index = close < 0 ? source.length : close + 1;
      } else {
        index = commandEnd;
      }
      continue;
    }
    if (command !== "begin" && command !== "end") {
      index = Math.max(index + 1, commandEnd);
      continue;
    }
    let cursor = commandEnd;
    while (cursor < source.length && /[ \t]/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
    if (source[cursor] !== "{") {
      index = commandEnd;
      continue;
    }
    const nameFrom = cursor + 1;
    const close = source.indexOf("}", nameFrom);
    if (
      close < 0 ||
      close - nameFrom > 128 ||
      /[\r\n{}\\]/u.test(source.slice(nameFrom, close))
    ) {
      index = commandEnd;
      continue;
    }
    const token: VisualEnvironmentToken = {
      kind: command,
      name: source.slice(nameFrom, close),
      commandFrom: index,
      commandTo: close + 1,
      nameFrom,
      nameTo: close,
    };
    tokens.push(token);
    index = close + 1;
    if (
      command === "begin" &&
      ["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted"].includes(token.name)
    ) {
      const closing = `\\end{${token.name}}`;
      const closingFrom = source.indexOf(closing, index);
      if (closingFrom >= 0) {
        index = closingFrom;
      }
    }
  }
  return tokens;
}

/**
 * Plan list-aware Enter behavior for the visual editor.
 *
 * Only the innermost active environment may own Enter. This is important for
 * nested lists and for theorem/math environments inside a list: an outer
 * enumerate must never create an item while the caret is editing an inner
 * structure. A second Enter on the empty item produced by the first one
 * removes that item marker in one atomic edit, leaving an ordinary indented
 * line before the closing boundary.
 */
export function planVisualListEnter(
  source: string,
  cursorOffset: number,
  options: { readonly eol?: "\n" | "\r\n" } = {},
): VisualListEnterPlan | undefined {
  if (
    !Number.isSafeInteger(cursorOffset) ||
    cursorOffset < 0 ||
    cursorOffset > source.length
  ) {
    return undefined;
  }
  const context = scanLatexContext(source, cursorOffset);
  if (context.inComment || context.inVerbatim) {
    return undefined;
  }
  const environment = context.environments.at(-1);
  if (environment === undefined || !VISUAL_LIST_ENVIRONMENTS.has(environment)) {
    return undefined;
  }

  const stack: VisualEnvironmentToken[] = [];
  for (const token of scanVisualEnvironmentTokens(source.slice(0, cursorOffset))) {
    if (token.kind === "begin") {
      stack.push(token);
    } else {
      stack.pop();
    }
  }
  const activeList = stack.at(-1);
  if (
    activeList === undefined ||
    activeList.name !== environment ||
    !VISUAL_LIST_ENVIRONMENTS.has(activeList.name)
  ) {
    return undefined;
  }

  const lineStart = source.lastIndexOf("\n", Math.max(0, cursorOffset - 1)) + 1;
  const newline = source.indexOf("\n", cursorOffset);
  const lineEnd = newline < 0
    ? source.length
    : newline > 0 && source[newline - 1] === "\r"
    ? newline - 1
    : newline;
  const lineBeforeCursor = source.slice(lineStart, cursorOffset);
  const item = parseVisualLineItemCommand(source, lineStart, lineEnd);
  const eol = options.eol ?? (source.includes("\r\n") ? "\r\n" : "\n");

  if (item !== undefined && cursorOffset >= item.markerTo) {
    // A collapsed list marker is an atomic visual replacement. Clicking just
    // after `(n)` may therefore resolve to the end of `\\item` (markerTo),
    // before the otherwise invisible trailing spaces (contentFrom). Treat the
    // whole source line as the item body instead of requiring the caret to be
    // beyond those spaces. Without this, each Enter sees a non-empty prefix
    // (`\\item`) and keeps appending another empty item.
    const itemBody = source.slice(item.contentFrom, lineEnd);
    const sameLineClosing = scanVisualEnvironmentTokens(itemBody).find(
      (token) =>
        token.kind === "end" &&
        token.name === activeList.name &&
        /^[ \t]*$/u.test(itemBody.slice(0, token.commandFrom)) &&
        /^[ \t]*$/u.test(itemBody.slice(token.commandTo)),
    );
    if (sameLineClosing !== undefined) {
      // A collapsed visual boundary can map the generated empty item and its
      // hidden `\\end{...}` onto one physical source line. Separate the close
      // command before clearing the marker; otherwise the close command looks
      // like item content and a second Enter may appear to leave the list.
      const beginLineStart = source.lastIndexOf(
        "\n",
        Math.max(0, activeList.commandFrom - 1),
      ) + 1;
      const closingIndentation = source.slice(
        beginLineStart,
        activeList.commandFrom,
      );
      return {
        range: {
          start: item.itemFrom,
          end: item.contentFrom + sameLineClosing.commandFrom,
        },
        insert: `${eol}${closingIndentation}`,
        cursorOffset: item.itemFrom,
        action: "remove-empty-item",
      };
    }
    if (/^[ \t]*$/u.test(itemBody)) {
      // Enter on an empty generated item only removes the item marker. It must
      // not double as an environment-exit gesture: Shift+Enter owns that
      // operation throughout the visual editor. Keeping the indentation and
      // newline also leaves a real editable line before the hidden closing
      // boundary, so the next input cannot overwrite `\\end{...}`.
      return {
        range: { start: item.itemFrom, end: lineEnd },
        insert: "",
        cursorOffset: item.itemFrom,
        action: "remove-empty-item",
      };
    }
  }

  const meaningfulPrefix = lineBeforeCursor.trim();
  if (
    meaningfulPrefix.length === 0 ||
    /^\\(?:begin|end)\s*\{/u.test(meaningfulPrefix)
  ) {
    return undefined;
  }

  const indentation = item?.indentation ?? findVisualListItemIndentation(
    source,
    activeList,
    lineStart,
  );
  const insert = `${eol}${indentation}\\item `;
  return {
    range: { start: cursorOffset, end: cursorOffset },
    insert,
    cursorOffset: cursorOffset + insert.length,
    action: "insert-item",
  };
}

function parseVisualLineItemCommand(
  source: string,
  lineStart: number,
  lineEnd: number,
): VisualLineItemCommand | undefined {
  let cursor = lineStart;
  while (cursor < lineEnd && /[ \t]/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  const itemFrom = cursor;
  if (!source.startsWith("\\item", cursor)) {
    return undefined;
  }
  cursor += "\\item".length;
  if (/[A-Za-z@]/u.test(source[cursor] ?? "")) {
    return undefined;
  }
  let markerTo = cursor;
  while (cursor < lineEnd && /[ \t]/u.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  if (source[cursor] === "[") {
    const optionalEnd = findVisualBalancedSquareEnd(source, cursor, lineEnd);
    if (optionalEnd === undefined) {
      return undefined;
    }
    cursor = optionalEnd;
    markerTo = cursor;
    while (cursor < lineEnd && /[ \t]/u.test(source[cursor] ?? "")) {
      cursor += 1;
    }
  }
  return {
    itemFrom,
    markerTo,
    contentFrom: cursor,
    indentation: source.slice(lineStart, itemFrom),
  };
}

function findVisualBalancedSquareEnd(
  source: string,
  openOffset: number,
  limit: number,
): number | undefined {
  let depth = 0;
  for (let cursor = openOffset; cursor < limit; cursor += 1) {
    const character = source[cursor];
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return cursor + 1;
      }
    }
  }
  return undefined;
}

function findVisualListItemIndentation(
  source: string,
  activeList: VisualEnvironmentToken,
  before: number,
): string {
  const body = source.slice(activeList.commandTo, before);
  const existing = /(?:^|\r?\n)([ \t]*)\\item(?:[^A-Za-z@]|$)/u.exec(body);
  if (existing?.[1] !== undefined) {
    return existing[1];
  }
  const beginLineStart = source.lastIndexOf("\n", activeList.commandFrom - 1) + 1;
  const beginIndentation = source.slice(beginLineStart, activeList.commandFrom);
  return `${beginIndentation}  `;
}

/** Find the smallest scanned math range containing the UTF-16 offset. */
export function innermostLatexMathRegion(
  text: string,
  offset: number,
): LatexMathRegion | undefined {
  return scanLatexRegions(text)
    .filter((region) => offset >= region.innerStart && offset <= region.innerEnd)
    .sort(
      (left, right) =>
        left.innerEnd - left.innerStart - (right.innerEnd - right.innerStart),
    )[0];
}

const VISUAL_ALIGN_TAB_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "alignedat",
  "flalign",
  "flalign*",
  "split",
  "eqnarray",
  "eqnarray*",
]);

interface VisualEnvironmentPair {
  readonly begin: VisualEnvironmentToken;
  readonly end: VisualEnvironmentToken;
}

/**
 * Return structurally paired environments.  A mismatched closing name is
 * paired with the nearest matching opener when possible, so a half-edited
 * nested environment does not make Shift+Enter jump across an outer boundary.
 */
function visualEnvironmentPairs(source: string): readonly VisualEnvironmentPair[] {
  const stack: VisualEnvironmentToken[] = [];
  const pairs: VisualEnvironmentPair[] = [];
  for (const token of scanVisualEnvironmentTokens(source)) {
    if (token.kind === "begin") {
      stack.push(token);
      continue;
    }
    let beginIndex = -1;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]?.name === token.name) {
        beginIndex = index;
        break;
      }
    }
    if (beginIndex < 0) {
      continue;
    }
    const begin = stack[beginIndex];
    if (begin === undefined) {
      continue;
    }
    stack.splice(beginIndex);
    pairs.push({ begin, end: token });
  }
  return pairs;
}

/**
 * Plan visual-editor Up/Down navigation in LaTeX logical-line space.
 *
 * Browser layout rows are deliberately absent from this pure planner: a soft
 * wrapped source line remains one navigation stop. Ordinary targets expose
 * exactly that source line. Entering any line of display math (or the exact
 * inline-math span at the sticky column) exposes the complete formula. A
 * `\\begin{...}` / `\\end{...}` boundary exposes both physical boundary lines
 * of the innermost paired environment so hidden structural source never looks
 * like an editable blank line.
 */
export function planVisualLogicalLineNavigation(
  source: string,
  targetLine: VisualLogicalLineTarget,
  goalColumn: number,
  formulaRanges: readonly VisualLogicalLineFormulaRange[] = [],
): VisualLogicalLineNavigationPlan | undefined {
  if (
    !Number.isSafeInteger(targetLine.from) ||
    !Number.isSafeInteger(targetLine.to) ||
    targetLine.from < 0 ||
    targetLine.to < targetLine.from ||
    targetLine.to > source.length ||
    !Number.isSafeInteger(goalColumn) ||
    goalColumn < 0
  ) {
    return undefined;
  }

  const cursorOffset = Math.min(targetLine.to, targetLine.from + goalColumn);
  const intersectingFormulas = formulaRanges
    .filter(
      (formula) =>
        Number.isSafeInteger(formula.from) &&
        Number.isSafeInteger(formula.to) &&
        formula.from >= 0 &&
        formula.to > formula.from &&
        formula.to <= source.length &&
        visualSourceRangeIntersectsLogicalLine(
          formula.from,
          formula.to,
          targetLine,
        ),
    )
    .sort(
      (left, right) =>
        (left.to - left.from) - (right.to - right.from) ||
        left.from - right.from,
    );
  const formula = intersectingFormulas.find(
    (candidate) =>
      cursorOffset >= candidate.from && cursorOffset < candidate.to,
  ) ?? intersectingFormulas.find((candidate) => candidate.display);
  if (formula !== undefined) {
    return {
      cursorOffset: Math.max(
        Math.max(targetLine.from, formula.from),
        Math.min(cursorOffset, Math.min(targetLine.to, formula.to)),
      ),
      goalColumn,
      reveal: {
        kind: "formula",
        from: formula.from,
        to: formula.to,
      },
    };
  }

  const boundaryPairs = visualEnvironmentPairs(source)
    .filter(({ begin, end }) =>
      (
        begin.commandFrom >= targetLine.from &&
        begin.commandFrom <= targetLine.to
      ) || (
        end.commandFrom >= targetLine.from &&
        end.commandFrom <= targetLine.to
      )
    )
    .sort(
      (left, right) =>
        (left.end.commandTo - left.begin.commandFrom) -
          (right.end.commandTo - right.begin.commandFrom) ||
        right.begin.commandFrom - left.begin.commandFrom,
    );
  const boundary = boundaryPairs[0];
  if (boundary !== undefined) {
    const beginLine = visualPhysicalSourceLineAt(source, boundary.begin.commandFrom);
    const endLine = visualPhysicalSourceLineAt(source, boundary.end.commandFrom);
    return {
      cursorOffset,
      goalColumn,
      reveal: {
        kind: "environment-boundary",
        ranges: [beginLine, endLine],
        scopeFrom: beginLine.from,
        scopeTo: endLine.to,
        environmentName: boundary.begin.name,
      },
    };
  }

  return {
    cursorOffset,
    goalColumn,
    reveal: {
      kind: "line",
      ranges: [targetLine],
      scopeFrom: targetLine.from,
      scopeTo: targetLine.to,
    },
  };
}

/**
 * Source ranges are half-open. In particular, a formula whose `to` offset is
 * exactly the `from` offset of the following logical line does not belong to
 * that line. Treating both ends as inclusive made the first position after an
 * environment (and an adjacent `\\begin{...}` line) reopen the preceding
 * display formula.
 */
function visualSourceRangeIntersectsLogicalLine(
  from: number,
  to: number,
  line: VisualLogicalLineTarget,
): boolean {
  if (line.from === line.to) {
    return from <= line.from && to > line.from;
  }
  return from < line.to && to > line.from;
}

function visualPhysicalSourceLineAt(
  source: string,
  offset: number,
): VisualLogicalLineTarget {
  const safeOffset = Math.max(0, Math.min(source.length, offset));
  const from = source.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
  const newline = source.indexOf("\n", safeOffset);
  let to = newline < 0 ? source.length : newline;
  if (to > from && source[to - 1] === "\r") {
    to -= 1;
  }
  return { from, to };
}

function visualEnvironmentMatchesConfiguredMatrix(
  environmentName: string,
  matrixEnvironments: readonly string[],
): boolean {
  const normalized = environmentName.replace(/\*$/u, "");
  return isMatrixEnvironment(environmentName) ||
    matrixEnvironments.some(
      (candidate) => candidate.replace(/\*$/u, "") === normalized,
    );
}

function visualEnvironmentIsAlignmentTarget(
  environmentName: string,
  matrixEnvironments: readonly string[],
): boolean {
  return VISUAL_ALIGN_TAB_ENVIRONMENTS.has(environmentName) ||
    VISUAL_ALIGN_TAB_ENVIRONMENTS.has(environmentName.replace(/\*$/u, "")) ||
    visualEnvironmentMatchesConfiguredMatrix(environmentName, matrixEnvironments);
}

function innermostVisualEnvironmentPair(
  source: string,
  cursorOffset: number,
): VisualEnvironmentPair | undefined {
  return visualEnvironmentPairs(source)
    .filter(
      ({ begin, end }) =>
        cursorOffset >= begin.commandFrom && cursorOffset <= end.commandTo,
    )
    .sort(
      (left, right) =>
        (left.end.commandTo - left.begin.commandFrom) -
          (right.end.commandTo - right.begin.commandFrom) ||
        right.begin.commandFrom - left.begin.commandFrom,
    )[0];
}

/**
 * Return whether a snippet's next target would cross the closing boundary of
 * the nearest real LaTeX environment or block-math delimiter. Visual mode
 * reserves both transitions for Shift+Enter. Inline math is the sole
 * exception: Tab may still leave `$...$` or `\(...\)` after all inner fields
 * have been traversed.
 */
export function visualTabTargetLeavesEnvironment(
  source: string,
  cursorOffset: number,
  targetOffset: number,
): boolean {
  if (
    !Number.isSafeInteger(cursorOffset) ||
    !Number.isSafeInteger(targetOffset) ||
    cursorOffset < 0 ||
    cursorOffset > source.length ||
    targetOffset < 0 ||
    targetOffset > source.length
  ) {
    return false;
  }
  const pair = innermostVisualEnvironmentPair(source, cursorOffset);
  if (pair !== undefined &&
    pair.begin.name !== "document" &&
    cursorOffset < pair.end.commandFrom &&
    targetOffset >= pair.end.commandFrom) {
    return true;
  }
  const region = innermostLatexMathRegion(source, cursorOffset);
  return region !== undefined &&
    region.mode === "block" &&
    cursorOffset <= region.innerEnd &&
    targetOffset >= region.innerEnd;
}

function visualExitBlankLinePlan(
  source: string,
  closingEnd: number,
  boundaryKind: VisualEnvironmentExitPlan["boundaryKind"],
  environmentName?: string,
): VisualEnvironmentExitPlan {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const closingLineStart = source.lastIndexOf("\n", Math.max(0, closingEnd - 1)) + 1;
  const closingLinePrefix = source.slice(closingLineStart, closingEnd);
  const outerIndent = /^[ \t]*/u.exec(closingLinePrefix)?.[0] ?? "";
  let trailing = closingEnd;
  while (trailing < source.length && /[ \t]/u.test(source[trailing] ?? "")) {
    trailing += 1;
  }

  const lineBreakLength = source.startsWith("\r\n", trailing)
    ? 2
    : source[trailing] === "\n" || source[trailing] === "\r"
      ? 1
      : 0;
  if (lineBreakLength === 0) {
    const sameLineHasContent = trailing < source.length;
    const insert = sameLineHasContent
      ? `${eol}${outerIndent}${eol}`
      : `${eol}${outerIndent}`;
    return {
      range: { start: closingEnd, end: closingEnd },
      insert,
      cursorOffset: closingEnd + eol.length + outerIndent.length,
      boundaryKind,
      ...(environmentName === undefined ? {} : { environmentName }),
    };
  }

  const nextLineStart = trailing + lineBreakLength;
  let nextLineEnd = nextLineStart;
  while (
    nextLineEnd < source.length &&
    source[nextLineEnd] !== "\r" &&
    source[nextLineEnd] !== "\n"
  ) {
    nextLineEnd += 1;
  }
  const nextLine = source.slice(nextLineStart, nextLineEnd);
  if (/^[ \t]*$/u.test(nextLine)) {
    const needsIndentReplacement = nextLine !== outerIndent;
    return {
      range: {
        start: nextLineStart,
        end: needsIndentReplacement ? nextLineEnd : nextLineStart,
      },
      insert: needsIndentReplacement ? outerIndent : "",
      cursorOffset: nextLineStart + outerIndent.length,
      boundaryKind,
      ...(environmentName === undefined ? {} : { environmentName }),
    };
  }
  return {
    range: { start: nextLineStart, end: nextLineStart },
    insert: `${outerIndent}${eol}`,
    cursorOffset: nextLineStart + outerIndent.length,
    boundaryKind,
    ...(environmentName === undefined ? {} : { environmentName }),
  };
}

/**
 * Plan Shift+Enter as an atomic exit to a real blank line after the nearest
 * structural boundary. True environments and display delimiters compete by
 * span, so an inner `\[...\]` exits before its theorem.
 */
export function planVisualEnvironmentExit(
  source: string,
  cursorOffset: number,
  options: { readonly displayOnly?: boolean } = {},
): VisualEnvironmentExitPlan | undefined {
  if (
    !Number.isSafeInteger(cursorOffset) ||
    cursorOffset < 0 ||
    cursorOffset > source.length
  ) {
    return undefined;
  }
  const context = scanLatexContext(source, cursorOffset);
  if (context.inComment || context.inVerbatim) {
    return undefined;
  }

  const candidates: Array<{
    readonly from: number;
    readonly to: number;
    readonly closingEnd: number;
    readonly boundaryKind: VisualEnvironmentExitPlan["boundaryKind"];
    readonly environmentName?: string;
  }> = [];
  if (options.displayOnly !== true) {
    for (const pair of visualEnvironmentPairs(source)) {
      if (
        pair.begin.name !== "document" &&
        cursorOffset >= pair.begin.commandFrom &&
        cursorOffset <= pair.end.commandTo
      ) {
        candidates.push({
          from: pair.begin.commandFrom,
          to: pair.end.commandTo,
          closingEnd: pair.end.commandTo,
          boundaryKind: "environment",
          environmentName: pair.begin.name,
        });
      }
    }
  }
  for (const region of scanLatexRegions(source)) {
    if (
      region.environmentName !== undefined ||
      region.mode !== "block" ||
      !region.closed ||
      cursorOffset < region.outerStart ||
      cursorOffset > region.outerEnd
    ) {
      continue;
    }
    const opener = source.slice(region.outerStart, region.innerStart);
    if (opener !== "\\[" && opener !== "$$") {
      continue;
    }
    candidates.push({
      from: region.outerStart,
      to: region.outerEnd,
      closingEnd: region.outerEnd,
      boundaryKind: opener === "\\[" ? "display-bracket" : "display-dollar",
    });
  }
  const candidate = candidates.sort(
    (left, right) =>
      (left.to - left.from) - (right.to - right.from) || right.from - left.from,
  )[0];
  return candidate === undefined
    ? undefined
    : visualExitBlankLinePlan(
        source,
        candidate.closingEnd,
        candidate.boundaryKind,
        candidate.environmentName,
      );
}

interface VisualAlignmentSeparator {
  readonly kind: "cell" | "row";
  readonly from: number;
  readonly to: number;
}

/**
 * Plan the deliberately simple visual-editor Tab rule for align/matrix-like
 * environments. Only the innermost environment owns Tab. If a bracket is
 * still open at the caret, that bracket must be traversed first; otherwise one
 * normalized alignment marker is inserted exactly at the caret. Environment
 * exit is never a Tab action here.
 */
export function planVisualAlignTab(
  text: string,
  cursorOffset: number,
  direction: -1 | 1 = 1,
  matrixEnvironments: readonly string[] = [],
): VisualAlignTabPlan | undefined {
  if (
    direction < 0 ||
    cursorOffset < 0 ||
    cursorOffset > text.length
  ) {
    return undefined;
  }
  const context = scanLatexContext(text, cursorOffset);
  if (context.inComment || context.inVerbatim) {
    return undefined;
  }
  const pair = innermostVisualEnvironmentPair(text, cursorOffset);
  if (
    pair === undefined ||
    !visualEnvironmentIsAlignmentTarget(pair.begin.name, matrixEnvironments) ||
    cursorOffset < pair.begin.commandTo ||
    cursorOffset > pair.end.commandFrom
  ) {
    return undefined;
  }
  if (planTabout(text, cursorOffset, {
    innerStart: pair.begin.commandTo,
    innerEnd: pair.end.commandFrom,
    outerEnd: pair.end.commandTo,
    arrayMode: true,
  }) !== undefined) {
    return undefined;
  }
  const insertion = visualAlignmentInsertionAt(
    text,
    cursorOffset,
    pair.begin.commandTo,
    pair.end.commandFrom,
  );
  return {
    range: { start: cursorOffset, end: cursorOffset },
    insert: insertion,
    cursorOffset: cursorOffset + insertion.length,
    action: "insert-alignment",
  };
}

function visualAlignmentInsertionAt(
  text: string,
  cursorOffset: number,
  rowStart: number,
  rowEnd: number,
): string {
  const hasLeftWhitespace = cursorOffset <= rowStart ||
    /[ \t]/u.test(text[cursorOffset - 1] ?? "");
  const hasRightWhitespace = cursorOffset >= rowEnd ||
    /[ \t]/u.test(text[cursorOffset] ?? "");
  return `${hasLeftWhitespace ? "" : " "}&${hasRightWhitespace ? "" : " "}`;
}

function visualAlignmentContentStart(
  text: string,
  region: LatexMathRegion,
): number {
  if (
    region.environmentName !== "alignat" &&
    region.environmentName !== "alignat*" &&
    region.environmentName !== "alignedat"
  ) {
    return region.innerStart;
  }
  let cursor = skipVisualAlignmentWhitespace(text, region.innerStart, region.innerEnd);
  if (text[cursor] !== "{") {
    return region.innerStart;
  }
  let depth = 1;
  cursor += 1;
  while (cursor < region.innerEnd && depth > 0) {
    if (text[cursor] === "{" && !isEscapedAt(text, cursor)) {
      depth += 1;
    } else if (text[cursor] === "}" && !isEscapedAt(text, cursor)) {
      depth -= 1;
    }
    cursor += 1;
  }
  return depth === 0 ? cursor : region.innerStart;
}

function skipVisualAlignmentWhitespace(
  text: string,
  from: number,
  to: number,
): number {
  let cursor = from;
  while (cursor < to && /\s/u.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function scanVisualAlignmentSeparators(
  text: string,
  from: number,
  to: number,
): readonly VisualAlignmentSeparator[] {
  const separators: VisualAlignmentSeparator[] = [];
  let braceDepth = 0;
  let nestedEnvironmentDepth = 0;
  for (let index = from; index < to; index += 1) {
    const character = text[index];
    if (character === "%" && !isEscapedAt(text, index)) {
      const newline = text.indexOf("\n", index + 1);
      index = newline < 0 || newline >= to ? to : newline;
      continue;
    }
    if (character === "\\" && !isEscapedAt(text, index)) {
      if (braceDepth === 0) {
        const environment = parseVisualAlignmentEnvironmentCommand(text, index, to);
        if (environment !== undefined) {
          if (environment.kind === "begin") {
            nestedEnvironmentDepth += 1;
          } else if (nestedEnvironmentDepth > 0) {
            nestedEnvironmentDepth -= 1;
          }
          index = environment.to - 1;
          continue;
        }
      }
      if (braceDepth === 0 && nestedEnvironmentDepth === 0) {
        const rowEnd = visualAlignmentRowCommandEnd(text, index, to);
        if (rowEnd !== undefined) {
          separators.push({ kind: "row", from: index, to: rowEnd });
          index = rowEnd - 1;
          continue;
        }
      }
    }
    if (nestedEnvironmentDepth > 0) {
      continue;
    }
    if (character === "{" && !isEscapedAt(text, index)) {
      braceDepth += 1;
      continue;
    }
    if (character === "}" && !isEscapedAt(text, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (
      character === "&" &&
      braceDepth === 0 &&
      !isEscapedAt(text, index)
    ) {
      separators.push({ kind: "cell", from: index, to: index + 1 });
    }
  }
  return separators;
}

function parseVisualAlignmentEnvironmentCommand(
  text: string,
  from: number,
  to: number,
): { readonly kind: "begin" | "end"; readonly to: number } | undefined {
  const match = /^\\(begin|end)\s*\{[^{}]+\}/u.exec(text.slice(from, to));
  if (match === null) {
    return undefined;
  }
  return {
    kind: match[1] === "begin" ? "begin" : "end",
    to: from + match[0].length,
  };
}

function visualAlignmentRowCommandEnd(
  text: string,
  from: number,
  to: number,
): number | undefined {
  if (text.startsWith("\\\\", from)) {
    let cursor = from + 2;
    if (text[cursor] === "*") {
      cursor += 1;
    }
    while (cursor < to && /[ \t]/u.test(text[cursor] ?? "")) {
      cursor += 1;
    }
    if (text[cursor] === "[") {
      let depth = 1;
      cursor += 1;
      while (cursor < to && depth > 0) {
        if (text[cursor] === "[" && !isEscapedAt(text, cursor)) {
          depth += 1;
        } else if (text[cursor] === "]" && !isEscapedAt(text, cursor)) {
          depth -= 1;
        }
        cursor += 1;
      }
    }
    return cursor;
  }
  const command = /^\\(?:crcr|cr|tabularnewline)(?![A-Za-z@])/u.exec(
    text.slice(from, to),
  );
  return command === null ? undefined : from + command[0].length;
}

/**
 * Return whether a visual-editor document change can legitimately trigger an
 * automatic snippet.
 *
 * Automatic snippets are post-input transforms: they may inspect the text
 * immediately before the caret only when this transaction actually inserted
 * text there.  Running the matcher after a deletion is incorrect because a
 * pre-existing trigger can become adjacent to the caret again.  For example,
 * deleting `x` from `(x)` leaves the caret after `(`; treating that deletion as
 * fresh input would expand the parenthesis snippet a second time and produce
 * `())`.
 */
export function shouldRunVisualAutomaticSnippet(
  changes: readonly {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
  }[],
  cursorOffset: number,
): boolean {
  if (changes.length !== 1) {
    return false;
  }
  const change = changes[0];
  return change !== undefined &&
    change.insert.length > 0 &&
    !/[\r\n]/u.test(change.insert) &&
    cursorOffset === change.from + change.insert.length;
}

/** Pure equivalent of the source editor's post-input automatic fraction plan. */
export function planVisualAutoFraction(
  text: string,
  cursorOffset: number,
  insertedText: string,
  options: VisualAutoFractionOptions,
): VisualSnippetPlan | undefined {
  if (
    cursorOffset < 0 ||
    cursorOffset > text.length ||
    !isFractionDenominatorSeed(insertedText, options.breakingCharacters)
  ) {
    return undefined;
  }

  let denominatorStart = cursorOffset;
  while (denominatorStart > 0) {
    const character = text[denominatorStart - 1];
    if (
      character === undefined ||
      !isFractionDenominatorSeed(character, options.breakingCharacters)
    ) {
      break;
    }
    denominatorStart -= 1;
  }

  const slashOffset = denominatorStart - 1;
  if (
    slashOffset < 0 ||
    denominatorStart === cursorOffset ||
    text[slashOffset] !== "/" ||
    text[slashOffset - 1] === "/" ||
    isEscapedAt(text, slashOffset)
  ) {
    return undefined;
  }

  const region = innermostLatexMathRegion(text, slashOffset);
  const numerator = findFractionNumerator(text, slashOffset, {
    lowerBound: region?.innerStart ?? 0,
    breakingCharacters: options.breakingCharacters,
  });
  if (numerator === undefined || numerator.numerator.length === 0) {
    return undefined;
  }

  const denominator = text.slice(denominatorStart, cursorOffset);
  return {
    range: {
      start: numerator.replacementRange.start,
      end: cursorOffset,
    },
    parts: [
      {
        kind: "text",
        value: `${options.command}{${numerator.numerator}}{${denominator}`,
      },
      { kind: "tabstop", index: 0 },
      { kind: "text", value: "}" },
      { kind: "tabstop", index: 1 },
    ],
  };
}

/** Build the source editor's selection-as-numerator fraction replacement. */
export function planVisualSelectionFraction(
  selectedText: string,
  range: OffsetRange,
  command: string,
): VisualSnippetPlan | undefined {
  const numerator = stripCompleteOuterParentheses(selectedText);
  if (numerator.length === 0) {
    return undefined;
  }
  return {
    range,
    parts: [
      { kind: "text", value: `${command}{${numerator}}{` },
      { kind: "tabstop", index: 0 },
      { kind: "text", value: "}" },
      { kind: "tabstop", index: 1 },
    ],
  };
}

/** Return the complete empty math delimiter pair around a collapsed cursor. */
export function emptyMathDelimiterOffsets(
  text: string,
  cursorOffset: number,
): OffsetRange | undefined {
  if (cursorOffset < 0 || cursorOffset > text.length) {
    return undefined;
  }
  const pairs = [
    ["\\(", "\\)"],
    ["\\[", "\\]"],
    ["$$", "$$"],
    ["$", "$"],
  ] as const;
  for (const [left, right] of pairs) {
    if (
      text.slice(cursorOffset - left.length, cursorOffset) === left &&
      text.slice(cursorOffset, cursorOffset + right.length) === right
    ) {
      return {
        start: cursorOffset - left.length,
        end: cursorOffset + right.length,
      };
    }
  }
  return undefined;
}

export function isConfiguredMatrixContext(
  context: LatexContext,
  matrixEnvironments: readonly string[],
): boolean {
  if (context.mathMode === "text" || context.inTextCommandArgument) {
    return false;
  }
  return context.environments.some(
    (environment) =>
      matrixEnvironments.includes(environment) ||
      matrixEnvironments.includes(environment.replace(/\*$/u, "")),
  );
}

export function isExcludedLatexContext(
  context: LatexContext,
  excludedEnvironments: readonly string[],
): boolean {
  return context.inComment || context.inVerbatim ||
    context.environments.some((environment) =>
      excludedEnvironments.includes(environment)
    );
}

function isFractionDenominatorSeed(
  value: string,
  breakingCharacters: string,
): boolean {
  return [...value].length === 1 &&
    !/\s/u.test(value) &&
    value !== "/" &&
    !")]}$".includes(value) &&
    !breakingCharacters.includes(value);
}

function isEscapedAt(text: string, offset: number): boolean {
  let backslashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && text[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function stripCompleteOuterParentheses(value: string): string {
  if (!value.startsWith("(") || !value.endsWith(")")) {
    return value;
  }
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") {
      depth += 1;
    } else if (value[index] === ")") {
      depth -= 1;
      if (depth === 0 && index !== value.length - 1) {
        return value;
      }
    }
  }
  return depth === 0 ? value.slice(1, -1) : value;
}
