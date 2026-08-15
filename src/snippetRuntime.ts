import * as vscode from "vscode";
import {
  compileSnippetFile,
  createLatexScanState,
  latexContextFromState,
  materializeReplacement,
  remapTabstopsForVsCode,
  scanLatexSegment,
  SnippetMatcher,
  validateSnippetFile,
  type CompiledSnippet,
  type LatexContext,
  type LatexScanState,
  type ReplacementPart,
  type SnippetActivation,
  type SnippetMatch,
  type ValidationIssue,
} from "./core";
import { readConfig, type TeXLeafConfig } from "./config";
import {
  SnippetRepository,
  type SnippetLibrarySnapshot,
  type SnippetRecord,
} from "./snippetRepository";

export interface RuntimeMatch {
  readonly match: SnippetMatch;
  readonly range: vscode.Range;
  readonly context: LatexContext;
}

interface DocumentCacheEntry {
  version: number;
  /** states[i] is the state at the beginning of line i. */
  states: LatexScanState[];
}

interface ResourceRuntimeState {
  readonly revision: number;
  readonly maxLookbehind: number;
  readonly wordDelimiters: string;
  readonly matcher: SnippetMatcher;
  readonly compiled: readonly CompiledSnippet[];
  readonly recordById: ReadonlyMap<string, SnippetRecord>;
  readonly issues: readonly ValidationIssue[];
}

export class SnippetRuntime implements vscode.Disposable {
  private readonly resourceStates = new Map<string, ResourceRuntimeState>();
  private readonly documentCache = new Map<string, DocumentCacheEntry>();
  private readonly repositorySubscription: vscode.Disposable;
  private readonly issueEmitter = new vscode.EventEmitter<readonly ValidationIssue[]>();
  private issues: readonly ValidationIssue[] = [];

  public readonly onDidChangeIssues = this.issueEmitter.event;

  public constructor(private readonly repository: SnippetRepository) {
    this.repositorySubscription = repository.onDidChange(() => {
      this.resourceStates.clear();
      const document = vscode.window.activeTextEditor?.document;
      if (document === undefined) {
        this.updateIssues([]);
      } else {
        this.stateFor(document.uri, readConfig(document.uri));
      }
    });
  }

  public get validationIssues(): readonly ValidationIssue[] {
    return this.issues;
  }

  public get compiledSnippets(): readonly CompiledSnippet[] {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return this.stateFor(uri, readConfig(uri)).compiled;
  }

  public get records(): ReadonlyMap<string, SnippetRecord> {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return this.stateFor(uri, readConfig(uri)).recordById;
  }

  public configure(config: TeXLeafConfig): void {
    const uri = vscode.window.activeTextEditor?.document.uri;
    this.stateFor(uri, config);
  }

  public compiledSnippetsFor(
    resource: vscode.TextDocument | vscode.Uri,
    config: TeXLeafConfig,
  ): readonly CompiledSnippet[] {
    return this.stateFor(resourceUri(resource), config).compiled;
  }

