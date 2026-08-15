/**
 * Core data types for Snippet Leaf.
 *
 * This module deliberately has no dependency on the VS Code API. Offsets are
 * UTF-16 string offsets, matching JavaScript strings and VS Code positions.
 */

export type SnippetSyntaxVersion = 1 | 2;

export type SnippetActivation = 'auto' | 'manual' | 'completion' | 'visual';

export type LatexMathMode = 'text' | 'inline' | 'block';

export interface LatexEnvironmentFrame {
  readonly name: string;
  readonly startOffset: number;
}

export interface LatexDelimiterFrame {
  readonly kind: 'dollar-inline' | 'dollar-block' | 'paren' | 'bracket';
  readonly startOffset: number;
}

/** Serializable state that can be cached at line boundaries by an adapter. */
export interface LatexScanState {
  readonly environments: readonly LatexEnvironmentFrame[];
  readonly delimiter: LatexDelimiterFrame | undefined;
  readonly inComment: boolean;
  readonly verbatimDelimiter: string | undefined;
  readonly verbatimEnvironment: string | undefined;
}

export interface LatexContext {
  readonly mathMode: LatexMathMode;
  readonly inComment: boolean;
  readonly inVerbatim: boolean;
  readonly environments: readonly string[];
  readonly matrixEnvironment: string | undefined;
}

/**
 * A math region discovered by a full-document scan. All offsets are UTF-16
 * offsets and all end offsets are exclusive. For an unclosed region,
 * `innerEnd` and `outerEnd` both point at the end of the supplied text.
 */
export interface LatexMathRegion {
  /** Start of the opening delimiter or `\\begin{...}` command. */
  readonly outerStart: number;
  /** First character after the opening syntax. */
  readonly innerStart: number;
  /** Start of the closing syntax, or EOF when unclosed. */
  readonly innerEnd: number;
  /** First character after the closing syntax, or EOF when unclosed. */
  readonly outerEnd: number;
  readonly mode: Exclude<LatexMathMode, 'text'>;
  readonly environmentName?: string;
  readonly closed: boolean;
}

export interface RegexTriggerDescriptor {
  readonly kind: 'regex';
  readonly source: string;
  readonly flags?: string | undefined;
}

export type SnippetTriggerInput = string | RegExp | RegexTriggerDescriptor;

export interface SnippetDefinitionInput {
  readonly id?: string | undefined;
  readonly trigger: SnippetTriggerInput;
  readonly replacement: string;
  readonly options?: string | undefined;
  readonly priority?: number | undefined;
  readonly description?: string | undefined;
  readonly flags?: string | undefined;
  readonly version?: SnippetSyntaxVersion | undefined;
  readonly disabled?: boolean | undefined;
}

/** Short compatibility name used by adapters and importers. */
export type RawSnippet = SnippetDefinitionInput;

export interface SnippetFileInput {
  readonly schemaVersion?: number | undefined;
  readonly variables?: Readonly<Record<string, string>> | undefined;
  readonly snippets: readonly SnippetDefinitionInput[];
}

export interface ParsedSnippetOptions {
  readonly raw: string;
  readonly automatic: boolean;
  readonly regex: boolean;
  readonly visual: boolean;
  readonly wordBoundary: boolean;
  readonly textMode: boolean;
  readonly anyMathMode: boolean;
  readonly blockMathMode: boolean;
  readonly inlineMathMode: boolean;
}

export interface ValidatedSnippetDefinition {
  readonly id: string;
  readonly trigger: string | RegexTriggerDescriptor;
  readonly replacement: string;
  readonly options: ParsedSnippetOptions;
  readonly priority: number;
  readonly description?: string | undefined;
  readonly version: SnippetSyntaxVersion;
  readonly disabled: boolean;
  readonly order: number;
}

export interface ValidatedSnippetFile {
  readonly schemaVersion: 1;
  readonly variables: Readonly<Record<string, string>>;
  readonly snippets: readonly ValidatedSnippetDefinition[];
}

export type ValidationIssueCode =
  | 'invalid-type'
  | 'missing-property'
  | 'invalid-schema-version'
  | 'invalid-option'
  | 'conflicting-options'
  | 'invalid-regex-flag'
  | 'invalid-regex'
  | 'empty-trigger'
  | 'empty-regex-match'
  | 'duplicate-id'
  | 'unsupported-function';

