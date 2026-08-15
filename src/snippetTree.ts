import * as vscode from "vscode";
import {
  SnippetRepository,
  type SnippetLibrarySnapshot,
  type SnippetRecord,
} from "./snippetRepository";

type TreeNode = SourceNode | CategoryNode | SnippetNode;

interface SourceNode {
  readonly kind: "source";
  readonly id: string;
  readonly label: string;
  readonly snippets: readonly SnippetRecord[];
}

interface CategoryNode {
  readonly kind: "category";
  readonly id: string;
  readonly label: string;
  readonly source: SourceNode;
  readonly snippets: readonly SnippetRecord[];
}

interface SnippetNode {
  readonly kind: "snippet";
  readonly id: string;
  readonly snippet: SnippetRecord;
  readonly parent: CategoryNode;
}

export class SnippetTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<TreeNode | undefined>();
  private snapshot: SnippetLibrarySnapshot;
  private readonly repositorySubscription: vscode.Disposable;

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(private readonly repository: SnippetRepository) {
    this.snapshot = repository.snapshot;
    this.repositorySubscription = repository.onDidChange((snapshot) => {
      this.snapshot = snapshot;
      this.changeEmitter.fire(undefined);
    });
  }

  public getTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "source": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.Expanded,
        );
        item.id = element.id;
        item.description = `${element.snippets.length}`;
        item.iconPath = new vscode.ThemeIcon(
          element.snippets.some((snippet) => snippet.source === "workspace")
            ? "folder-library"
            : "library",
        );
        return item;
      }
      case "category": {
        const item = new vscode.TreeItem(
          element.label,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        item.id = element.id;
        item.description = `${element.snippets.length}`;
        item.iconPath = new vscode.ThemeIcon("symbol-namespace");
        return item;
      }
      case "snippet": {
        const { snippet } = element;
        const item = new vscode.TreeItem(snippet.trigger);
        item.id = snippet.id;
        item.description = summarizeReplacement(snippet.replacement);
        item.contextValue = "texleafSnippet";
        item.iconPath = new vscode.ThemeIcon(
          snippet.enabled ? "symbol-snippet" : "circle-slash",
        );
        item.command = {
          command: "texleaf.insertSnippet",
          title: "插入片段",
          arguments: [snippet],
        };
        item.tooltip = buildTooltip(snippet);
        return item;
      }
    }
  }

  public getChildren(element?: TreeNode): TreeNode[] {
    if (element === undefined) {
      return makeSourceNodes(this.snapshot.snippets);
    }
    if (element.kind === "source") {
      return makeCategoryNodes(element);
    }
    if (element.kind === "category") {
      return element.snippets.map((snippet) => ({
        kind: "snippet",
        id: snippet.id,
        snippet,
        parent: element,
      }));
    }
    return [];
  }

  public getParent(element: TreeNode): TreeNode | undefined {
    if (element.kind === "snippet") {
      return element.parent;
    }
    if (element.kind === "category") {
      return element.source;
    }
    return undefined;
  }

  public dispose(): void {
    this.repositorySubscription.dispose();
    this.changeEmitter.dispose();
  }
}

function makeSourceNodes(snippets: readonly SnippetRecord[]): SourceNode[] {
  const grouped = new Map<string, SnippetRecord[]>();
  for (const snippet of snippets) {
    const key = `${snippet.source}:${snippet.sourceLabel}`;
    const items = grouped.get(key) ?? [];
    items.push(snippet);
    grouped.set(key, items);
  }
  return [...grouped.entries()]
    .map(([key, items]) => ({
      kind: "source" as const,
      id: `source:${key}`,
      label: items[0]?.sourceLabel ?? key,
      snippets: items,
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function makeCategoryNodes(source: SourceNode): CategoryNode[] {
  const grouped = new Map<string, SnippetRecord[]>();
  for (const snippet of source.snippets) {
    const items = grouped.get(snippet.category) ?? [];
    items.push(snippet);
    grouped.set(snippet.category, items);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN"))
    .map(([label, snippets]) => ({
      kind: "category",
      id: `${source.id}:category:${label}`,
      label,
      source,
      snippets,
    }));
}

function summarizeReplacement(replacement: string): string {
  const oneLine = replacement.replaceAll("\n", " ↵ ").replace(/\s+/g, " ").trim();
  return oneLine.length > 42 ? `${oneLine.slice(0, 39)}…` : oneLine;
}

function buildTooltip(snippet: SnippetRecord): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendMarkdown(`**${escapeMarkdown(snippet.trigger)}**`);
  if (snippet.description !== undefined && snippet.description.length > 0) {
    markdown.appendMarkdown(` — ${escapeMarkdown(snippet.description)}`);
  }
  markdown.appendCodeblock(snippet.replacement, "latex");
  markdown.appendMarkdown(
    `\n选项：\`${snippet.options || "（无）"}\` · 优先级：\`${snippet.priority}\``,
  );
  markdown.isTrusted = false;
  return markdown;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&");
}
