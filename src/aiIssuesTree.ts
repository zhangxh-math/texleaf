import * as vscode from "vscode";

export const AI_ISSUES_TREE_VIEW_ID = "texleaf.aiIssues";
export const AI_ISSUES_TREE_REVEAL_COMMAND = "texleaf.aiIssues.reveal";
export const AI_ISSUES_TREE_APPLY_COMMAND = "texleaf.aiIssues.apply";
export const AI_ISSUES_TREE_IGNORE_COMMAND = "texleaf.aiIssues.ignore";

const DEFAULT_REVEAL_ISSUE_COMMAND = "texleaf.aiWriting.revealIssue";
const DEFAULT_APPLY_ISSUE_COMMAND = "texleaf.aiWriting.applyIssue";
const DEFAULT_IGNORE_ISSUE_COMMAND = "texleaf.aiWriting.ignoreIssue";
export const AI_ISSUE_TREE_ITEM_CONTEXT = "texleafAiIssue";
export const AI_REJECTED_TREE_ITEM_CONTEXT = "texleafAiRejectedSummary";

/**
 * An already validated issue that is safe to show for the active document.
 * The tree never turns an entry into a WorkspaceEdit; it forwards only the
 * document URI and opaque issue ID to the controller-owned commands.
 */
export interface AiIssueListEntry {
  readonly id: string;
  readonly range: vscode.Range;
  readonly original: string;
  readonly replacement: string;
  readonly message: string;
  readonly explanation: string;
  readonly category: string;
  readonly severity: vscode.DiagnosticSeverity;
}

/**
 * A complete, synchronous view of the active document's AI review state.
 *
 * - `supported: false` represents a closed or unsupported active editor.
 * - `enabled: false` represents a supported document with AI writing disabled.
 * - an empty `issues` array represents a completed review with no safe issues.
 * - `scheduled` and `checking` make the debounce/request lifecycle visible.
 * - rejected suggestions are summarized separately and are never actionable.
 */
export interface AiIssuesTreeSnapshot {
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly checking: boolean;
  readonly scheduled: boolean;
  /** Changed sentences retained locally but not yet successfully rechecked. */
  readonly pendingReviewCount: number;
  readonly issues: readonly AiIssueListEntry[];
  readonly rejectedIssueCount: number;
  readonly rejectedIssueCodes: readonly string[];
  readonly documentLabel: string;
  readonly uriText: string | null;
  readonly version: number | null;
}

export interface AiIssuesTreeSource {
  /** Fired whenever calling `snapshot()` could return different data. */
  readonly onDidChange: vscode.Event<void>;
  /** Must not perform network access or mutate editor state. */
  snapshot(): AiIssuesTreeSnapshot;
}

export interface AiIssuesTreeOptions {
  readonly viewId?: string;
  readonly revealTreeCommand?: string;
  readonly applyTreeCommand?: string;
  readonly ignoreTreeCommand?: string;
  readonly revealIssueCommand?: string;
  readonly applyIssueCommand?: string;
  readonly ignoreIssueCommand?: string;
}

export interface AiIssuesTreeRegistration extends vscode.Disposable {
  readonly provider: AiIssuesTreeProvider;
  readonly view: vscode.TreeView<AiIssuesTreeNode>;
}

interface ResolvedAiIssuesTreeOptions {
  readonly viewId: string;
  readonly revealTreeCommand: string;
  readonly applyTreeCommand: string;
  readonly ignoreTreeCommand: string;
  readonly revealIssueCommand: string;
  readonly applyIssueCommand: string;
  readonly ignoreIssueCommand: string;
}

interface StatusNode {
  readonly kind: "status";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly icon: string;
}

interface RejectedSummaryNode {
  readonly kind: "rejected";
  readonly id: string;
  readonly count: number;
  readonly codes: readonly string[];
}

interface IssueNode {
  readonly kind: "issue";
  readonly id: string;
  readonly uriText: string;
  readonly issue: AiIssueListEntry;
}

export type AiIssuesTreeNode = StatusNode | RejectedSummaryNode | IssueNode;

/**
 * Registers the tree, its safe forwarding commands, and its subscriptions.
 * The returned registration is also added to `context.subscriptions`.
 */