  public handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const key = event.document.uri.toString();
    const cache = this.documentCache.get(key);
    if (cache === undefined) {
      return;
    }
    const earliestLine = event.contentChanges.reduce(
      (line, change) => Math.min(line, change.range.start.line),
      Number.POSITIVE_INFINITY,
    );
    cache.version = event.document.version;
    if (Number.isFinite(earliestLine)) {
      cache.states.length = Math.max(1, earliestLine + 1);
    } else {
      cache.states.length = 1;
    }
  }

  public forgetDocument(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    this.documentCache.delete(key);
  }

  public contextAt(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): LatexContext {
    const line = Math.min(Math.max(0, position.line), document.lineCount - 1);
    const cache = this.getDocumentCache(document);
    this.ensureLineState(document, cache, line);
    const lineInfo = document.lineAt(line);
    const character = Math.min(Math.max(0, position.character), lineInfo.text.length);
    const state = scanLatexSegment(
      lineInfo.text.slice(0, character),
      cache.states[line],
      document.offsetAt(new vscode.Position(line, 0)),
    );
    return latexContextFromState(state);
  }

  public matchAt(
    document: vscode.TextDocument,
    position: vscode.Position,
    activation: SnippetActivation,
    config: TeXLeafConfig,
    visualText?: string,
  ): RuntimeMatch | undefined {
    const state = this.stateFor(document.uri, config);
    const cursorOffset = document.offsetAt(position);
    const lookbehind = Math.max(
      state.maxLookbehind,
      longestLiteralTrigger(state.compiled),
    );
    const prefixStart = Math.max(0, cursorOffset - lookbehind);
    const textBefore = document.getText(
      new vscode.Range(document.positionAt(prefixStart), position),
    );
    const textAfter = document.getText(
      new vscode.Range(
        position,
        document.positionAt(
          Math.min(document.getText().length, cursorOffset + 1),
        ),
      ),
    );
    const context = this.contextAt(document, position);
    if (
      context.environments.some((environment) =>
        config.excludedEnvironments.includes(environment),
      )
    ) {
      return undefined;
    }

    const match = state.matcher.match({
      textBefore,
      textAfter,
      context,
      activation,
      ...(visualText === undefined ? {} : { visualText }),
    });
    if (match === undefined) {
      return undefined;
    }

    const absoluteStart = prefixStart + match.startOffset;
    const absoluteEnd = prefixStart + match.endOffset;
    return {
      match,
      range: new vscode.Range(
        document.positionAt(absoluteStart),
        document.positionAt(absoluteEnd),
      ),
      context,
    };
  }

  public matchText(
    resource: vscode.TextDocument | vscode.Uri,
    textBefore: string,
    textAfter: string,
    context: LatexContext,
    activation: SnippetActivation,
    config: TeXLeafConfig,
    visualText?: string,
  ): SnippetMatch | undefined {
    return this.stateFor(resourceUri(resource), config).matcher.match({
      textBefore,
      textAfter,
      context,
      activation,
      ...(visualText === undefined ? {} : { visualText }),
    });
  }

  public partsForSnippet(
    snippet: CompiledSnippet,
    visualText?: string,
  ): readonly ReplacementPart[] {
    return materializeReplacement(snippet.template, {
      ...(visualText === undefined ? {} : { visualText }),
    });
  }

  public partsForRecord(
    record: SnippetRecord,
    resource: vscode.TextDocument | vscode.Uri,
    config: TeXLeafConfig,
    visualText?: string,
  ): readonly ReplacementPart[] | undefined {
    const compiled = this.stateFor(resourceUri(resource), config).compiled.find(
      (snippet) => snippet.id === record.id,
    );
    return compiled === undefined
      ? undefined
      : this.partsForSnippet(compiled, visualText);
  }

  public dispose(): void {
    this.repositorySubscription.dispose();
    this.issueEmitter.dispose();
    this.documentCache.clear();
    this.resourceStates.clear();
  }

  private stateFor(
    resourceUri: vscode.Uri | undefined,
    config: TeXLeafConfig,
  ): ResourceRuntimeState {
    const ownerKey =
      resourceUri === undefined
        ? "<user-level>"
        : vscode.workspace.getWorkspaceFolder(resourceUri)?.uri.toString() ??
          "<user-level>";
    const key = `${ownerKey}\u0000${config.maxRegexScanLength}\u0000${config.wordDelimiters}`;
    const cached = this.resourceStates.get(key);
    if (
      cached !== undefined &&
      cached.revision === this.repository.snapshot.revision &&
      cached.maxLookbehind === config.maxRegexScanLength &&
      cached.wordDelimiters === config.wordDelimiters
    ) {
      return cached;
    }

    const snapshot = this.repository.resourceSnapshot(resourceUri);
    const state = buildResourceRuntimeState(snapshot, config);
    this.resourceStates.set(key, state);
    this.updateIssues(state.issues);
    return state;
  }

  private updateIssues(issues: readonly ValidationIssue[]): void {
    this.issues = issues;
    this.issueEmitter.fire(issues);
  }

  private getDocumentCache(document: vscode.TextDocument): DocumentCacheEntry {
    const key = document.uri.toString();
    let cache = this.documentCache.get(key);
    if (cache === undefined || cache.version !== document.version) {
      cache = {
        version: document.version,
        states: [createLatexScanState()],
      };
      this.documentCache.set(key, cache);
    }
    return cache;
  }

  private ensureLineState(
    document: vscode.TextDocument,
    cache: DocumentCacheEntry,
    targetLine: number,
  ): void {
    const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
    while (cache.states.length <= targetLine) {
      const previousLine = cache.states.length - 1;
      const line = document.lineAt(previousLine);
      const baseOffset = document.offsetAt(new vscode.Position(previousLine, 0));
      cache.states.push(
        scanLatexSegment(
          previousLine < document.lineCount - 1
            ? `${line.text}${newline}`
            : line.text,
          cache.states[previousLine],
          baseOffset,
        ),
      );
    }
  }
}

