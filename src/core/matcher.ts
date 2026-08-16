import {
  CompileResult,
  CompiledSnippet,
  LatexContext,
  ParsedSnippetOptions,
  SnippetMatch,
  SnippetMatchRequest,
  SnippetMatcherOptions,
  ValidatedSnippetFile,
  ValidationIssue,
} from './types';
import { materializeReplacement, parseReplacementTemplate } from './replacement';

const VARIABLE_PATTERN = /\$\{([A-Za-z$_][A-Za-z$_0-9]*)\}/g;
const DEFAULT_WORD_DELIMITERS = '., +-\n\t:;!?\\/{}[]()=~$';

export function expandSnippetVariables(
  source: string,
  variables: Readonly<Record<string, string>>,
): string {
  return source.replace(VARIABLE_PATTERN, (raw, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? (variables[name] ?? raw) : raw,
  );
}

function triggerLength(snippet: CompiledSnippet): number {
  return snippet.triggerKind === 'literal' ? snippet.triggerSource.length : 0;
}

function compareSnippets(left: CompiledSnippet, right: CompiledSnippet): number {
  return (
    right.priority - left.priority ||
    triggerLength(right) - triggerLength(left) ||
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
}

export function compileSnippetFile(file: ValidatedSnippetFile): CompileResult {
  const issues: ValidationIssue[] = [];
  const snippets: CompiledSnippet[] = [];

  for (const definition of file.snippets) {
    const rawSource =
      typeof definition.trigger === 'string'
        ? definition.trigger
        : definition.trigger.source;
    const triggerSource = expandSnippetVariables(rawSource, file.variables);
    if (triggerSource.length === 0) {
      issues.push({
        path: `snippets.${definition.id}.trigger`,
        code: 'empty-trigger',
        message: 'trigger became empty after snippet-variable expansion',
      });
      continue;
    }

    const triggerKind =
      typeof definition.trigger === 'object' || definition.options.regex ? 'regex' : 'literal';
    let triggerRegex: RegExp | undefined;
    if (triggerKind === 'regex') {
      const flags = typeof definition.trigger === 'object' ? (definition.trigger.flags ?? '') : '';
      try {
        triggerRegex = new RegExp(`(?:${triggerSource})(?![\\s\\S])`, flags);
        if (triggerRegex.test('')) {
          issues.push({
            path: `snippets.${definition.id}.trigger`,
            code: 'empty-regex-match',
            message: 'regex trigger matches an empty string',
          });
          continue;
        }
      } catch (error) {
        issues.push({
          path: `snippets.${definition.id}.trigger`,
          code: 'invalid-regex',
          message: `invalid compiled regular expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        continue;
      }
    }

    snippets.push({
      ...definition,
      triggerKind,
      triggerSource,
      triggerRegex,
      template: parseReplacementTemplate(definition.replacement, definition.version),
    });
  }

  snippets.sort(compareSnippets);
  return { ok: issues.length === 0, value: snippets, issues };
}

function matchesMode(options: ParsedSnippetOptions, context: LatexContext): boolean {
  const hasMode =
    options.textMode ||
    options.anyMathMode ||
    options.blockMathMode ||
    options.inlineMathMode;
  if (!hasMode) {
    return true;
  }
  return (
    (options.textMode && context.mathMode === 'text') ||
    (options.anyMathMode && context.mathMode !== 'text') ||
    (options.blockMathMode && context.mathMode === 'block') ||
    (options.inlineMathMode && context.mathMode === 'inline')
  );
}

function matchesActivation(snippet: CompiledSnippet, request: SnippetMatchRequest): boolean {
  const activation = request.activation ?? 'manual';
  if (activation === 'auto') {
    return snippet.options.automatic && !snippet.options.visual;
  }
  if (activation === 'visual') {
    return snippet.options.visual;
  }
  if (snippet.options.visual) {
    return request.visualText !== undefined && request.visualText.length > 0;
  }
  return true;
}

function hasRequiredWordBoundary(
  snippet: CompiledSnippet,
  request: SnippetMatchRequest,
  startOffset: number,
  wordDelimiters: string,
): boolean {
  if (!snippet.options.wordBoundary) {
    return true;
  }
  const before = startOffset > 0 ? request.textBefore[startOffset - 1] : undefined;
  const after = request.textAfter?.[0];
  return (
    (before === undefined || wordDelimiters.includes(before)) &&
    (after === undefined || wordDelimiters.includes(after))
  );
}

interface TriggerMatch {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly matchedText: string;
  readonly captures: readonly (string | undefined)[];
  readonly namedCaptures: Readonly<Record<string, string | undefined>>;
}

function matchLiteral(snippet: CompiledSnippet, textBefore: string): TriggerMatch | undefined {
  if (!textBefore.endsWith(snippet.triggerSource)) {
    return undefined;
  }
  const startOffset = textBefore.length - snippet.triggerSource.length;
  return {
    startOffset,
    endOffset: textBefore.length,
    matchedText: snippet.triggerSource,
    captures: [],
    namedCaptures: {},
  };
}

function matchRegex(
  snippet: CompiledSnippet,
  textBefore: string,
  maxRegexInputLength: number,
): TriggerMatch | undefined {
  const regex = snippet.triggerRegex;
  if (regex === undefined) {
    return undefined;
  }
  const suffixStart = Math.max(0, textBefore.length - maxRegexInputLength);
  const suffix = textBefore.slice(suffixStart);
  const match = regex.exec(suffix);
  if (match === null || match[0].length === 0 || match.index + match[0].length !== suffix.length) {
    return undefined;
  }
  return {
    startOffset: suffixStart + match.index,
    endOffset: textBefore.length,
    matchedText: match[0],
    captures: Array.from(match).slice(1),
    namedCaptures: match.groups === undefined ? {} : { ...match.groups },
  };
}

export class SnippetMatcher {
  private readonly snippets: readonly CompiledSnippet[];
  private readonly literalsByLastCharacter = new Map<string, readonly CompiledSnippet[]>();
  private readonly regexSnippets: readonly CompiledSnippet[];
  private readonly maxRegexInputLength: number;
  private readonly wordDelimiters: string;

  public constructor(
    snippets: readonly CompiledSnippet[],
    options: SnippetMatcherOptions = {},
  ) {
    this.snippets = [...snippets].sort(compareSnippets);
    this.maxRegexInputLength = Math.max(1, options.maxRegexInputLength ?? 4096);
    this.wordDelimiters = options.wordDelimiters ?? DEFAULT_WORD_DELIMITERS;

    const literalBuckets = new Map<string, CompiledSnippet[]>();
    const regexSnippets: CompiledSnippet[] = [];
    for (const snippet of this.snippets) {
      if (snippet.triggerKind === 'regex') {
        regexSnippets.push(snippet);
        continue;
      }
      const finalCharacter = snippet.triggerSource.slice(-1);
      const bucket = literalBuckets.get(finalCharacter) ?? [];
      bucket.push(snippet);
      literalBuckets.set(finalCharacter, bucket);
    }
    for (const [character, bucket] of literalBuckets) {
      this.literalsByLastCharacter.set(character, bucket.sort(compareSnippets));
    }
    this.regexSnippets = regexSnippets.sort(compareSnippets);
  }

  public findAll(request: SnippetMatchRequest): readonly SnippetMatch[] {
    if (
      request.context.inComment ||
      request.context.inVerbatim ||
      request.context.inSnippetSuppressedArgument
    ) {
      return [];
    }

    const finalCharacter = request.textBefore.slice(-1);
    const literalCandidates = this.literalsByLastCharacter.get(finalCharacter) ?? [];
    const candidates = [...literalCandidates, ...this.regexSnippets].sort(compareSnippets);
    const matches: SnippetMatch[] = [];

    for (const snippet of candidates) {
      if (
        snippet.disabled ||
        !matchesMode(snippet.options, request.context) ||
        !matchesActivation(snippet, request)
      ) {
        continue;
      }

      const triggerMatch =
        snippet.triggerKind === 'literal'
          ? matchLiteral(snippet, request.textBefore)
          : matchRegex(snippet, request.textBefore, this.maxRegexInputLength);
      if (
        triggerMatch === undefined ||
        !hasRequiredWordBoundary(snippet, request, triggerMatch.startOffset, this.wordDelimiters)
      ) {
        continue;
      }

      matches.push({
        snippet,
        ...triggerMatch,
        replacement: materializeReplacement(snippet.template, {
          captures: triggerMatch.captures,
          namedCaptures: triggerMatch.namedCaptures,
          visualText: request.visualText,
        }),
      });
    }
    return matches;
  }

  public match(request: SnippetMatchRequest): SnippetMatch | undefined {
    return this.findAll(request)[0];
  }

  public get compiledSnippets(): readonly CompiledSnippet[] {
    return this.snippets;
  }
}