export function registerAiIssuesTree(
  context: vscode.ExtensionContext,
  source: AiIssuesTreeSource,
  options: AiIssuesTreeOptions = {},
): AiIssuesTreeRegistration {
  const resolved = resolveOptions(options);
  const provider = new AiIssuesTreeProvider(source, resolved.revealTreeCommand);
  const view = vscode.window.createTreeView(resolved.viewId, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  const disposables: vscode.Disposable[] = [
    provider,
    view,
    vscode.commands.registerCommand(
      resolved.revealTreeCommand,
      (targetOrUri: unknown, issueId?: unknown) =>
        forwardIssueCommand(
          resolved.revealIssueCommand,
          targetOrUri,
          issueId,
        ),
    ),
    vscode.commands.registerCommand(
      resolved.applyTreeCommand,
      (targetOrUri: unknown, issueId?: unknown) =>
        forwardIssueCommand(
          resolved.applyIssueCommand,
          targetOrUri,
          issueId,
        ),
    ),
    vscode.commands.registerCommand(
      resolved.ignoreTreeCommand,
      (targetOrUri: unknown, issueId?: unknown) =>
        forwardIssueCommand(
          resolved.ignoreIssueCommand,
          targetOrUri,
          issueId,
        ),
    ),
    provider.onDidChangeSnapshot((snapshot) => updateView(view, snapshot)),
  ];

  updateView(view, provider.currentSnapshot);

  let disposed = false;
  const registration: AiIssuesTreeRegistration = {
    provider,
    view,
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const disposable of disposables.reverse()) {
        disposable.dispose();
      }
    },
  };
  context.subscriptions.push(registration);
  return registration;
}

export class AiIssuesTreeProvider
  implements vscode.TreeDataProvider<AiIssuesTreeNode>, vscode.Disposable
{
  private readonly changeEmitter =
    new vscode.EventEmitter<AiIssuesTreeNode | undefined>();
  private readonly snapshotEmitter =
    new vscode.EventEmitter<AiIssuesTreeSnapshot>();
  private readonly subscriptions: vscode.Disposable[];
  private current: AiIssuesTreeSnapshot;
  private disposed = false;

  public readonly onDidChangeTreeData = this.changeEmitter.event;
  public readonly onDidChangeSnapshot = this.snapshotEmitter.event;

  public constructor(
    private readonly source: AiIssuesTreeSource,
    private readonly revealCommand = AI_ISSUES_TREE_REVEAL_COMMAND,
  ) {
    this.current = source.snapshot();
    this.subscriptions = [source.onDidChange(() => this.refresh())];
  }

  public get currentSnapshot(): AiIssuesTreeSnapshot {
    return this.current;
  }

  public getTreeItem(element: AiIssuesTreeNode): vscode.TreeItem {
    switch (element.kind) {
      case "status":
        return statusTreeItem(element);
      case "rejected":
        return rejectedTreeItem(element);
      case "issue":
        return issueTreeItem(element, this.revealCommand);
    }
  }

  public getChildren(element?: AiIssuesTreeNode): AiIssuesTreeNode[] {
    if (element !== undefined) {
      return [];
    }
    return nodesForSnapshot(this.current);
  }

  public refresh(): void {
    if (this.disposed) {
      return;
    }
    this.current = this.source.snapshot();
    this.snapshotEmitter.fire(this.current);
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.changeEmitter.dispose();
    this.snapshotEmitter.dispose();
  }
}

function nodesForSnapshot(snapshot: AiIssuesTreeSnapshot): AiIssuesTreeNode[] {
  const uriText = snapshot.uriText;
  if (!snapshot.supported || uriText === null) {
    return [];
  }
  if (!snapshot.enabled) {
    return [];
  }

  const nodes: AiIssuesTreeNode[] = [];
  if (snapshot.checking) {
    nodes.push({
      kind: "status",
      id: `texleaf-ai-status-checking:${uriText}`,
      label: "正在检查写作问题…",
      description: snapshot.documentLabel,
      icon: "loading~spin",
    });
  } else if (snapshot.scheduled) {
    nodes.push({
      kind: "status",
      id: `texleaf-ai-status-scheduled:${uriText}`,
      label: "等待输入停顿后自动检查…",
      description: snapshot.documentLabel,
      icon: "watch",
    });
  } else if (snapshot.pendingReviewCount > 0) {
    nodes.push({
      kind: "status",
      id: `texleaf-ai-status-pending:${uriText}:${snapshot.version ?? "unknown"}`,
      label: `${snapshot.pendingReviewCount} 个改动句子等待局部复检`,
      description: "其他问题仍保留",
      icon: "history",
    });
  }

  if (snapshot.rejectedIssueCount > 0) {
    nodes.push({
      kind: "rejected",
      id: `texleaf-ai-rejected:${uriText}:${snapshot.version ?? "unknown"}`,
      count: snapshot.rejectedIssueCount,
      codes: snapshot.rejectedIssueCodes,
    });
  }

  nodes.push(...snapshot.issues.map((issue): IssueNode => ({
    kind: "issue",
    id: `texleaf-ai-issue:${uriText}:${issue.id}`,
    uriText,
    issue,
  })));

  if (
    snapshot.issues.length === 0 &&
    !snapshot.checking &&
    !snapshot.scheduled &&
    snapshot.pendingReviewCount === 0
  ) {
    nodes.push({
      kind: "status",
      id: `texleaf-ai-status-empty:${uriText}:${snapshot.version ?? "unknown"}`,
      label: snapshot.rejectedIssueCount > 0
        ? "没有可安全定位的问题"
        : "暂未发现写作问题",
      description: snapshot.documentLabel,
      icon: "pass-filled",
    });
  }
  return nodes;
}

