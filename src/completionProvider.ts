import * as vscode from "vscode";
import {
  findCitationContext,
  type CompiledSnippet,
  type LatexContext,
} from "./core";
import { isSupportedDocument, readConfig } from "./config";
import {
  replacementPartsToSnippetString,
  SnippetRuntime,
} from "./snippetRuntime";

export class TeXLeafCompletionProvider
  implements vscode.CompletionItemProvider<vscode.CompletionItem>
{
  public constructor(private readonly runtime: SnippetRuntime) {}

  public provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ): vscode.CompletionList<vscode.CompletionItem> | undefined {
    const config = readConfig(document.uri);
    if (!config.enableCompletions || !isSupportedDocument(document, config)) {
      return undefined;
    }

    const latexContext = this.runtime.contextAt(document, position);
    if (latexContext.inComment || latexContext.inVerbatim) {
      return undefined;
    }
    if (
      config.zoteroCitations &&
      vscode.workspace.isTrusted &&
      /\.tex$/iu.test(document.uri.path) &&
      !latexContext.environments.some((environment) =>
        config.excludedEnvironments.includes(environment),
      ) &&
      findCitationContext(
        document.getText(),
        document.offsetAt(position),
        config.citationCommands,
      ) !== undefined
    ) {
      // CitationController owns the native Suggest surface inside cite-like
      // arguments. Mixing the general snippet catalogue here makes reference
      // title/author filtering noisy and can preselect an unrelated snippet.
      return undefined;
    }
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const items: vscode.CompletionItem[] = [];
    const exactMatch = this.runtime.matchAt(
      document,
      position,
      "completion",
      config,
    );
    const exactLiteralSnippet =
      exactMatch?.match.snippet.triggerKind === "literal" &&
      exactMatch.match.matchedText === exactMatch.match.snippet.triggerSource
        ? exactMatch.match.snippet
        : undefined;

    for (const snippet of this.runtime.compiledSnippetsFor(document, config)) {
      if (
        snippet.disabled ||
        snippet.triggerKind !== "literal" ||
        snippet.options.visual ||
        !snippetAppliesToContext(snippet, latexContext)
      ) {
        continue;
      }

      const prefixLength = matchingTypedPrefixLength(
        linePrefix,
        snippet.triggerSource,
      );
      const isExactTrigger = snippet === exactLiteralSnippet;
      const item = new vscode.CompletionItem(
        snippet.triggerSource,
        // `editor.snippetSuggestions = bottom` groups every item whose kind is
        // Snippet below language/word completions before normal selection is
        // applied. An exact TeXLeaf trigger is an editor command-like keyword,
        // while its SnippetString insertText still retains all placeholder
        // semantics. Fuzzy/partial candidates remain ordinary Snippet items.
        isExactTrigger
          ? vscode.CompletionItemKind.Keyword
          : vscode.CompletionItemKind.Snippet,
      );
      item.insertText = replacementPartsToSnippetString(
        this.runtime.partsForSnippet(snippet),
      );
      item.range = new vscode.Range(
        position.translate(0, -prefixLength),
        position,
      );
      item.filterText = snippet.triggerSource;
      if (isExactTrigger) {
        // `preselect` defeats recently-used suggestion memory among the best
        // fuzzy-score group. The distinct leading bucket moves only a complete
        // literal trigger ahead of native word/language candidates.
        item.preselect = true;
        item.sortText = exactSortText(snippet.priority, snippet.order);
      } else {
        // Preserve the extension's existing priority/order contract for every
        // partial candidate. This remains a tie-breaker after VS Code's fuzzy
        // score, but lets users deliberately order otherwise-equal snippets.
        item.sortText = snippetSortText(snippet.priority, snippet.order);
      }
      item.detail = snippet.description ?? "TeXLeaf 片段";
      item.documentation = new vscode.MarkdownString(
        `触发器：\`${escapeBackticks(snippet.triggerSource)}\`  \n选项：\`${snippet.options.raw || "无"}\``,
      );
      item.keepWhitespace = false;
      items.push(item);
    }
    // Quick Suggestions usually invokes a provider after the first character
    // and then filters its cached list. Marking the list incomplete makes VS
    // Code ask again as the prefix grows, so the item can become exact on the
    // final character instead of retaining its earlier fuzzy/Snippet metadata.
    return new vscode.CompletionList(items, true);
  }
}

export function registerCompletionProvider(
  context: vscode.ExtensionContext,
  runtime: SnippetRuntime,
): vscode.Disposable {
  const disposable = vscode.languages.registerCompletionItemProvider(
    "*",
    new TeXLeafCompletionProvider(runtime),
    ";",
    ":",
    "@",
    "\\",
  );
  context.subscriptions.push(disposable);
  return disposable;
}

function matchingTypedPrefixLength(linePrefix: string, trigger: string): number {
  const maximum = Math.min(linePrefix.length, trigger.length);
  for (let length = maximum; length > 0; length -= 1) {
    if (linePrefix.endsWith(trigger.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function snippetAppliesToContext(
  snippet: CompiledSnippet,
  context: LatexContext,
): boolean {
  const options = snippet.options;
  const hasMode =
    options.textMode ||
    options.anyMathMode ||
    options.blockMathMode ||
    options.inlineMathMode;
  return (
    !hasMode ||
    (options.textMode && context.mathMode === "text") ||
    (options.anyMathMode && context.mathMode !== "text") ||
    (options.blockMathMode && context.mathMode === "block") ||
    (options.inlineMathMode && context.mathMode === "inline")
  );
}

function exactSortText(priority: number, order: number): string {
  return `0000000:${snippetSortText(priority, order)}`;
}

function snippetSortText(priority: number, order: number): string {
  const normalizedPriority = Math.max(0, Math.min(2_000_000, 1_000_000 - priority));
  return `${normalizedPriority.toString().padStart(7, "0")}:${order
    .toString()
    .padStart(7, "0")}`;
}

function escapeBackticks(value: string): string {
  return value.replaceAll("`", "\\`");
}