export interface ValidationIssue {
  readonly path: string;
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export interface ValidationResult<T> {
  /** True when no validation issue was produced. */
  readonly ok: boolean;
  /** Best-effort value. Invalid snippet entries are omitted. */
  readonly value: T;
  readonly issues: readonly ValidationIssue[];
}

export interface CompiledSnippet extends ValidatedSnippetDefinition {
  readonly triggerKind: 'literal' | 'regex';
  /** Trigger after snippet-variable expansion. */
  readonly triggerSource: string;
  /** Absolute-end-anchored regular expression for regex snippets. */
  readonly triggerRegex?: RegExp | undefined;
  readonly template: readonly ReplacementTemplatePart[];
}

export type CompileResult = ValidationResult<readonly CompiledSnippet[]>;

export interface SnippetMatcherOptions {
  /** Maximum suffix supplied to each regex. Defaults to 4096 UTF-16 units. */
  readonly maxRegexInputLength?: number | undefined;
  /** Characters accepted on either side of a snippet carrying option `w`. */
  readonly wordDelimiters?: string | undefined;
}

export interface SnippetMatchRequest {
  /** Text ending exactly at the cursor. */
  readonly textBefore: string;
  /** Text immediately following the cursor, used for word-boundary checks. */
  readonly textAfter?: string | undefined;
  readonly context: LatexContext;
  readonly activation?: SnippetActivation | undefined;
  /** Previous selection for visual snippets. */
  readonly visualText?: string | undefined;
}

export interface SnippetMatch {
  readonly snippet: CompiledSnippet;
  /** UTF-16 offsets within textBefore. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly matchedText: string;
  /** Capturing groups, excluding RegExpExecArray[0]. */
  readonly captures: readonly (string | undefined)[];
  readonly namedCaptures: Readonly<Record<string, string | undefined>>;
  readonly replacement: readonly ReplacementPart[];
}

export interface TextTemplatePart {
  readonly kind: 'text';
  readonly value: string;
}

export interface TabstopTemplatePart {
  readonly kind: 'tabstop';
  /** Original Snippet Leaf index. Index zero is the first stop, not final. */
  readonly index: number;
  readonly placeholder?: string | undefined;
}

export interface CaptureTemplatePart {
  readonly kind: 'capture';
  readonly reference: number | string;
  readonly raw: string;
  readonly version: SnippetSyntaxVersion;
}

export interface VisualTemplatePart {
  readonly kind: 'visual';
  readonly raw: string;
}

export type ReplacementTemplatePart =
  | TextTemplatePart
  | TabstopTemplatePart
  | CaptureTemplatePart
  | VisualTemplatePart;

export interface TextReplacementPart {
  readonly kind: 'text';
  readonly value: string;
}

export interface TabstopReplacementPart {
  readonly kind: 'tabstop';
  /** Original Snippet Leaf index. The VS Code adapter must remap 0 -> 1. */
  readonly index: number;
  readonly placeholder?: string | undefined;
}

export type ReplacementPart = TextReplacementPart | TabstopReplacementPart;

export interface VsCodeTabstopMapping {
  /** Parts whose highest explicit index is mapped to VS Code's final `$0`. */
  readonly parts: readonly ReplacementPart[];
}

export interface ReplacementContext {
  readonly captures?: readonly (string | undefined)[] | undefined;
  readonly namedCaptures?: Readonly<Record<string, string | undefined>> | undefined;
  readonly visualText?: string | undefined;
}

export interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

export interface FractionNumeratorPlan {
  readonly numeratorRange: OffsetRange;
  readonly numerator: string;
  /** Range including the slash that triggered the transformation. */
  readonly replacementRange: OffsetRange;
}

export interface FractionNumeratorOptions {
  /** Do not inspect text before this UTF-16 offset (normally math innerStart). */
  readonly lowerBound?: number;
  /** Extra top-level boundary characters. Defaults to `+-=,;:&` and tab. */
  readonly breakingCharacters?: string;
  /** Strip one complete pair of outer parentheses, matching upstream behavior. */
  readonly stripOuterParentheses?: boolean;
}

export interface TaboutPlan {
  readonly kind: 'closing-delimiter' | 'math-delimiter';
  readonly from: number;
  readonly to: number;
  readonly skippedText: string;
}

export interface TaboutOptions {
  /** Explicit math-content end. Inferred from scanLatexRegions when omitted. */
  readonly innerEnd?: number;
  /** Explicit end after closing math syntax. */
  readonly outerEnd?: number;
  /** Matrix/array contexts do not tab out through the math boundary. */
  readonly arrayMode?: boolean;
}

export type EnlargeOpenBracket =
  | '('
  | '['
  | '\\{'
  | '|'
  | '\\langle'
  | '\\lvert'
  | '\\lVert'
  | '\\lceil'
  | '\\lfloor';

export type EnlargeCloseBracket =
  | ')'
  | ']'
  | '\\}'
  | '|'
  | '\\rangle'
  | '\\rvert'
  | '\\rVert'
  | '\\rceil'
  | '\\rfloor';

export interface EnlargeBracketPlan {
  readonly openOffset: number;
  readonly closeOffset: number;
  readonly open: EnlargeOpenBracket;
  readonly close: EnlargeCloseBracket;
  readonly insertLeftAt: number;
  readonly insertRightAt: number;
  readonly insertLeftText: '\\left';
  readonly insertRightText: '\\right';
}

export interface AutoEnlargeOptions {
  /** Commands that make an enclosing pair eligible for enlargement. */
  readonly triggers?: readonly string[];
  /** Optional scan bounds, normally the current math region's inner bounds. */
  readonly bounds?: OffsetRange;
}