function statusTreeItem(node: StatusNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.label);
  item.id = node.id;
  item.description = node.description;
  item.iconPath = new vscode.ThemeIcon(node.icon);
  item.contextValue = "texleafAiStatus";
  item.tooltip = `${node.label}\n${node.description}`;
  return item;
}

function rejectedTreeItem(node: RejectedSummaryNode): vscode.TreeItem {
  const item = new vscode.TreeItem(
    `安全忽略 ${node.count} 条无法可靠定位的建议`,
  );
  item.id = node.id;
  item.description = "不会修改原文";
  item.iconPath = new vscode.ThemeIcon("shield");
  item.contextValue = AI_REJECTED_TREE_ITEM_CONTEXT;

  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown("**这些建议没有被应用，也不会出现在可操作问题列表中。**\n\n");
  tooltip.appendText(
    "常见原因包括模型位置偏差、原文不完全匹配、重复建议或修改范围重叠。TeXLeaf 无法无歧义定位时会优先保护原文。",
  );
  if (node.codes.length > 0) {
    tooltip.appendMarkdown("\n\n内部原因码：");
    tooltip.appendCodeblock(node.codes.join(", "), "text");
  }
  tooltip.isTrusted = false;
  item.tooltip = tooltip;
  return item;
}

function issueTreeItem(
  node: IssueNode,
  revealCommand: string,
): vscode.TreeItem {
  const { issue } = node;
  const category = categoryLabel(issue.category);
  const severity = severityPresentation(issue.severity);
  const line = issue.range.start.line + 1;
  const item = new vscode.TreeItem(
    `[第 ${line} 行 · ${category}] ${oneLine(issue.message, 96)}`,
  );
  item.id = node.id;
  item.description = `${severity.label} · ${replacementPreview(
    issue.original,
    issue.replacement,
  )}`;
  item.contextValue = AI_ISSUE_TREE_ITEM_CONTEXT;
  item.iconPath = new vscode.ThemeIcon(severity.icon, severity.color);
  item.command = {
    command: revealCommand,
    title: "定位 AI 写作问题",
    arguments: [node.uriText, issue.id],
  };
  item.tooltip = issueTooltip(issue, category, severity.label, line);
  return item;
}

function issueTooltip(
  issue: AiIssueListEntry,
  category: string,
  severity: string,
  line: number,
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(
    `**第 ${line} 行 · ${escapeMarkdown(category)} · ${escapeMarkdown(severity)}**\n\n`,
  );
  tooltip.appendText(issue.message);
  if (issue.explanation.trim().length > 0) {
    tooltip.appendMarkdown("\n\n");
    tooltip.appendText(issue.explanation.trim());
  }
  tooltip.appendMarkdown("\n\n修改前：");
  tooltip.appendCodeblock(tooltipText(issue.original), "latex");
  tooltip.appendMarkdown("修改后：");
  tooltip.appendCodeblock(tooltipText(issue.replacement), "latex");
  tooltip.appendMarkdown("\n单击可定位；右键可应用或忽略这条建议。");
  tooltip.isTrusted = false;
  return tooltip;
}

function updateView(
  view: vscode.TreeView<AiIssuesTreeNode>,
  snapshot: AiIssuesTreeSnapshot,
): void {
  if (!snapshot.supported || snapshot.uriText === null) {
    view.description = "未打开 .tex";
    view.badge = undefined;
    return;
  }
  if (!snapshot.enabled) {
    view.description = "已关闭";
    view.badge = undefined;
    return;
  }
  const phase = snapshot.checking
    ? "检查中"
    : snapshot.scheduled
    ? "待检查"
    : snapshot.pendingReviewCount > 0
    ? `待复检 ${snapshot.pendingReviewCount} 句`
    : undefined;
  view.description = phase === undefined
    ? `${snapshot.issues.length} 个问题`
    : `${phase} · ${snapshot.issues.length} 个问题`;
  view.badge = snapshot.issues.length === 0
    ? undefined
    : {
      value: snapshot.issues.length,
      tooltip: `${snapshot.documentLabel} 中有 ${snapshot.issues.length} 个可审阅问题`,
    };
}

