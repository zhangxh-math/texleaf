import * as vscode from "vscode";
import { type CompiledSnippet, type LatexContext } from "./core";
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
  ): vscode.CompletionItem[] | undefined {
    const config = readConfig(document.uri);
    if (!config.enableCompletions || !isSupportedDocument(document, config)) {
      return undefined;
    }

    const latexContext = this.runtime.contextAt(document, position);
    if (latexContext.inComment || latexContext.inVerbatim) {
      return undefined;
    }
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    const items: vscode.CompletionItem[] = [];

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
      const item = new vscode.CompletionItem(
        snippet.triggerSource,
        vscode.CompletionItemKind.Snippet,
      );
      item.insertText = replacementPartsToSnippetString(
        this.runtime.partsForSnippet(snippet),
      );
      item.range = new vscode.Range(
        position.translate(0, -prefixLength),
        position,
      );
      item.filterText = snippet.triggerSource;
      item.sortText = sortText(snippet.priority, snippet.order);
      item.detail = snippet.description ?? "TeXLeaf 片段";
      item.documentation = new vscode.MarkdownString(
        `触发器：\`${escapeBackticks(snippet.triggerSource)}\`  \n选项：\`${snippet.options.raw || "无"}\``,
      );
      item.keepWhitespace = false;
      items.push(item);
    }
    return items;
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

function sortText(priority: number, order: number): string {
  const normalizedPriority = Math.max(0, Math.min(2_000_000, 1_000_000 - priority));
  return `${normalizedPriority.toString().padStart(7, "0")}:${order
    .toString()
    .padStart(7, "0")}`;
}

function escapeBackticks(value: string): string {
  return value.replaceAll("`", "\\`");
}