function buildResourceRuntimeState(
  snapshot: SnippetLibrarySnapshot,
  config: TeXLeafConfig,
): ResourceRuntimeState {
  const ordered = [...snapshot.snippets].sort((left, right) => {
    if (left.source !== right.source) {
      return sourcePrecedence(left.source) - sourcePrecedence(right.source);
    }
    return left.order - right.order;
  });
  const input = {
    schemaVersion: 1,
    variables: snapshot.variables,
    snippets: ordered.map((snippet) => ({
      id: snippet.id,
      trigger: snippet.trigger,
      replacement: snippet.replacement,
      options: snippet.options,
      priority: snippet.priority,
      ...(snippet.description === undefined
        ? {}
        : { description: snippet.description }),
      ...(snippet.flags === undefined ? {} : { flags: snippet.flags }),
      version: snippet.syntaxVersion,
      disabled: !snippet.enabled,
    })),
  };
  const validated = validateSnippetFile(input, { sourceId: "texleaf" });
  const compiled = compileSnippetFile(validated.value);
  const issues = [...validated.issues, ...compiled.issues];
  return {
    revision: snapshot.revision,
    maxLookbehind: config.maxRegexScanLength,
    wordDelimiters: config.wordDelimiters,
    compiled: compiled.value,
    matcher: new SnippetMatcher(compiled.value, {
      maxRegexInputLength: config.maxRegexScanLength,
      wordDelimiters: config.wordDelimiters,
    }),
    recordById: new Map(
      snapshot.snippets.map((snippet) => [snippet.id, snippet]),
    ),
    issues,
  };
}

function resourceUri(resource: vscode.TextDocument | vscode.Uri): vscode.Uri {
  return "uri" in resource ? resource.uri : resource;
}

function longestLiteralTrigger(snippets: readonly CompiledSnippet[]): number {
  let length = 1;
  for (const snippet of snippets) {
    if (snippet.triggerKind === "literal") {
      length = Math.max(length, snippet.triggerSource.length);
    }
  }
  return length;
}

function sourcePrecedence(source: SnippetRecord["source"]): number {
  switch (source) {
    case "workspace":
      return 0;
    case "global":
      return 1;
  }
}

export function replacementPartsToSnippetString(
  parts: readonly ReplacementPart[],
): vscode.SnippetString {
  const mapping = remapTabstopsForVsCode(parts);
  const snippet = new vscode.SnippetString();
  for (const part of mapping.parts) {
    if (part.kind === "text") {
      snippet.appendText(part.value);
    } else if (part.placeholder === undefined) {
      snippet.appendTabstop(part.index);
    } else {
      snippet.appendPlaceholder(part.placeholder, part.index);
    }
  }
  return snippet;
}