async function forwardIssueCommand(
  command: string,
  targetOrUri: unknown,
  issueId: unknown,
): Promise<void> {
  const target = issueCommandTarget(targetOrUri, issueId);
  if (target === undefined) {
    return;
  }
  await vscode.commands.executeCommand(
    command,
    target.uriText,
    target.issueId,
  );
}

function issueCommandTarget(
  targetOrUri: unknown,
  issueId: unknown,
): { readonly uriText: string; readonly issueId: string } | undefined {
  if (
    typeof targetOrUri === "string" &&
    targetOrUri.length > 0 &&
    typeof issueId === "string" &&
    issueId.length > 0
  ) {
    return { uriText: targetOrUri, issueId };
  }
  if (!isRecord(targetOrUri) || targetOrUri.kind !== "issue") {
    return undefined;
  }
  const uriText = targetOrUri.uriText;
  const issue = targetOrUri.issue;
  if (
    typeof uriText !== "string" ||
    uriText.length === 0 ||
    !isRecord(issue) ||
    typeof issue.id !== "string" ||
    issue.id.length === 0
  ) {
    return undefined;
  }
  return { uriText, issueId: issue.id };
}

function replacementPreview(original: string, replacement: string): string {
  const before = oneLine(original, 32);
  const after = oneLine(replacement, 32);
  return `${before || "∅"} → ${after || "∅"}`;
}

function oneLine(value: string, maxLength: number): string {
  const compact = value.replaceAll("\r", "").replaceAll("\n", " ↵ ")
    .replace(/\s+/g, " ").trim();
  return compact.length > maxLength
    ? `${compact.slice(0, Math.max(0, maxLength - 1))}…`
    : compact;
}

function tooltipText(value: string): string {
  const maxLength = 1_500;
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}\n…（预览已截断）`
    : value;
}

function categoryLabel(category: string): string {
  const normalized = category.trim().toLowerCase().replaceAll("_", "-");
  switch (normalized) {
    case "grammar":
      return "语法";
    case "spelling":
      return "拼写";
    case "word-choice":
    case "wording":
      return "用词";
    case "punctuation":
      return "标点";
    case "clarity":
      return "清晰度";
    case "concision":
      return "简洁性";
    case "academic-tone":
    case "tone":
      return "学术语气";
    case "fluency":
      return "流畅度";
    case "capitalization":
      return "大小写";
    case "style":
      return "表达";
    default:
      return oneLine(category, 24) || "写作";
  }
}

function severityPresentation(severity: vscode.DiagnosticSeverity): {
  readonly label: string;
  readonly icon: string;
  readonly color: vscode.ThemeColor;
} {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return {
        label: "错误",
        icon: "error",
        color: new vscode.ThemeColor("problemsErrorIcon.foreground"),
      };
    case vscode.DiagnosticSeverity.Warning:
      return {
        label: "警告",
        icon: "warning",
        color: new vscode.ThemeColor("problemsWarningIcon.foreground"),
      };
    case vscode.DiagnosticSeverity.Hint:
      return {
        label: "提示",
        icon: "lightbulb",
        color: new vscode.ThemeColor("editorHint.foreground"),
      };
    case vscode.DiagnosticSeverity.Information:
    default:
      return {
        label: "建议",
        icon: "info",
        color: new vscode.ThemeColor("problemsInfoIcon.foreground"),
      };
  }
}

function resolveOptions(options: AiIssuesTreeOptions): ResolvedAiIssuesTreeOptions {
  return {
    viewId: options.viewId ?? AI_ISSUES_TREE_VIEW_ID,
    revealTreeCommand:
      options.revealTreeCommand ?? AI_ISSUES_TREE_REVEAL_COMMAND,
    applyTreeCommand: options.applyTreeCommand ?? AI_ISSUES_TREE_APPLY_COMMAND,
    ignoreTreeCommand:
      options.ignoreTreeCommand ?? AI_ISSUES_TREE_IGNORE_COMMAND,
    revealIssueCommand:
      options.revealIssueCommand ?? DEFAULT_REVEAL_ISSUE_COMMAND,
    applyIssueCommand:
      options.applyIssueCommand ?? DEFAULT_APPLY_ISSUE_COMMAND,
    ignoreIssueCommand:
      options.ignoreIssueCommand ?? DEFAULT_IGNORE_ISSUE_COMMAND,
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
