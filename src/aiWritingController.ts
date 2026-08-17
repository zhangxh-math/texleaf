import { createHash } from "node:crypto";
import * as vscode from "vscode";
import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_SECRET_KEY_PREFIX,
  DeepSeekClient,
  DeepSeekClientError,
  LEGACY_DEEPSEEK_SECRET_KEY,
  OPENAI_API_BASE_URL,
  OPENAI_SECRET_KEY_PREFIX,
  OpenAIClient,
  OpenAIClientError,
  deepSeekProviderIdentityFor,
  normalizeOpenAIModel,
  openAIProviderIdentityFor,
  type DeepSeekUsage,
} from "./ai";
import {
  advanceAiDirtyReviewProgress,
  aiIssueMatchesCapturedIdentity,
  aiIssueRangesOverlap,
  aiIssueReplacementAlreadyPresent,
  captureAiIssueIdentity,
  chooseAiIssueRetentionPreparation,
  createAiIssueActionId,
  aiWritingLanguageLabel,
  createPersistedAiIssueRecord,
  extractAiProseDocument,
  findAiProseParagraphAtOffset,
  findAiProseSentenceSegmentForIdleReview,
  findAiProseSentenceAtOffset,
  choosePendingAiAutomaticReviewTarget,
  planAiIssueRetention,
  planAiProseIssues,
  restorePersistedAiIssues,
  selectAiProseSentenceSegmentsForRanges,
  selectAiProseSegmentsForDocumentReview,
  shouldReplaceAiIssueAfterReview,
  tryReserveAiAutomaticReviewKey,
  type AiProseOffsetRange,
  type AiProseSegment,
  type AiAutomaticReviewTarget,
  type PlannedAiProseEdit,
} from "./core";
import { AiIssuePersistenceStore } from "./aiIssuePersistenceStore";
import {
  isAIWritingDocument,
  readConfig,
  type TeXLeafConfig,
} from "./config";
import type {
  AiIssuesTreeSnapshot,
  AiIssuesTreeSource,
} from "./aiIssuesTree";

const MAX_IGNORED_FINGERPRINTS = 1_024;
const MAX_AUTOMATIC_REVIEW_KEYS_PER_VERSION = 64;
const MAX_AUTOMATIC_DIRTY_SENTENCES_PER_BATCH = 8;
const MAX_SYNCHRONOUS_ISSUE_RETENTION_CHARACTERS = 1_000_000;
const MAX_DOCUMENT_REVIEW_SEGMENTS = 32;
const MAX_STORED_ISSUES_PER_DOCUMENT = 2_048;
const INTERNAL_APPLY_COMMAND = "texleaf.aiWriting.applyIssue";
const INTERNAL_IGNORE_COMMAND = "texleaf.aiWriting.ignoreIssue";
const INTERNAL_REVEAL_COMMAND = "texleaf.aiWriting.revealIssue";
const AI_ISSUES_FOCUS_COMMAND = "texleaf.aiIssues.focus";
const TEXLEAF_VIEW_CONTAINER_COMMAND = "workbench.view.extension.texleaf";
const AI_SELECTOR: vscode.DocumentSelector = [
  { language: "latex", pattern: "**/*.tex" },
  { language: "tex", pattern: "**/*.tex" },
];

interface StoredIssue {
  readonly id: string;
  readonly fingerprint: string;
  readonly documentVersion: number;
  readonly range: vscode.Range;
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly original: string;
  readonly replacement: string;
  readonly message: string;
  readonly explanation: string;
  readonly category: string;
  readonly severity: vscode.DiagnosticSeverity;
}

interface DocumentIssues {
  readonly version: number;
  readonly issues: readonly StoredIssue[];
}

interface SelectedIssue {
  readonly uriText: string;
  readonly issueId: string;
}

interface DocumentSourceSnapshot {
  readonly version: number;
  readonly source: string;
}

interface PendingDirtySentences {
  readonly version: number;
  readonly ranges: readonly AiProseOffsetRange[];
  /** Successful sentence contexts accumulated across requests in this version. */
  readonly reviewedSentenceKeys: ReadonlySet<string>;
}

interface ReviewSummary {
  readonly version: number;
  readonly rejectedIssueCount: number;
  readonly rejectedIssueCodes: readonly string[];
}

interface ReadyClient {
  readonly client: AIWritingClient;
  readonly config: TeXLeafConfig;
  readonly gateRevision: number;
  readonly provider: ProviderContext;
  readonly secretFingerprint: string;
}

type AIWritingClient = Pick<DeepSeekClient, "review" | "rewrite" | "complete">;

interface ProviderContextBase {
  readonly label: "DeepSeek" | "OpenAI";
  readonly model: string;
  readonly destination: string;
  readonly identity: string;
  readonly secretKey: string;
  readonly consentKey: string;
}

interface DeepSeekProviderContext extends ProviderContextBase {
  readonly id: "deepseek";
  readonly deepSeekBaseUrl: string;
  readonly isOfficialDefault: boolean;
}

interface OpenAIProviderContext extends ProviderContextBase {
  readonly id: "openai";
  readonly openAIBaseUrl: string;
}

type ProviderContext = DeepSeekProviderContext | OpenAIProviderContext;

interface AutomaticReviewHistory {
  readonly version: number;
  readonly keys: Set<string>;
}

interface ReviewOptions {
  readonly interactive: boolean;
  readonly operation: "automatic" | "paragraph" | "document";
  /**
   * Exact locally edited ranges. Automatic review may send a whole sentence
   * for context, but must not replace unrelated suggestions in that sentence.
   * Manual review omits this field and intentionally refreshes each segment.
   */
  readonly replacementRanges?: readonly AiProseOffsetRange[];
  readonly onProgress?: (completed: number, total: number) => void;
}

interface ReviewSnapshot {
  readonly source: string;
  readonly version: number;
  readonly generation: number;
}

interface ReviewSegmentsResult {
  /** True only when every requested segment completed and was committed. */
  readonly completed: boolean;
  /** Segments whose validated results were already merged into live state. */
  readonly reviewedSegments: readonly AiProseSegment[];
}

interface RewriteTarget {
  readonly range: vscode.Range;
  readonly text: string;
}

/**
 * Optional, consent-gated AI writing integration for named LaTeX documents.
 * Requests use the current editor buffer, which may include unsaved changes.
 * No provider method performs network access unless every runtime gate passes.
 */
export class AIWritingController
  implements
    vscode.Disposable,
    vscode.CodeActionProvider,
    vscode.HoverProvider,
    vscode.InlineCompletionItemProvider,
    AiIssuesTreeSource
{
  private readonly disposables: vscode.Disposable[] = [];
  /**
   * AI issues use an editor decoration instead of a DiagnosticCollection.
   *
   * VS Code always renders a diagnostic's built-in hover before extension
   * hover providers. Publishing the same issue as both a diagnostic and our
   * richer TeXLeaf hover therefore duplicated the message. A decoration keeps
   * the visible problem marker while the dedicated issue tree remains the
   * canonical list and our HoverProvider is the only detailed hover card.
   */
  private readonly issueDecoration =
    vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      borderWidth: "0 0 1px 0",
      borderStyle: "none none dotted none",
      borderColor: new vscode.ThemeColor("editorInfo.foreground"),
      overviewRulerColor: new vscode.ThemeColor("editorInfo.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
  /**
   * The tree's current issue gets a separate, silent overlay. An outline is
   * used instead of another border so the normal dotted issue marker remains
   * visible underneath it.
   */
  private readonly selectedIssueDecoration =
    vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      backgroundColor: new vscode.ThemeColor("editor.findMatchBackground"),
      outlineWidth: "1px",
      outlineStyle: "solid",
      outlineColor: new vscode.ThemeColor("editor.findMatchBorder"),
    });
  private readonly status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    70,
  );
  private readonly issueListEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChange = this.issueListEmitter.event;
  private readonly issueState = new Map<string, DocumentIssues>();
  private selectedIssue: SelectedIssue | undefined;
  /** Monotonic token which makes the most recent Tree reveal request win. */
  private revealIssueEpoch = 0;
  private readonly persistence: AiIssuePersistenceStore;
  private readonly restoreEpochs = new Map<string, number>();
  private readonly documentSources = new Map<string, DocumentSourceSnapshot>();
  private readonly pendingDirtySentences = new Map<
    string,
    PendingDirtySentences
  >();
  private readonly reviewSummaries = new Map<string, ReviewSummary>();
  private readonly ignored = new Set<string>();
  private readonly automaticTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingOffsets = new Map<string, AiAutomaticReviewTarget>();
  private readonly requests = new Map<string, AbortController>();
  private readonly generations = new Map<string, number>();
  private readonly errorCooldown = new Map<string, number>();
  private readonly automaticReviewKeys = new Map<
    string,
    AutomaticReviewHistory
  >();
  private readonly automaticReviewLimitVersions = new Map<string, number>();
  private disposed = false;
  private shutdownPromise: Promise<void> | undefined;
  private globalRestoreEpoch = 0;
  private gateRevision = 0;
  private statusGeneration = 0;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.persistence = new AiIssuePersistenceStore(context.globalStorageUri, output);
    this.status.name = "TeXLeaf AI 写作助手";
    this.status.command = "texleaf.aiWriting.showIssues";
  }

  public register(): void {
    for (const document of vscode.workspace.textDocuments) {
      this.rememberDocumentSource(document);
      void this.restoreDocumentIssues(document);
    }
    this.disposables.push(
      this.issueDecoration,
      this.selectedIssueDecoration,
      this.status,
      this.issueListEmitter,
      vscode.languages.registerCodeActionsProvider(AI_SELECTOR, this, {
        providedCodeActionKinds: [
          vscode.CodeActionKind.QuickFix,
          vscode.CodeActionKind.RefactorRewrite,
        ],
      }),
      vscode.languages.registerHoverProvider(AI_SELECTOR, this),
      vscode.languages.registerInlineCompletionItemProvider(AI_SELECTOR, this),
      vscode.commands.registerCommand("texleaf.aiWriting.toggle", () =>
        this.toggle(),
      ),
      vscode.commands.registerCommand("texleaf.aiWriting.setApiKey", () =>
        this.setApiKey(),
      ),
      vscode.commands.registerCommand("texleaf.aiWriting.clearApiKey", () =>
        this.clearApiKey(),
      ),
      vscode.commands.registerCommand("texleaf.aiWriting.reviewParagraph", () =>
        this.reviewCurrentParagraph(),
      ),
      vscode.commands.registerCommand("texleaf.aiWriting.reviewDocument", () =>
        this.reviewCurrentDocument(),
      ),
      vscode.commands.registerCommand("texleaf.aiWriting.rewriteSelection", () =>
        this.rewriteSelectionOrSentence(),
      ),
      vscode.commands.registerCommand(
        "texleaf.aiWriting.triggerCompletion",
        () => this.triggerCompletion(),
      ),
      vscode.commands.registerCommand(
        "texleaf.aiWriting.clearDiagnostics",
        () => this.clearCurrentDiagnostics(),
      ),
      vscode.commands.registerCommand(
        "texleaf.aiWriting.applyAll",
        () => this.applyAllIssues(),
      ),
      vscode.commands.registerCommand(
        "texleaf.aiWriting.showIssues",
        () => this.showIssues(),
      ),
      vscode.commands.registerCommand(
        INTERNAL_APPLY_COMMAND,
        (uriText: string, issueId: string) => this.applyIssue(uriText, issueId),
      ),
      vscode.commands.registerCommand(
        INTERNAL_IGNORE_COMMAND,
        (uriText: string, issueId: string) => this.ignoreIssue(uriText, issueId),
      ),
      vscode.commands.registerCommand(
        INTERNAL_REVEAL_COMMAND,
        (uriText: string, issueId: string) => this.revealIssue(uriText, issueId),
      ),
      vscode.workspace.onDidChangeTextDocument((event) =>
        this.documentChanged(event),
      ),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const editor = vscode.window.activeTextEditor;
        const offset = editor?.document === document
          ? document.offsetAt(editor.selection.active)
          : 0;
        this.scheduleAutomaticReview(document, offset);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => {
        this.rememberDocumentSource(document);
        void this.restoreDocumentIssues(document);
        if (document === vscode.window.activeTextEditor?.document) {
          this.scheduleAutomaticReview(document, 0);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) =>
        this.forgetDocument(document),
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // Do not clear the Tree-selected overlay here. `showTextDocument` with
        // `preserveFocus` may still emit active-editor changes, and an older
        // reveal request must not erase a newer selection. The overlay's own
        // URI/state validation below keeps unsupported editors empty.
        this.refreshIssueDecorations();
        void this.updateStatus(editor);
        this.issueListEmitter.fire();
        if (editor !== undefined) {
          this.scheduleAutomaticReview(
            editor.document,
            editor.document.offsetAt(editor.selection.active),
          );
        }
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.refreshIssueDecorations();
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (
          event.textEditor === vscode.window.activeTextEditor &&
          event.selections.length > 0
        ) {
          this.scheduleAutomaticReview(
            event.textEditor.document,
            event.textEditor.document.offsetAt(event.selections[0]!.active),
          );
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          !event.affectsConfiguration("texleaf.aiWriting") &&
          !event.affectsConfiguration("texleaf.enabled") &&
          !event.affectsConfiguration("texleaf.languageIds")
        ) {
          return;
        }
        this.gateRevision += 1;
        this.cancelAllAutomaticReviews();
        this.automaticReviewKeys.clear();
        this.abortAll();
        this.clearAllDiagnostics();
        void this.updateStatus(vscode.window.activeTextEditor);
        const editor = vscode.window.activeTextEditor;
        if (editor !== undefined) {
          this.scheduleAutomaticReview(
            editor.document,
            editor.document.offsetAt(editor.selection.active),
          );
        }
      }),
      this.context.secrets.onDidChange((event) => {
        if (
          event.key !== LEGACY_DEEPSEEK_SECRET_KEY &&
          !event.key.startsWith(DEEPSEEK_SECRET_KEY_PREFIX) &&
          !event.key.startsWith(OPENAI_SECRET_KEY_PREFIX)
        ) {
          return;
        }
        this.gateRevision += 1;
        this.cancelAllAutomaticReviews();
        this.automaticReviewKeys.clear();
        this.abortAll();
        this.clearAllDiagnostics();
        void this.updateStatus(vscode.window.activeTextEditor);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        void this.updateStatus(vscode.window.activeTextEditor);
        const editor = vscode.window.activeTextEditor;
        if (editor !== undefined) {
          void this.restoreDocumentIssues(editor.document);
          this.scheduleAutomaticReview(
            editor.document,
            editor.document.offsetAt(editor.selection.active),
          );
        }
      }),
    );
    void this.updateStatus(vscode.window.activeTextEditor);
    const editor = vscode.window.activeTextEditor;
    if (editor !== undefined) {
      this.scheduleAutomaticReview(
        editor.document,
        editor.document.offsetAt(editor.selection.active),
      );
    }
  }

  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.shutdownPromise = this.shutdownCore();
    return this.shutdownPromise;
  }

  public dispose(): void {
    void this.shutdown();
  }

  private async shutdownCore(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true;
      this.abortAll();
      for (const timer of this.automaticTimers.values()) {
        clearTimeout(timer);
      }
      this.automaticTimers.clear();
      this.issueListEmitter.fire();
      for (const disposable of this.disposables.splice(0)) {
        disposable.dispose();
      }
    }
    await this.persistence.shutdown();
  }

  public snapshot(): AiIssuesTreeSnapshot {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined || editor.document.isClosed) {
      return {
        enabled: false,
        supported: false,
        checking: false,
        scheduled: false,
        pendingReviewCount: 0,
        issues: [],
        rejectedIssueCount: 0,
        rejectedIssueCodes: [],
        documentLabel: "",
        uriText: null,
        version: null,
      };
    }
    const document = editor.document;
    const config = readConfig(document.uri);
    const supported = this.isStaticScope(document);
    const issuesVisible = supported &&
      config.aiWritingEnabled &&
      vscode.workspace.isTrusted;
    const uriText = document.uri.toString();
    const state = this.issueState.get(uriText);
    const source = issuesVisible && state?.version === document.version
      ? document.getText()
      : undefined;
    const currentIssues = source !== undefined && state !== undefined
      ? state.issues.filter((issue) =>
        storedIssueMatchesCurrentSource(document, source, issue)
      )
      : [];
    const summary = this.reviewSummaries.get(uriText);
    const pendingDirty = this.pendingDirtySentences.get(uriText);
    const hasPendingDirty = pendingDirty?.version === document.version &&
      pendingDirty.ranges.length > 0;
    return {
      enabled: config.aiWritingEnabled,
      supported,
      checking: issuesVisible &&
        this.requests.has(requestKeyFor(document.uri, "review")),
      scheduled: issuesVisible &&
        config.aiWritingAutomaticReview &&
        this.automaticTimers.has(uriText),
      pendingReviewCount: issuesVisible && hasPendingDirty
        ? pendingDirty.ranges.length
        : 0,
      issues: currentIssues.map((issue) => ({
        id: issue.id,
        range: issue.range,
        original: issue.original,
        replacement: issue.replacement,
        message: issue.message,
        explanation: issue.explanation,
        category: issue.category,
        severity: issue.severity,
      })),
      rejectedIssueCount: issuesVisible && summary?.version === document.version
        ? summary.rejectedIssueCount
        : 0,
      rejectedIssueCodes: issuesVisible && summary?.version === document.version
        ? summary.rejectedIssueCodes
        : [],
      documentLabel: vscode.workspace.asRelativePath(document.uri, false),
      uriText,
      version: document.version,
    };
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    _context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.CodeAction[] | undefined {
    if (token.isCancellationRequested || !this.canExposeIssues(document)) {
      return undefined;
    }
    const state = this.issueState.get(document.uri.toString());
    const source = document.getText();
    const actions: vscode.CodeAction[] = [];
    if (state?.version === document.version) {
      for (const issue of state.issues) {
        if (
          !editorRangeTouchesIssue(range, issue.range) ||
          !storedIssueMatchesCurrentSource(document, source, issue)
        ) {
          continue;
        }
        const replacement = previewText(issue.replacement, 80);
        const fix = new vscode.CodeAction(
          issue.replacement.length === 0
            ? "TeXLeaf AI：删除这段文字"
            : `TeXLeaf AI：替换为“${replacement}”`,
          vscode.CodeActionKind.QuickFix,
        );
        fix.command = {
          command: INTERNAL_APPLY_COMMAND,
          title: "应用 AI 建议",
          arguments: [document.uri.toString(), issue.id],
        };
        fix.isPreferred = issue.category === "spelling" || issue.category === "grammar";
        actions.push(fix);

        const ignore = new vscode.CodeAction(
          "TeXLeaf AI：本次会话忽略此建议",
          vscode.CodeActionKind.QuickFix,
        );
        ignore.command = {
          command: INTERNAL_IGNORE_COMMAND,
          title: "忽略 AI 建议",
          arguments: [document.uri.toString(), issue.id],
        };
        actions.push(ignore);
      }
    }

    if (
      range instanceof vscode.Selection &&
      !range.isEmpty &&
      readConfig(document.uri).aiWritingEnabled
    ) {
      const rewrite = new vscode.CodeAction(
        "TeXLeaf AI：改写所选正文",
        vscode.CodeActionKind.RefactorRewrite,
      );
      rewrite.command = {
        command: "texleaf.aiWriting.rewriteSelection",
        title: "AI 改写所选正文",
      };
      actions.push(rewrite);
    }
    return actions.length === 0 ? undefined : actions;
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): vscode.Hover | undefined {
    if (token.isCancellationRequested || !this.canExposeIssues(document)) {
      return undefined;
    }
    const state = this.issueState.get(document.uri.toString());
    if (state?.version !== document.version) {
      return undefined;
    }
    const source = document.getText();
    const issue = state.issues.find((candidate) =>
      issueRangeContainsPosition(candidate.range, position) &&
      storedIssueMatchesCurrentSource(document, source, candidate)
    );
    if (issue === undefined) {
      return undefined;
    }
    const markdown = new vscode.MarkdownString(undefined, false);
    // Keep model-provided Markdown untrusted while allowing this one fixed,
    // extension-owned command link. The URI and opaque issue ID are encoded as
    // JSON query arguments, and applyIssue still revalidates the live document
    // version, range, source text, and replacement before changing anything.
    markdown.isTrusted = { enabledCommands: [INTERNAL_APPLY_COMMAND] };
    const applyCommandUri = `command:${INTERNAL_APPLY_COMMAND}?${encodeURIComponent(
      JSON.stringify([document.uri.toString(), issue.id]),
    )}`;
    markdown.appendMarkdown(
      `**TeXLeaf AI · ${escapeMarkdown(categoryLabel(issue.category))}**\n\n`,
    );
    markdown.appendMarkdown(`${escapeMarkdown(issue.message)}\n\n`);
    if (issue.explanation.length > 0) {
      markdown.appendMarkdown(`${escapeMarkdown(issue.explanation)}\n\n`);
    }
    markdown.appendMarkdown("建议：");
    markdown.appendCodeblock(issue.replacement || "（删除）", "text");
    markdown.appendMarkdown(
      `[应用这条建议](${applyCommandUri}) · ` +
        "中文输入法可能占用 Ctrl + .；也可以先按 Esc 关闭悬浮框、切到英文输入法后再按。应用前会再次核对原文。",
    );
    return new vscode.Hover(markdown, issue.range);
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (context.selectedCompletionInfo !== undefined) {
      return undefined;
    }
    const ready = await this.readyClient(document, false);
    if (
      ready === undefined ||
      !ready.config.aiWritingInlineCompletions ||
      token.isCancellationRequested
    ) {
      return undefined;
    }

    const version = document.version;
    const generation = this.generation(document.uri);
    const source = document.getText();
    const prose = extractAiProseDocument(source);
    const sourceOffset = document.offsetAt(position);
    const segment = prose.segments.find((candidate) =>
      sourceOffset >= candidate.sourceStart &&
      sourceOffset <= candidate.sourceEnd,
    );
    if (segment === undefined) {
      return undefined;
    }
    const relative = sourceOffset - segment.sourceStart;
    if (!isEditableInsertion(segment, relative)) {
      return undefined;
    }
    const prefixStart = Math.max(0, relative - 2_000);
    const suffixEnd = Math.min(segment.text.length, relative + 1_000);
    const prefix = segment.text.slice(prefixStart, relative);
    const suffix = segment.text.slice(relative, suffixEnd);
    if (!completionContextIsUseful(prefix)) {
      return undefined;
    }

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic) {
      const completedDelay = await cancellationDelay(
        ready.config.aiWritingCompletionDelayMs,
        token,
      );
      if (!completedDelay) {
        return undefined;
      }
    }
    if (
      document.version !== version ||
      this.generation(document.uri) !== generation ||
      token.isCancellationRequested ||
      !(await this.runtimeGateStillOpen(
        document,
        ready,
        "inline",
      )) ||
      document.version !== version ||
      this.generation(document.uri) !== generation
    ) {
      return undefined;
    }
    const requestKey = requestKeyFor(document.uri, "inline");
    const controller = this.startRequest(requestKey);
    const cancellation = token.onCancellationRequested(() => controller.abort());
    try {
      const result = await ready.client.complete(prefix, suffix, {
        language: aiWritingLanguageLabel(ready.config.aiWritingLanguage),
        style: writingStyle(ready.config),
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        token.isCancellationRequested ||
        document.version !== version ||
        this.generation(document.uri) !== generation ||
        !(await this.runtimeGateStillOpen(
          document,
          ready,
          "inline",
        ))
      ) {
        return undefined;
      }
      const completion = result.completion;
      if (!safePlainText(completion, 1_024, true) || completion.length === 0) {
        return undefined;
      }
      this.logUsage("inline", ready.config.aiWritingModel, result.usage);
      return [
        new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position),
        ),
      ];
    } catch (error: unknown) {
      this.reportError(error, false, ready.provider);
      return undefined;
    } finally {
      cancellation.dispose();
      this.finishRequest(requestKey, controller);
    }
  }

  private async toggle(): Promise<void> {
    const resource = vscode.window.activeTextEditor?.document.uri;
    const config = readConfig(resource);
    if (config.aiWritingEnabled) {
      await this.updateEnabledSetting(false, resource);
      this.cancelAllAutomaticReviews();
      this.automaticReviewKeys.clear();
      this.abortAll();
      this.clearAllDiagnostics();
      void vscode.window.showInformationMessage("TeXLeaf AI 写作助手已关闭。");
      return;
    }

    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch (error: unknown) {
      this.reportError(error, true);
      return;
    }
    if (!(await this.ensureConsent(provider))) {
      return;
    }
    if (!currentProviderMatches(provider, resource)) {
      void vscode.window.showWarningMessage(
        "AI 服务商或 Base URL 已变化；TeXLeaf 没有开启新的目标，请重新运行命令。",
      );
      return;
    }
    if ((await this.context.secrets.get(provider.secretKey)) === undefined) {
      if (!(await this.promptAndStoreApiKey(provider, resource))) {
        return;
      }
    }
    if (!currentProviderMatches(provider, resource)) {
      return;
    }
    await this.updateEnabledSetting(true, resource);
    void vscode.window.showInformationMessage(
      `TeXLeaf AI 写作助手已开启；仅受信任环境中已命名 .tex 的当前正文会发送到 ${provider.label}（可能包含尚未保存的编辑）。`,
    );
  }

  private async setApiKey(): Promise<void> {
    const resource = vscode.window.activeTextEditor?.document.uri;
    const config = readConfig(resource);
    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch (error: unknown) {
      this.reportError(error, true);
      return;
    }
    const stored = await this.promptAndStoreApiKey(provider, resource);
    if (!stored) {
      return;
    }
    if (!readConfig(resource).aiWritingEnabled) {
      const enable = await vscode.window.showInformationMessage(
        `${provider.label} API Key 已安全保存。是否同时开启 AI 写作助手？`,
        "开启",
      );
      if (
        enable === "开启" &&
        currentProviderMatches(provider, resource) &&
        (await this.ensureConsent(provider)) &&
        currentProviderMatches(provider, resource)
      ) {
        await this.updateEnabledSetting(true, resource);
      }
    }
  }

  private async clearApiKey(): Promise<void> {
    const resource = vscode.window.activeTextEditor?.document.uri;
    const config = readConfig(resource);
    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch (error: unknown) {
      this.reportError(error, true);
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `清除当前 VS Code 环境中为 ${provider.label}（${provider.destination}）保存的 API Key？AI 写作会立即停止。`,
      { modal: true },
      "清除",
    );
    if (choice !== "清除") {
      return;
    }
    if (!currentProviderMatches(provider, resource)) {
      void vscode.window.showWarningMessage(
        "AI 服务商或 Base URL 已变化；为避免删除错误的凭据，本次操作已取消。",
      );
      return;
    }
    await this.context.secrets.delete(provider.secretKey);
    this.cancelAllAutomaticReviews();
    this.automaticReviewKeys.clear();
    this.abortAll();
    this.clearAllDiagnostics();
    void vscode.window.showInformationMessage(`${provider.label} API Key 已清除。`);
  }

  private async reviewCurrentParagraph(): Promise<void> {
    const editor = await this.requireActiveEditor();
    if (editor === undefined) {
      return;
    }
    const ready = await this.readyClient(editor.document, true);
    if (ready === undefined) {
      return;
    }
    this.cancelAutomaticReview(editor.document.uri);
    const snapshot = this.captureReviewSnapshot(editor.document);
    const prose = extractAiProseDocument(snapshot.source);
    const selectionIsEmpty = editor.selection.isEmpty;
    const rawSegments = selectionIsEmpty
      ? paragraphSegmentsAt(
          prose.segments,
          editor.document.offsetAt(editor.selection.active),
        )
      : sliceSegmentsForRange(
          prose.segments,
          editor.document.offsetAt(editor.selection.start),
          editor.document.offsetAt(editor.selection.end),
        );
    const boundedSelection = selectionIsEmpty
      ? undefined
      : selectAiProseSegmentsForDocumentReview(
          rawSegments,
          ready.config.aiWritingMaxParagraphLength,
          ready.config.aiWritingMaxDocumentLength,
          MAX_DOCUMENT_REVIEW_SEGMENTS,
        );
    const segments = boundedSelection?.segments ?? rawSegments;
    if (segments.length === 0) {
      void vscode.window.showInformationMessage(
        "当前选区或段落没有可发送的自然语言正文。",
      );
      return;
    }
    if (selectionIsEmpty && segments.some((segment) =>
      segment.text.length > ready.config.aiWritingMaxParagraphLength
    )) {
      void vscode.window.showWarningMessage(
        "当前正文超过单段发送上限，请缩小选区或提高 maxParagraphLength。",
      );
      return;
    }
    if (boundedSelection?.truncated === true) {
      void vscode.window.showWarningMessage(
        `本次选区检查已按长度上限或单次最多 ${MAX_DOCUMENT_REVIEW_SEGMENTS} 个段落截断；其余选区未发送。`,
      );
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "TeXLeaf AI 正在检查正文",
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({
          message: `${ready.provider.label} · 不会发送数学与受保护 TeX`,
        });
        const review = await this.reviewSegments(editor.document, segments, ready, {
          interactive: true,
          operation: "paragraph",
        }, snapshot, token);
        if (review.reviewedSegments.length > 0) {
          this.scheduleNextDirtyReview(editor.document, snapshot.version);
        }
      },
    );
  }

  private async reviewCurrentDocument(): Promise<void> {
    const editor = await this.requireActiveEditor();
    if (editor === undefined) {
      return;
    }
    const ready = await this.readyClient(editor.document, true);
    if (ready === undefined) {
      return;
    }
    this.cancelAutomaticReview(editor.document.uri);
    const snapshot = this.captureReviewSnapshot(editor.document);
    const prose = extractAiProseDocument(snapshot.source);
    const selection = selectAiProseSegmentsForDocumentReview(
      prose.segments,
      ready.config.aiWritingMaxParagraphLength,
      ready.config.aiWritingMaxDocumentLength,
      MAX_DOCUMENT_REVIEW_SEGMENTS,
    );
    const selected = selection.segments;
    if (selected.length === 0) {
      void vscode.window.showInformationMessage(
        "当前文档没有可发送的自然语言正文，或首段已超过长度上限。",
      );
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "TeXLeaf AI 正在分段检查当前文档",
        cancellable: true,
      },
      async (progress, token) => {
        const review = await this.reviewSegments(editor.document, selected, ready, {
          interactive: true,
          operation: "document",
          onProgress: (completed, totalSegments) => {
            progress.report({
              message: `段落 ${completed}/${totalSegments}`,
              increment: 100 / totalSegments,
            });
          },
        }, snapshot, token);
        if (review.reviewedSegments.length > 0) {
          this.scheduleNextDirtyReview(editor.document, snapshot.version);
        }
      },
    );
    if (selection.truncated) {
      void vscode.window.showWarningMessage(
        `本次整篇检查已按长度上限或单次最多 ${MAX_DOCUMENT_REVIEW_SEGMENTS} 个段落截断；其余正文未发送。`,
      );
    }
  }

  private async rewriteSelectionOrSentence(): Promise<void> {
    const editor = await this.requireActiveEditor();
    if (editor === undefined) {
      return;
    }
    const ready = await this.readyClient(editor.document, true);
    if (ready === undefined) {
      return;
    }
    const target = rewriteTarget(editor);
    if (target === undefined) {
      void vscode.window.showWarningMessage(
        "请选择一段连续纯正文，或把光标放在不含受保护 TeX 标记的句子中。",
      );
      return;
    }
    if (target.text.length > ready.config.aiWritingMaxParagraphLength) {
      void vscode.window.showWarningMessage("所选正文超过单段发送上限。");
      return;
    }
    const version = editor.document.version;
    const generation = this.generation(editor.document.uri);
    const instruction = await chooseRewriteInstruction(ready.provider.label);
    if (instruction === undefined) {
      return;
    }
    if (
      editor.document.version !== version ||
      this.generation(editor.document.uri) !== generation ||
      editor.document.getText(target.range) !== target.text ||
      !(await this.runtimeGateStillOpen(
        editor.document,
        ready,
        "manual",
      )) ||
      editor.document.version !== version ||
      this.generation(editor.document.uri) !== generation
    ) {
      void vscode.window.showInformationMessage(
        "文档或 AI 设置已变化，本次改写已取消。",
      );
      return;
    }
    const requestKey = requestKeyFor(editor.document.uri, "rewrite");
    const controller = this.startRequest(requestKey);
    try {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "TeXLeaf AI 正在改写所选正文",
          cancellable: true,
        },
        async (_progress, token) => {
          const cancellation = token.onCancellationRequested(() =>
            controller.abort()
          );
          try {
            if (
              controller.signal.aborted ||
              editor.document.version !== version ||
              this.generation(editor.document.uri) !== generation ||
              editor.document.getText(target.range) !== target.text ||
              !(await this.runtimeGateStillOpen(
                editor.document,
                ready,
                "manual",
              ))
            ) {
              return undefined;
            }
            return await ready.client.rewrite(target.text, instruction, {
              language: aiWritingLanguageLabel(ready.config.aiWritingLanguage),
              style: writingStyle(ready.config),
              signal: controller.signal,
            });
          } finally {
            cancellation.dispose();
          }
        },
      );
      if (result === undefined) {
        return;
      }
      if (
        controller.signal.aborted ||
        editor.document.version !== version ||
        this.generation(editor.document.uri) !== generation ||
        editor.document.getText(target.range) !== target.text ||
        !(await this.runtimeGateStillOpen(
          editor.document,
          ready,
          "manual",
        ))
      ) {
        return;
      }
      if (
        !safePlainText(
          result.replacement,
          Math.max(2_048, target.text.length * 3),
          false,
        ) ||
        result.replacement === target.text
      ) {
        void vscode.window.showWarningMessage(
          `${ready.provider.label} 返回的改写未通过 TeX 安全校验，原文保持不变。`,
        );
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(editor.document.uri, target.range, result.replacement);
      if (!(await vscode.workspace.applyEdit(edit))) {
        void vscode.window.showErrorMessage("无法应用 AI 改写，原文保持不变。");
        return;
      }
      this.logUsage("rewrite", ready.config.aiWritingModel, result.usage);
    } catch (error: unknown) {
      this.reportError(error, true, ready.provider);
    } finally {
      this.finishRequest(requestKey, controller);
    }
  }

  private async triggerCompletion(): Promise<void> {
    const editor = await this.requireActiveEditor();
    if (editor === undefined || (await this.readyClient(editor.document, true)) === undefined) {
      return;
    }
    await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger");
  }

  private async showIssues(): Promise<void> {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes(AI_ISSUES_FOCUS_COMMAND)) {
      try {
        await vscode.commands.executeCommand(AI_ISSUES_FOCUS_COMMAND);
        return;
      } catch {
        this.output.warn(
          "AI 写作问题视图的焦点命令不可用，改为打开 TeXLeaf 侧栏。",
        );
      }
    }

    // A VSIX can finish updating the extension host while an already-open
    // renderer still has the preceding version's static view contributions.
    // In that split state the container exists, but VS Code has not generated
    // the new `<viewId>.focus` command yet. Avoid surfacing its raw internal
    // command error and give the user the one operation that reloads the
    // manifest as well as the extension code.
    if (commands.includes(TEXLEAF_VIEW_CONTAINER_COMMAND)) {
      try {
        await vscode.commands.executeCommand(TEXLEAF_VIEW_CONTAINER_COMMAND);
      } catch {
        // The reload prompt below is the safe recovery path even when the
        // renderer cannot open the already-contributed container.
      }
    }
    const action = await vscode.window.showWarningMessage(
      "TeXLeaf 已更新，但当前 VS Code 窗口尚未载入新的“AI 写作问题”视图。请重新加载窗口，使新版视图清单生效。",
      "重新加载窗口",
    );
    if (action === "重新加载窗口") {
      await vscode.commands.executeCommand("workbench.action.reloadWindow");
    }
  }

  private clearCurrentDiagnostics(): void {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined) {
      this.abortAll();
      this.clearAllDiagnostics();
      return;
    }
    this.cancelAutomaticReview(document.uri);
    this.abortForUri(document.uri);
    this.bumpGeneration(document.uri);
    const uriText = document.uri.toString();
    this.invalidateRestore(document.uri);
    this.automaticReviewKeys.delete(uriText);
    this.automaticReviewLimitVersions.delete(uriText);
    this.pendingDirtySentences.delete(uriText);
    this.scheduleIssuePersistence(document.uri, document.version, []);
    this.issueState.delete(uriText);
    this.clearSelectedIssue(uriText);
    this.reviewSummaries.delete(uriText);
    this.refreshIssueDecorations(document.uri);
    this.issueListEmitter.fire();
    void this.updateStatus(vscode.window.activeTextEditor);
  }

  private ignoreIssue(uriText: string, issueId: string): void {
    const state = this.issueState.get(uriText);
    const matches = state?.issues.filter((candidate) => candidate.id === issueId) ?? [];
    const issue = matches.length === 1 ? matches[0] : undefined;
    if (state === undefined || issue === undefined) {
      return;
    }
    this.ignored.add(issue.fingerprint);
    if (this.ignored.size > MAX_IGNORED_FINGERPRINTS) {
      const oldest = this.ignored.values().next().value;
      if (typeof oldest === "string") {
        this.ignored.delete(oldest);
      }
    }
    const remaining = state.issues.filter((candidate) => candidate.id !== issueId);
    const uri = vscode.Uri.parse(uriText, true);
    this.setIssueState(uri, state.version, remaining);
  }

  private async applyIssue(uriText: string, issueId: string): Promise<void> {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(uriText, true);
    } catch {
      return;
    }
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (document === undefined) {
      this.refreshAfterStaleIssueCommand(uri);
      return;
    }
    const config = readConfig(document.uri);
    if (!config.aiWritingEnabled) {
      void vscode.window.showInformationMessage(
        "TeXLeaf AI 写作助手当前已关闭。",
      );
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "未信任工作区中不能应用 TeXLeaf AI 建议。",
      );
      return;
    }
    if (!this.isStaticScope(document)) {
      void vscode.window.showInformationMessage(
        "AI 写作建议只可应用到已命名的 .tex（LaTeX/TeX）文档。",
      );
      return;
    }
    const state = this.issueState.get(uri.toString());
    const matches = state?.issues.filter((candidate) => candidate.id === issueId) ?? [];
    const issue = matches.length === 1 ? matches[0] : undefined;
    const source = document.getText();
    if (
      issue === undefined ||
      state?.version !== document.version ||
      issue.documentVersion !== document.version ||
      !storedIssueMatchesCurrentSource(document, source, issue)
    ) {
      this.refreshAfterStaleIssueCommand(uri);
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, issue.range, issue.replacement);
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch {
      // Do not consume the issue before VS Code confirms the edit. A rejected
      // WorkspaceEdit therefore leaves the still-valid suggestion available.
    }
    if (!applied) {
      void vscode.window.showErrorMessage("TeXLeaf AI 无法应用这条建议。");
      return;
    }
    this.consumeAppliedIssues(uri, new Set([issue.id]), false);
  }

  private async applyAllIssues(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    if (document === undefined) {
      void vscode.window.showInformationMessage("请先打开一个已命名的 .tex 文件。");
      return;
    }
    const config = readConfig(document.uri);
    if (!config.aiWritingEnabled) {
      void vscode.window.showInformationMessage(
        "TeXLeaf AI 写作助手当前已关闭。",
      );
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "未信任工作区中不能应用 TeXLeaf AI 建议。",
      );
      return;
    }
    if (!this.isStaticScope(document)) {
      void vscode.window.showInformationMessage(
        "AI 写作建议只可应用到已命名的 .tex（LaTeX/TeX）文档。",
      );
      return;
    }
    const initialIssues = currentSafeIssues(
      document,
      this.issueState.get(document.uri.toString()),
    );
    if (initialIssues.length === 0) {
      void vscode.window.showInformationMessage("当前文档没有可应用的 AI 写作建议。");
      return;
    }
    const sorted = [...initialIssues].sort((left, right) =>
      left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    );
    if (storedIssuesOverlap(sorted)) {
      void vscode.window.showWarningMessage(
        "AI 建议范围发生重叠；为保护原文，本次没有应用任何修改。",
      );
      return;
    }
    const version = document.version;
    const capturedIssues = sorted.map(captureAiIssueIdentity);
    const choice = await vscode.window.showWarningMessage(
      `一次应用当前文档中的 ${sorted.length} 条 AI 建议？请在保存前复核修改。`,
      { modal: true },
      "应用全部",
    );
    if (choice !== "应用全部") {
      return;
    }
    const currentConfig = readConfig(document.uri);
    if (!currentConfig.aiWritingEnabled) {
      void vscode.window.showInformationMessage(
        "TeXLeaf AI 写作助手当前已关闭。",
      );
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        "未信任工作区中不能应用 TeXLeaf AI 建议。",
      );
      return;
    }
    if (!this.isStaticScope(document)) {
      void vscode.window.showInformationMessage(
        "AI 写作建议只可应用到已命名的 .tex（LaTeX/TeX）文档。",
      );
      return;
    }
    if (document.isClosed || document.version !== version) {
      this.refreshAfterStaleIssueCommand(document.uri);
      return;
    }
    const currentIssues = currentSafeIssues(
      document,
      this.issueState.get(document.uri.toString()),
    );
    const resolved: StoredIssue[] = [];
    for (const captured of capturedIssues) {
      const matches = currentIssues.filter((issue) =>
        aiIssueMatchesCapturedIdentity(issue, captured)
      );
      if (matches.length !== 1) {
        this.refreshAfterStaleIssueCommand(document.uri);
        return;
      }
      resolved.push(matches[0]!);
    }
    const currentSorted = resolved.sort((left, right) =>
      left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    );
    if (storedIssuesOverlap(currentSorted)) {
      void vscode.window.showWarningMessage(
        "AI 建议范围发生重叠；为保护原文，本次没有应用任何修改。",
      );
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const issue of currentSorted) {
      edit.replace(document.uri, issue.range, issue.replacement);
    }
    let applied = false;
    try {
      applied = await vscode.workspace.applyEdit(edit);
    } catch {
      // See applyIssue: failed edits must not optimistically consume state.
    }
    if (!applied) {
      void vscode.window.showErrorMessage("TeXLeaf AI 无法应用全部建议。");
      return;
    }
    this.consumeAppliedIssues(
      document.uri,
      new Set(capturedIssues.map((issue) => issue.id)),
      false,
    );
  }

  /**
   * A tree row or Quick Fix can outlive the exact issue snapshot which created
   * its command arguments. Refresh the canonical list without producing a
   * notification (and its possible accessibility sound) for this routine race.
   */
  private refreshAfterStaleIssueCommand(uri: vscode.Uri): void {
    const uriText = uri.toString();
    this.clearSelectedIssue(uriText);
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uriText,
    );
    const state = this.issueState.get(uriText);
    if (document !== undefined && state?.version === document.version) {
      // Re-enter the state boundary so older in-memory snapshots are pruned by
      // the same exact-source/contextual checks used for new state.
      this.setIssueState(uri, state.version, state.issues);
    } else {
      this.refreshIssueDecorations(uri);
      this.issueListEmitter.fire();
      void this.updateStatus(vscode.window.activeTextEditor);
    }
    vscode.window.setStatusBarMessage(
      "TeXLeaf AI：问题列表已更新；旧建议已失效。",
      5_000,
    );
  }

  /**
   * Explicitly consume suggestions after VS Code confirms their edits.
   *
   * `onDidChangeTextDocument` normally runs before `applyEdit` resolves, but
   * that ordering is not an API contract callers should rely on. Preserve the
   * state's own version here: if the event already ran, this filters the
   * post-edit state; if it has not, the later event can still remap every
   * unrelated issue from the pre-edit snapshot. Applying all intentionally
   * consumes the complete validated snapshot.
   */
  private consumeAppliedIssues(
    uri: vscode.Uri,
    issueIds: ReadonlySet<string>,
    consumeAll: boolean,
  ): void {
    const state = this.issueState.get(uri.toString());
    if (state === undefined) {
      return;
    }
    const remaining = consumeAll
      ? []
      : state.issues.filter((candidate) => !issueIds.has(candidate.id));
    if (remaining.length === state.issues.length) {
      return;
    }
    this.setIssueState(uri, state.version, remaining);
  }

  private async revealIssue(uriText: string, issueId: string): Promise<void> {
    const revealEpoch = ++this.revealIssueEpoch;
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(uriText, true);
    } catch {
      this.clearSelectedIssue();
      this.refreshIssueDecorations();
      return;
    }
    const state = this.issueState.get(uri.toString());
    const matches = state?.issues.filter((candidate) => candidate.id === issueId) ?? [];
    const issue = matches.length === 1 ? matches[0] : undefined;
    if (issue === undefined) {
      this.clearSelectedIssue();
      this.refreshIssueDecorations();
      return;
    }
    // Record the latest click before yielding. This makes B win immediately
    // when A and B are clicked in quick succession, even if A's editor-opening
    // promise happens to settle last.
    this.selectedIssue = { uriText: uri.toString(), issueId: issue.id };
    this.refreshIssueDecorations();
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      if (revealEpoch !== this.revealIssueEpoch) {
        return;
      }
      let liveIssue = this.currentRevealIssue(document, issueId);
      if (liveIssue === undefined) {
        this.clearSelectedIssue();
        this.refreshIssueDecorations();
        vscode.window.setStatusBarMessage(
          "TeXLeaf AI：这条建议已经过期；问题列表已刷新。",
          5_000,
        );
        return;
      }
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: true,
      });
      if (revealEpoch !== this.revealIssueEpoch) {
        return;
      }
      // The buffer can change while VS Code opens/reveals an editor. Resolve
      // the stable ID against the latest state so an unaffected issue follows
      // a proven offset remap, while a stale or consumed issue fails closed.
      liveIssue = this.currentRevealIssue(document, issueId);
      if (liveIssue === undefined) {
        this.clearSelectedIssue();
        this.refreshIssueDecorations();
        vscode.window.setStatusBarMessage(
          "TeXLeaf AI：这条建议已经过期；问题列表已刷新。",
          5_000,
        );
        return;
      }
      this.refreshIssueDecorations();
      // Keep the primary cursor where it is. Moving it onto a problem marker
      // makes VS Code play its configured line accessibility signal. Scrolling
      // still reveals the issue without stealing focus from the issue list.
      editor.revealRange(
        liveIssue.range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    } catch {
      if (revealEpoch !== this.revealIssueEpoch) {
        return;
      }
      this.clearSelectedIssue();
      this.refreshIssueDecorations();
      vscode.window.setStatusBarMessage(
        "TeXLeaf AI：无法打开这条建议对应的文档。",
        5_000,
      );
    }
  }

  /** Resolve one uniquely identified issue against the live, exact buffer. */
  private currentRevealIssue(
    document: vscode.TextDocument,
    issueId: string,
  ): StoredIssue | undefined {
    if (!this.canExposeIssues(document)) {
      return undefined;
    }
    const matches = currentSafeIssues(
      document,
      this.issueState.get(document.uri.toString()),
    ).filter((issue) => issue.id === issueId);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private documentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (!event.document.uri.path.toLowerCase().endsWith(".tex")) {
      return;
    }
    const uriText = event.document.uri.toString();
    if (event.contentChanges.length > 0) {
      this.invalidateRestore(event.document.uri);
    }
    const existingState = this.issueState.get(uriText);
    const existingDirty = this.pendingDirtySentences.get(uriText);
    const config = readConfig(event.document.uri);
    if (
      existingState === undefined &&
      existingDirty === undefined &&
      (!config.aiWritingEnabled || !config.aiWritingAutomaticReview)
    ) {
      // The feature is opt-in. With no live review state to preserve, avoid
      // synchronously rescanning a potentially large TeX document on every
      // keystroke while AI writing (or automatic review) is disabled.
      const requestPrefix = `${uriText}\u0000`;
      if ([...this.requests.keys()].some((key) => key.startsWith(requestPrefix))) {
        this.bumpGeneration(event.document.uri);
        this.abortForUri(event.document.uri);
      }
      this.documentSources.delete(uriText);
      return;
    }
    const currentSource = event.document.getText();
    const remembered = this.documentSources.get(uriText);
    if (
      event.contentChanges.length === 0 &&
      (remembered === undefined || remembered.source === currentSource)
    ) {
      // VS Code also emits document-change notifications for dirty-state,
      // save and encoding transitions. They contain no text edits and must
      // not erase a valid full-document review or its dirty-sentence queue.
      const versionChanged = remembered !== undefined &&
        remembered.version !== event.document.version;
      if (versionChanged) {
        // A same-text version transition makes any in-flight snapshot stale.
        // Abort it and start a fresh per-version reservation history; carrying
        // the old Set forward could leave an uncommitted sentence permanently
        // reserved after the old request exits on its version check.
        this.abortForUri(event.document.uri);
        this.bumpGeneration(event.document.uri);
        this.automaticReviewKeys.delete(uriText);
        this.automaticReviewLimitVersions.delete(uriText);
      }
      this.documentSources.set(uriText, {
        version: event.document.version,
        source: currentSource,
      });
      const state = this.issueState.get(uriText);
      if (state !== undefined && state.version !== event.document.version) {
        this.setIssueState(
          event.document.uri,
          event.document.version,
          state.issues.map((issue) => ({
            ...issue,
            documentVersion: event.document.version,
          })),
          false,
        );
      }
      const pending = this.pendingDirtySentences.get(uriText);
      if (pending !== undefined && pending.version !== event.document.version) {
        this.pendingDirtySentences.set(uriText, {
          version: event.document.version,
          ranges: pending.ranges,
          reviewedSentenceKeys: pending.reviewedSentenceKeys,
        });
      }
      const summary = this.reviewSummaries.get(uriText);
      if (summary !== undefined && summary.version !== event.document.version) {
        this.reviewSummaries.set(uriText, {
          ...summary,
          version: event.document.version,
        });
      }
      this.issueListEmitter.fire();
      void this.updateStatus(vscode.window.activeTextEditor);
      if (versionChanged) {
        this.scheduleNextDirtyReview(event.document, event.document.version);
      }
      return;
    }
    this.bumpGeneration(event.document.uri);
    this.abortForUri(event.document.uri);
    const dirtySegments = this.retainUnaffectedIssues(event);
    this.reviewSummaries.delete(uriText);
    this.automaticReviewKeys.delete(uriText);
    const lastDirty = dirtySegments.at(-1);
    if (lastDirty !== undefined) {
      this.scheduleAutomaticReview(
        event.document,
        lastDirty.sourceStart,
        false,
        "edit",
      );
    }
    this.issueListEmitter.fire();
    void this.updateStatus(vscode.window.activeTextEditor);
  }

  private scheduleAutomaticReview(
    document: vscode.TextDocument,
    sourceOffset: number,
    notify = true,
    reason: AiAutomaticReviewTarget["reason"] = "navigation",
  ): void {
    const config = readConfig(document.uri);
    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch {
      return;
    }
    if (
      !config.aiWritingEnabled ||
      !config.aiWritingAutomaticReview ||
      !vscode.workspace.isTrusted ||
      !this.hasConsent(provider) ||
      !this.isStaticScope(document)
    ) {
      return;
    }
    const uriText = document.uri.toString();
    if (
      reason === "navigation" &&
      this.pendingDirtySentences.get(uriText)?.version === document.version &&
      this.requests.has(requestKeyFor(document.uri, "review"))
    ) {
      return;
    }
    const pending = this.pendingOffsets.get(uriText);
    const target = choosePendingAiAutomaticReviewTarget(pending, {
      offset: sourceOffset,
      reason,
    });
    if (target === pending) {
      // A cursor move is allowed to schedule an idle review, but it must not
      // steal the pending target from text that has not yet been checked.
      return;
    }
    const previous = this.automaticTimers.get(uriText);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    this.pendingOffsets.set(uriText, target);
    const timer = setTimeout(() => {
      this.automaticTimers.delete(uriText);
      const offset = this.pendingOffsets.get(uriText)?.offset ?? 0;
      this.pendingOffsets.delete(uriText);
      this.issueListEmitter.fire();
      void this.updateStatus(vscode.window.activeTextEditor);
      void this.runAutomaticReview(document, offset);
    }, config.aiWritingReviewDelayMs);
    this.automaticTimers.set(uriText, timer);
    if (notify) {
      this.issueListEmitter.fire();
      void this.updateStatus(vscode.window.activeTextEditor);
    }
  }

  private async runAutomaticReview(
    document: vscode.TextDocument,
    sourceOffset: number,
  ): Promise<void> {
    const ready = await this.readyClient(document, false);
    if (
      ready === undefined ||
      !ready.config.aiWritingAutomaticReview ||
      document.isClosed
    ) {
      return;
    }
    const snapshot = this.captureReviewSnapshot(document);
    const prose = extractAiProseDocument(snapshot.source);
    const uriText = document.uri.toString();
    const pendingDirty = this.pendingDirtySentences.get(uriText);
    const dirtySegments = pendingDirty?.version === snapshot.version
      ? selectAiProseSentenceSegmentsForRanges(prose, pendingDirty.ranges)
      : [];
    const navigationSegment = dirtySegments.length === 0
      ? findAiProseSentenceSegmentForIdleReview(
          snapshot.source,
          prose,
          sourceOffset,
        )
      : undefined;
    const candidates = dirtySegments.length > 0
      ? dirtySegments
      : navigationSegment === undefined
      ? []
      : [navigationSegment];
    const bounded: AiProseSegment[] = [];
    let totalCharacters = 0;
    for (const segment of candidates) {
      if (bounded.length >= MAX_AUTOMATIC_DIRTY_SENTENCES_PER_BATCH) {
        break;
      }
      if (
        segment.text.length > ready.config.aiWritingMaxParagraphLength ||
        totalCharacters + segment.text.length > ready.config.aiWritingMaxDocumentLength
      ) {
        continue;
      }
      bounded.push(segment);
      totalCharacters += segment.text.length;
    }
    if (bounded.length === 0) {
      return;
    }
    let history = this.automaticReviewKeys.get(uriText);
    if (history === undefined || history.version !== snapshot.version) {
      history = {
        version: snapshot.version,
        keys: new Set<string>(),
      };
      this.automaticReviewKeys.set(uriText, history);
    }
    const reserved: Array<{ readonly segment: AiProseSegment; readonly key: string }> = [];
    let reachedRequestCap = false;
    for (const segment of bounded) {
      const key = stableHash([
        String(segment.sourceStart),
        String(segment.sourceEnd),
        segment.text,
        ready.provider.identity,
        ready.config.aiWritingModel,
        ready.config.aiWritingLanguage,
        ready.config.aiWritingStyle,
      ].join("\u0000"));
      reachedRequestCap ||= !history.keys.has(key) &&
        history.keys.size >= MAX_AUTOMATIC_REVIEW_KEYS_PER_VERSION;
      if (
        tryReserveAiAutomaticReviewKey(
          history.keys,
          key,
          MAX_AUTOMATIC_REVIEW_KEYS_PER_VERSION,
        )
      ) {
        reserved.push({ segment, key });
      }
    }
    if (
      reachedRequestCap &&
      this.automaticReviewLimitVersions.get(uriText) !== snapshot.version
    ) {
      this.automaticReviewLimitVersions.set(uriText, snapshot.version);
      this.output.debug(
        `AI 自动检查已达到当前文档版本的 ${MAX_AUTOMATIC_REVIEW_KEYS_PER_VERSION} 句硬上限；新的光标导航不会再产生请求。`,
      );
    }
    if (reserved.length === 0) {
      return;
    }
    const reviewOptions: ReviewOptions = dirtySegments.length > 0 && pendingDirty !== undefined
      ? {
          interactive: false,
          operation: "automatic",
          replacementRanges: pendingDirty.ranges,
        }
      : { interactive: false, operation: "automatic" };
    const review = await this.reviewSegments(
      document,
      reserved.map((item) => item.segment),
      ready,
      reviewOptions,
      snapshot,
    );
    if (!review.completed) {
      const reviewedKeys = new Set(
        review.reviewedSegments.map((segment) =>
          `${segment.sourceStart}:${segment.sourceEnd}`
        ),
      );
      const current = this.automaticReviewKeys.get(uriText);
      if (current === history && current.version === snapshot.version) {
        for (const item of reserved) {
          if (
            !reviewedKeys.has(
              `${item.segment.sourceStart}:${item.segment.sourceEnd}`,
            )
          ) {
            current.keys.delete(item.key);
          }
        }
        if (current.keys.size === 0) {
          this.automaticReviewKeys.delete(uriText);
        }
      }
    }
    if (review.reviewedSegments.length > 0) {
      this.scheduleNextDirtyReview(document, snapshot.version);
    }
  }

  private async reviewSegments(
    document: vscode.TextDocument,
    segments: readonly AiProseSegment[],
    ready: ReadyClient,
    options: ReviewOptions,
    snapshot: ReviewSnapshot,
    token?: vscode.CancellationToken,
  ): Promise<ReviewSegmentsResult> {
    const { source, version, generation } = snapshot;
    const requestKey = requestKeyFor(document.uri, "review");
    const controller = this.startRequest(requestKey);
    this.issueListEmitter.fire();
    void this.updateStatus(vscode.window.activeTextEditor);
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    const stored: StoredIssue[] = [];
    const reviewedSegments: AiProseSegment[] = [];
    let rejectedIssueCount = 0;
    const rejectedIssueCodes = new Set<string>();
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (
          segment === undefined ||
          controller.signal.aborted ||
          token?.isCancellationRequested === true ||
          document.version !== version ||
          this.generation(document.uri) !== generation ||
          !(await this.runtimeGateStillOpen(
            document,
            ready,
            options.operation,
          )) ||
          document.version !== version ||
          this.generation(document.uri) !== generation
        ) {
          return { completed: false, reviewedSegments };
        }
        const result = await ready.client.review(segment.text, {
          language: aiWritingLanguageLabel(ready.config.aiWritingLanguage),
          style: writingStyle(ready.config),
          signal: controller.signal,
        });
        rejectedIssueCount += result.rejectedIssueCount ?? 0;
        for (const code of result.rejectedIssueCodes ?? []) {
          rejectedIssueCodes.add(safeErrorCode(code));
        }
        const plan = planAiProseIssues(source, segment, result.issues);
        rejectedIssueCount += plan.rejected.length;
        for (const rejection of plan.rejected) {
          rejectedIssueCodes.add(`local-${rejection.reason}`);
        }
        const segmentIssues: StoredIssue[] = [];
        for (const edit of plan.edits) {
          const issue = this.storeIssue(document, edit);
          if (!this.ignored.has(issue.fingerprint)) {
            segmentIssues.push(issue);
            stored.push(issue);
          }
        }
        this.logUsage(
          options.operation,
          ready.config.aiWritingModel,
          result.usage,
        );
        // A provider response is never committed against a stale editor,
        // consent, key, endpoint, model, or configuration snapshot. Commit
        // each sentence independently so a later provider failure cannot
        // discard (and then bill again for) earlier successful sentences.
        if (
          controller.signal.aborted ||
          document.isClosed ||
          document.version !== version ||
          this.generation(document.uri) !== generation ||
          !(await this.runtimeGateStillOpen(
            document,
            ready,
            options.operation,
          )) ||
          document.version !== version ||
          this.generation(document.uri) !== generation
        ) {
          return { completed: false, reviewedSegments };
        }
        const committed = this.mergeIssuesAfterReview(
          document.uri,
          version,
          segment,
          segmentIssues,
          options.replacementRanges,
        );
        this.reviewSummaries.set(document.uri.toString(), {
          version,
          rejectedIssueCount,
          rejectedIssueCodes: [...rejectedIssueCodes].sort(),
        });
        this.markDirtySegmentsReviewed(
          document,
          version,
          [...reviewedSegments, segment],
        );
        this.documentSources.set(document.uri.toString(), { version, source });
        this.setIssueState(document.uri, version, committed);
        reviewedSegments.push(segment);
        options.onProgress?.(index + 1, segments.length);
      }
      if (rejectedIssueCount > 0) {
        const codes = [...rejectedIssueCodes].sort().join(",");
        this.output.debug(
          `AI ${options.operation} 安全忽略 ${rejectedIssueCount} 条建议；codes=${codes || "unknown"}。`,
        );
      }
      if (options.interactive) {
        const message = stored.length === 0
          ? rejectedIssueCount === 0
            ? "TeXLeaf AI：未发现可安全映射的写作问题。"
            : `TeXLeaf AI：模型返回了 ${rejectedIssueCount} 条建议，但都无法无歧义、安全地映射到原文，已全部忽略。`
          : rejectedIssueCount === 0
            ? `TeXLeaf AI：发现 ${stored.length} 个可审阅问题。`
            : `TeXLeaf AI：发现 ${stored.length} 个可审阅问题；为避免改错位置，另忽略 ${rejectedIssueCount} 条重复、重叠或无法唯一定位的建议。`;
        // Successful reviews are routine feedback. A notification toast can
        // carry a VS Code accessibility signal sound, whereas the dedicated
        // status item and issue tree already expose the same result.
        vscode.window.setStatusBarMessage(message, 8_000);
      }
      return { completed: true, reviewedSegments };
    } catch (error: unknown) {
      if (!this.disposed) {
        this.reportError(error, options.interactive, ready.provider);
      }
      return { completed: false, reviewedSegments };
    } finally {
      cancellation?.dispose();
      this.finishRequest(requestKey, controller);
      if (!this.disposed) {
        this.issueListEmitter.fire();
        void this.updateStatus(vscode.window.activeTextEditor);
      }
    }
  }

  private storeIssue(
    document: vscode.TextDocument,
    edit: PlannedAiProseEdit,
  ): StoredIssue {
    const message = edit.message?.trim() || "建议修改这段文字";
    const explanation = edit.explanation?.trim() ?? "";
    const category = edit.category?.trim() || "style";
    const fingerprint = issueFingerprint(
      document.uri,
      edit.sourceStart,
      edit.sourceEnd,
      edit.original,
      edit.replacement,
      category,
    );
    return {
      id: createAiIssueActionId(fingerprint, document.version),
      fingerprint,
      documentVersion: document.version,
      range: new vscode.Range(
        document.positionAt(edit.sourceStart),
        document.positionAt(edit.sourceEnd),
      ),
      sourceStart: edit.sourceStart,
      sourceEnd: edit.sourceEnd,
      original: edit.original,
      replacement: edit.replacement,
      message,
      explanation,
      category,
      severity: diagnosticSeverity(edit.severity, category),
    };
  }

  private setIssueState(
    uri: vscode.Uri,
    version: number,
    issues: readonly StoredIssue[],
    notify = true,
    persist = true,
  ): void {
    const uriText = uri.toString();
    const document = vscode.workspace.textDocuments.find((candidate) =>
      !candidate.isClosed &&
      candidate.version === version &&
      candidate.uri.toString() === uriText
    );
    const source = document?.getText();
    const currentIssues = document === undefined || source === undefined
      ? issues
      : issues.filter((issue) =>
        issue.documentVersion === version &&
        storedIssueMatchesCurrentSource(document, source, issue)
      );
    const idCounts = new Map<string, number>();
    for (const issue of currentIssues) {
      idCounts.set(issue.id, (idCounts.get(issue.id) ?? 0) + 1);
    }
    const unique = currentIssues.filter((issue) => idCounts.get(issue.id) === 1)
      .sort((left, right) =>
      left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
      );
    const sorted = unique.slice(0, MAX_STORED_ISSUES_PER_DOCUMENT);
    if (unique.length > sorted.length) {
      this.output.warn(
        `AI 写作问题数量超过本地显示上限 ${MAX_STORED_ISSUES_PER_DOCUMENT}；超出部分未进入诊断或问题列表。`,
      );
    }
    this.issueState.set(uriText, { version, issues: sorted });
    if (
      this.selectedIssue?.uriText === uriText &&
      (
        document === undefined ||
        !this.canExposeIssues(document) ||
        sorted.filter((issue) => issue.id === this.selectedIssue?.issueId)
            .length !== 1
      )
    ) {
      this.clearSelectedIssue(uriText);
    }
    if (persist) {
      this.scheduleIssuePersistence(uri, version, sorted);
    }
    this.refreshIssueDecorations(uri);
    if (notify) {
      this.issueListEmitter.fire();
      void this.updateStatus(vscode.window.activeTextEditor);
    }
  }

  /** Refresh the editor-only issue marker without creating a native hover. */
  private refreshIssueDecorations(uri?: vscode.Uri): void {
    const requested = uri?.toString();
    for (const editor of vscode.window.visibleTextEditors) {
      if (
        requested !== undefined &&
        editor.document.uri.toString() !== requested
      ) {
        continue;
      }
      const state = this.issueState.get(editor.document.uri.toString());
      const source = editor.document.getText();
      const issues = this.canExposeIssues(editor.document) &&
          state?.version === editor.document.version
        ? state.issues
          .filter((issue) =>
            storedIssueMatchesCurrentSource(editor.document, source, issue)
          )
        : [];
      editor.setDecorations(
        this.issueDecoration,
        issues.map((issue) =>
          decorationRangeForIssue(editor.document, issue.range)
        ),
      );
      const selected = this.selectedIssue?.uriText ===
          editor.document.uri.toString()
        ? issues.filter((issue) => issue.id === this.selectedIssue?.issueId)
        : [];
      editor.setDecorations(
        this.selectedIssueDecoration,
        selected.length === 1
          ? [decorationRangeForIssue(editor.document, selected[0]!.range)]
          : [],
      );
    }
  }

  /** Drop the selected overlay globally or only when it belongs to `uriText`. */
  private clearSelectedIssue(uriText?: string): void {
    if (
      this.selectedIssue !== undefined &&
      (uriText === undefined || this.selectedIssue.uriText === uriText)
    ) {
      this.selectedIssue = undefined;
      // A clear/consume/close which wins while an editor is opening must also
      // prevent that older reveal promise from restoring the removed overlay.
      this.revealIssueEpoch += 1;
    }
  }

  private async readyClient(
    document: vscode.TextDocument,
    interactive: boolean,
  ): Promise<ReadyClient | undefined> {
    const gateRevision = this.gateRevision;
    const config = readConfig(document.uri);
    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch (error: unknown) {
      if (interactive) {
        this.reportError(error, true);
      }
      return undefined;
    }
    if (!this.isStaticScope(document)) {
      if (interactive) {
        void vscode.window.showInformationMessage(
          "AI 写作只在已命名的 .tex（LaTeX/TeX）文档中生效。",
        );
      }
      return undefined;
    }
    if (!vscode.workspace.isTrusted) {
      if (interactive) {
        void vscode.window.showWarningMessage(
          "未信任工作区中 TeXLeaf 不会发送正文；请先检查并信任工作区。",
        );
      }
      return undefined;
    }
    if (!config.aiWritingEnabled) {
      if (interactive) {
        const enable = await vscode.window.showInformationMessage(
          "TeXLeaf AI 写作助手当前已关闭。",
          "开启",
        );
        if (enable === "开启") {
          await this.toggle();
        }
      }
      return undefined;
    }
    if (!this.hasConsent(provider)) {
      if (
        !interactive ||
        !(await this.ensureConsent(provider)) ||
        this.gateRevision !== gateRevision
      ) {
        return undefined;
      }
    }
    const apiKey = await this.context.secrets.get(provider.secretKey);
    const currentConfig = readConfig(document.uri);
    if (
      this.gateRevision !== gateRevision ||
      !sameAIWritingConfig(currentConfig, config) ||
      !sameProviderContext(providerContextOrUndefined(currentConfig), provider)
    ) {
      return undefined;
    }
    if (apiKey === undefined) {
      if (interactive) {
        await this.setApiKey();
      }
      return undefined;
    }
    try {
      return {
        client: createAIWritingClient(provider, apiKey),
        config,
        gateRevision,
        provider,
        secretFingerprint: secretFingerprint(apiKey),
      };
    } catch (error: unknown) {
      this.reportError(error, interactive, provider);
      return undefined;
    }
  }

  private async runtimeGateStillOpen(
    document: vscode.TextDocument,
    ready: ReadyClient,
    operation?: ReviewOptions["operation"] | "inline" | "manual",
  ): Promise<boolean> {
    const gateMatches = (): boolean => {
      const config = readConfig(document.uri);
      const currentProvider = providerContextOrUndefined(config);
      return (
        this.gateRevision === ready.gateRevision &&
        !this.disposed &&
        config.aiWritingEnabled &&
        vscode.workspace.isTrusted &&
        currentProvider !== undefined &&
        sameProviderContext(currentProvider, ready.provider) &&
        this.hasConsent(currentProvider) &&
        this.isStaticScope(document) &&
        (operation !== "automatic" || config.aiWritingAutomaticReview) &&
        (operation !== "inline" || config.aiWritingInlineCompletions) &&
        sameAIWritingConfig(config, ready.config)
      );
    };
    if (!gateMatches()) {
      return false;
    }
    const apiKey = await this.context.secrets.get(ready.provider.secretKey);
    return (
      apiKey !== undefined &&
      secretFingerprint(apiKey) === ready.secretFingerprint &&
      gateMatches()
    );
  }

  private isStaticScope(document: vscode.TextDocument): boolean {
    return isAIWritingDocument(document, readConfig(document.uri));
  }

  private canExposeIssues(document: vscode.TextDocument): boolean {
    return !document.isClosed &&
      vscode.workspace.isTrusted &&
      readConfig(document.uri).aiWritingEnabled &&
      this.isStaticScope(document);
  }

  private isPersistableDocument(document: vscode.TextDocument): boolean {
    return !document.isClosed &&
      (document.uri.scheme === "file" || document.uri.scheme === "vscode-remote") &&
      document.uri.path.toLowerCase().endsWith(".tex");
  }

  private restoreEpoch(uriText: string): number {
    return this.restoreEpochs.get(uriText) ?? 0;
  }

  private invalidateRestore(uri: vscode.Uri): void {
    const uriText = uri.toString();
    this.restoreEpochs.set(uriText, this.restoreEpoch(uriText) + 1);
  }

  private hasConsent(provider: ProviderContext): boolean {
    return this.context.globalState.get<boolean>(provider.consentKey, false);
  }

  private async ensureConsent(provider: ProviderContext): Promise<boolean> {
    if (this.hasConsent(provider)) {
      return true;
    }
    const providerNotice = provider.id === "deepseek"
      ? provider.isOfficialDefault
        ? `DeepSeek 官方 API ${provider.destination}；该 API 单独计费`
        : `DeepSeek Chat Completions 兼容地址 ${provider.destination}；该地址可能由第三方运营，TeXLeaf 无法保证运营方的存储、训练、数据政策或计费行为`
      : provider.openAIBaseUrl === OPENAI_API_BASE_URL
      ? `OpenAI 官方 Responses API ${provider.destination}；OpenAI API 与 ChatGPT/Codex 订阅分别计费，TeXLeaf 会请求 store:false`
      : `Responses API 兼容地址 ${provider.destination}；该地址可能由第三方运营，TeXLeaf 会请求 store:false，但无法保证运营方的存储、训练、数据政策或计费行为`;
    const choice = await vscode.window.showWarningMessage(
      `启用 TeXLeaf AI 写作后，扩展会把本地提取并遮罩过的 .tex 当前编辑器正文发送到 ${providerNotice}，用于语法检查、改写或补全；发送内容可能包含尚未保存到磁盘的编辑。数学、引用、标签、URL、注释和代码环境会尽量在本地排除；复杂自定义宏仍需你复核。ChatGPT/Codex 订阅不等于 API 额度。是否同意把正文发送到这个目标？`,
      { modal: true },
      "同意并继续",
    );
    if (choice !== "同意并继续") {
      return false;
    }
    await this.context.globalState.update(provider.consentKey, true);
    return true;
  }

  private async promptAndStoreApiKey(
    provider: ProviderContext,
    resource = vscode.window.activeTextEditor?.document.uri,
  ): Promise<boolean> {
    const apiKey = await vscode.window.showInputBox({
      title: `TeXLeaf · ${provider.label} API Key`,
      prompt: `此 Key 只用于 ${provider.destination}，并保存到当前 VS Code 环境的 SecretStorage；不会同步或写入设置。`,
      placeHolder: `粘贴 ${provider.label} 或兼容服务的 API Key`,
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return "请输入 API Key。";
        }
        if (trimmed.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
          return "API Key 格式无效。";
        }
        return undefined;
      },
    });
    if (apiKey === undefined) {
      return false;
    }
    if (!currentProviderMatches(provider, resource)) {
      void vscode.window.showWarningMessage(
        "AI 服务商或 Base URL 已变化；输入的 API Key 未保存，请重新运行命令。",
      );
      return false;
    }
    const trimmed = apiKey.trim();
    try {
      // Constructor validation is local and never contacts the provider.
      createAIWritingClient(provider, trimmed);
    } catch (error: unknown) {
      this.reportError(error, true, provider);
      return false;
    }
    await this.context.secrets.store(provider.secretKey, trimmed);
    void vscode.window.showInformationMessage(
      `${provider.label} API Key 已保存到 VS Code SecretStorage；它不会跨设备同步。`,
    );
    return true;
  }

  private async requireActiveEditor(): Promise<vscode.TextEditor | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
      void vscode.window.showInformationMessage("请先打开一个已命名的 .tex 文件。");
      return undefined;
    }
    return editor;
  }

  private async updateEnabledSetting(
    enabled: boolean,
    resource = vscode.window.activeTextEditor?.document.uri,
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration("texleaf", resource);
    // AI networking is a user/Profile decision. Never write a repository-level
    // value which another workspace can commit or silently reactivate later.
    await configuration.update(
      "aiWriting.enabled",
      enabled,
      vscode.ConfigurationTarget.Global,
    );
  }

  private startRequest(key: string): AbortController {
    this.requests.get(key)?.abort();
    const controller = new AbortController();
    this.requests.set(key, controller);
    return controller;
  }

  private captureReviewSnapshot(document: vscode.TextDocument): ReviewSnapshot {
    return {
      source: document.getText(),
      version: document.version,
      generation: this.generation(document.uri),
    };
  }

  private retainUnaffectedIssues(
    event: vscode.TextDocumentChangeEvent,
  ): readonly AiProseSegment[] {
    const uriText = event.document.uri.toString();
    const previousSource = this.documentSources.get(uriText);
    const newSource = event.document.getText();
    this.documentSources.set(uriText, {
      version: event.document.version,
      source: newSource,
    });
    const existing = this.issueState.get(uriText);
    const previousDirty = this.pendingDirtySentences.get(uriText);
    const retentionPreparation = chooseAiIssueRetentionPreparation(
      previousSource?.source.length,
      newSource.length,
      event.contentChanges.length,
      MAX_SYNCHRONOUS_ISSUE_RETENTION_CHARACTERS,
    );
    if (retentionPreparation !== "retain") {
      this.issueState.delete(uriText);
      this.clearSelectedIssue(uriText);
      this.refreshIssueDecorations(event.document.uri);
      this.pendingDirtySentences.delete(uriText);
      this.scheduleIssuePersistence(event.document.uri, event.document.version, []);
      if (retentionPreparation === "discard") {
        return [];
      }
      return this.fallbackDirtySentence(event.document, newSource, event.contentChanges);
    }
    if (previousSource === undefined) {
      // `retain` requires a previous source by construction. Keep the caller
      // fail-closed if that pure routing invariant is ever changed.
      return [];
    }
    const sourceIssues = existing?.version === previousSource.version
      ? existing.issues
      : [];
    const dirtyRanges = previousDirty?.version === previousSource.version
      ? previousDirty.ranges
      : [];
    const plan = planAiIssueRetention(
      previousSource.source,
      newSource,
      event.contentChanges.map((change) => ({
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      })),
      sourceIssues.map((issue) => ({
        key: issue.id,
        start: issue.sourceStart,
        end: issue.sourceEnd,
        original: issue.original,
      })),
      dirtyRanges,
    );
    if (plan === undefined) {
      this.issueState.delete(uriText);
      this.clearSelectedIssue(uriText);
      this.refreshIssueDecorations(event.document.uri);
      this.pendingDirtySentences.delete(uriText);
      this.scheduleIssuePersistence(event.document.uri, event.document.version, []);
      this.output.debug(
        "AI 增量保留无法无歧义重建本次文本事务；旧问题已安全失效。",
      );
      return this.fallbackDirtySentence(event.document, newSource, event.contentChanges);
    }

    const issuesById = new Map(sourceIssues.map((issue) => [issue.id, issue]));
    const retained: StoredIssue[] = [];
    for (const mapped of plan.retained) {
      const issue = issuesById.get(mapped.key);
      if (issue === undefined) {
        continue;
      }
      const range = new vscode.Range(
        event.document.positionAt(mapped.start),
        event.document.positionAt(mapped.end),
      );
      const fingerprint = issueFingerprint(
        event.document.uri,
        mapped.start,
        mapped.end,
        issue.original,
        issue.replacement,
        issue.category,
      );
      retained.push({
        ...issue,
        // The retention plan proved this is the same unaffected suggestion at
        // a safely remapped location. Keep its action identity stable so an
        // already-rendered Tree row cannot become stale merely because text
        // before the issue shifted its absolute offset.
        id: issue.id,
        fingerprint,
        documentVersion: event.document.version,
        range,
        sourceStart: mapped.start,
        sourceEnd: mapped.end,
      });
    }
    this.setIssueState(event.document.uri, event.document.version, retained, false);
    this.setPendingDirtyRanges(
      event.document.uri,
      event.document.version,
      plan.dirtyRanges,
    );
    return plan.dirtySegments;
  }

  private fallbackDirtySentence(
    document: vscode.TextDocument,
    source: string,
    changes: readonly vscode.TextDocumentContentChangeEvent[],
  ): readonly AiProseSegment[] {
    const prose = extractAiProseDocument(source);
    const unique = new Map<string, AiProseSegment>();
    for (const change of changes) {
      const approximateOffset = Math.max(
        0,
        Math.min(
          source.length,
          change.rangeOffset + Math.max(0, change.text.length - 1),
        ),
      );
      const segment = findAiProseSentenceSegmentForIdleReview(
        source,
        prose,
        approximateOffset,
      );
      if (segment !== undefined) {
        unique.set(`${segment.sourceStart}:${segment.sourceEnd}`, segment);
      }
    }
    const segments = [...unique.values()].sort((left, right) =>
      left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    );
    this.setPendingDirtyRanges(
      document.uri,
      document.version,
      segments.map((segment) => ({
        start: segment.sourceStart,
        end: segment.sourceEnd,
      })),
    );
    return segments;
  }

  private setPendingDirtyRanges(
    uri: vscode.Uri,
    version: number,
    dirtyRanges: readonly AiProseOffsetRange[],
  ): void {
    const unique = new Map<string, AiProseOffsetRange>();
    for (const range of dirtyRanges) {
      unique.set(`${range.start}:${range.end}`, range);
    }
    const ranges = [...unique.values()]
      .sort((left, right) => left.start - right.start || left.end - right.end);
    if (ranges.length === 0) {
      this.pendingDirtySentences.delete(uri.toString());
      return;
    }
    this.pendingDirtySentences.set(uri.toString(), {
      version,
      ranges,
      // Every text transaction can change sentence identity, including a
      // punctuation split/merge, so review progress never crosses versions.
      reviewedSentenceKeys: new Set<string>(),
    });
  }

  private scheduleNextDirtyReview(
    document: vscode.TextDocument,
    version: number,
  ): void {
    if (document.isClosed || document.version !== version) {
      return;
    }
    const pending = this.pendingDirtySentences.get(document.uri.toString());
    const next = pending?.version === version ? pending.ranges[0] : undefined;
    if (next !== undefined) {
      this.scheduleAutomaticReview(document, next.start, false, "edit");
    }
  }

  private markDirtySegmentsReviewed(
    document: vscode.TextDocument,
    version: number,
    reviewed: readonly AiProseSegment[],
  ): void {
    const key = document.uri.toString();
    const pending = this.pendingDirtySentences.get(key);
    if (pending?.version !== version || document.version !== version) {
      return;
    }
    const progress = advanceAiDirtyReviewProgress(
      extractAiProseDocument(document.getText()),
      pending.ranges,
      pending.reviewedSentenceKeys,
      reviewed,
    );
    if (progress.remainingRanges.length === 0) {
      this.pendingDirtySentences.delete(key);
    } else {
      this.pendingDirtySentences.set(key, {
        version,
        ranges: progress.remainingRanges,
        reviewedSentenceKeys: progress.reviewedSentenceKeys,
      });
    }
  }

  private rememberDocumentSource(document: vscode.TextDocument): void {
    if (!this.isPersistableDocument(document)) {
      return;
    }
    this.documentSources.set(document.uri.toString(), {
      version: document.version,
      source: document.getText(),
    });
  }

  private async restoreDocumentIssues(
    document: vscode.TextDocument,
  ): Promise<void> {
    if (!this.canExposeIssues(document) || this.disposed) {
      return;
    }
    const uriText = document.uri.toString();
    const source = document.getText();
    const version = document.version;
    const restoreEpoch = this.restoreEpoch(uriText);
    const globalRestoreEpoch = this.globalRestoreEpoch;
    const record = await this.persistence.read(uriText);
    if (
      record === undefined ||
      this.disposed ||
      document.isClosed ||
      document.version !== version ||
      document.getText() !== source ||
      this.restoreEpoch(uriText) !== restoreEpoch ||
      this.globalRestoreEpoch !== globalRestoreEpoch ||
      !this.canExposeIssues(document) ||
      this.issueState.has(uriText)
    ) {
      return;
    }
    const restored = restorePersistedAiIssues(record, source);
    if (restored.issues.length === 0) {
      // A source mismatch, protected range, or otherwise stale record is never
      // relocated by guesswork. Replace a non-empty record with an exact
      // current-source tombstone so it cannot be retried on every activation.
      if (record.issues.length > 0) {
        this.scheduleIssuePersistence(document.uri, version, []);
      }
      return;
    }
    const issues: StoredIssue[] = restored.issues.map((issue) => {
      const fingerprint = issueFingerprint(
        document.uri,
        issue.start,
        issue.end,
        issue.original,
        issue.replacement,
        issue.category,
      );
      return {
        ...issue,
        // Persisted IDs are untrusted and may refer to a previous extension
        // session. Restored issues begin a fresh command lineage, which is then
        // kept stable only across retention mappings proven safe this session.
        id: createAiIssueActionId(fingerprint, version),
        fingerprint,
        documentVersion: version,
        range: new vscode.Range(
          document.positionAt(issue.start),
          document.positionAt(issue.end),
        ),
        sourceStart: issue.start,
        sourceEnd: issue.end,
        severity: issue.severity as vscode.DiagnosticSeverity,
      };
    });
    // Restoration is a read operation. Do not touch savedAt or rewrite the
    // same non-empty record: doing so can make stale state appear newer than a
    // clear performed by another VS Code window.
    this.setIssueState(document.uri, version, issues, true, false);
    if (issues.length !== record.issues.length) {
      // The current validator may be stricter than the version which created
      // this exact-source cache (for example a truncated `one take` range whose
      // longer replacement `one takes` is already present). Rewrite only when
      // sanitization actually removed entries so the invalid issue does not
      // need to be rejected again after every restart.
      this.scheduleIssuePersistence(document.uri, version, issues);
    }
    this.output.debug(
      `已从本机配置存储恢复 ${issues.length} 条 AI 写作问题（${
        restored.exactSource ? "源文件未变化" : "未恢复跨源问题"
      }）。`,
    );
  }

  private scheduleIssuePersistence(
    uri: vscode.Uri,
    version: number,
    issues: readonly StoredIssue[],
  ): void {
    const uriText = uri.toString();
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uriText,
    );
    const sourceSnapshot = this.documentSources.get(uriText);
    const source = document?.version === version
      ? document.getText()
      : sourceSnapshot?.version === version
      ? sourceSnapshot.source
      : undefined;
    if (source === undefined) {
      return;
    }
    let record = createPersistedAiIssueRecord(
      uriText,
      source,
      version,
      issues.map((issue) => ({
        id: issue.id,
        fingerprint: issue.fingerprint,
        start: issue.sourceStart,
        end: issue.sourceEnd,
        original: issue.original,
        replacement: issue.replacement,
        message: issue.message,
        explanation: issue.explanation,
        category: issue.category,
        severity: issue.severity,
      })),
    );
    if (record === undefined && issues.length > 0) {
      // A defensive persistence validation failure must not leave an older
      // valid-looking issue list on disk. Prefer an empty current-source
      // tombstone over resurrecting stale suggestions on the next restart.
      record = createPersistedAiIssueRecord(uriText, source, version, []);
    }
    if (record !== undefined) {
      this.persistence.schedule(record);
    }
  }

  private mergeIssuesAfterReview(
    uri: vscode.Uri,
    version: number,
    segment: AiProseSegment,
    replacements: readonly StoredIssue[],
    dirtyRanges?: readonly AiProseOffsetRange[],
  ): readonly StoredIssue[] {
    const existing = this.issueState.get(uri.toString());
    if (existing?.version !== version) {
      return replacements;
    }
    const replacementScopes = dirtyRanges === undefined
      ? [{ start: segment.sourceStart, end: segment.sourceEnd }]
      : dirtyRanges.filter((range) => offsetRangeTouchesSegment(range, segment));
    const newIssueRanges = replacements.map((issue) => ({
      start: issue.sourceStart,
      end: issue.sourceEnd,
    }));
    const retained = existing.issues.filter((issue) =>
      !shouldReplaceAiIssueAfterReview(
        { start: issue.sourceStart, end: issue.sourceEnd },
        replacementScopes,
        newIssueRanges,
      )
    );
    return [...retained, ...replacements];
  }

  private cancelAutomaticReview(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = this.automaticTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.automaticTimers.delete(key);
    }
    this.pendingOffsets.delete(key);
    this.issueListEmitter.fire();
  }

  private cancelAllAutomaticReviews(): void {
    for (const timer of this.automaticTimers.values()) {
      clearTimeout(timer);
    }
    this.automaticTimers.clear();
    this.pendingOffsets.clear();
    this.issueListEmitter.fire();
  }

  private finishRequest(key: string, controller: AbortController): void {
    if (this.requests.get(key) === controller) {
      this.requests.delete(key);
    }
  }

  private abortForUri(uri: vscode.Uri): void {
    const prefix = `${uri.toString()}\u0000`;
    for (const [key, controller] of this.requests) {
      if (key.startsWith(prefix)) {
        controller.abort();
        this.requests.delete(key);
      }
    }
  }

  private abortAll(): void {
    for (const controller of this.requests.values()) {
      controller.abort();
    }
    this.requests.clear();
  }

  private generation(uri: vscode.Uri): number {
    return this.generations.get(uri.toString()) ?? 0;
  }

  private bumpGeneration(uri: vscode.Uri): void {
    const key = uri.toString();
    this.generations.set(key, this.generation(uri) + 1);
  }

  private forgetDocument(document: vscode.TextDocument): void {
    const uriText = document.uri.toString();
    this.invalidateRestore(document.uri);
    // A close event removes only in-memory UI state. Flush the last queued
    // profile-local snapshot; never delete it merely because the editor closed.
    void this.persistence.flush(uriText);
    const timer = this.automaticTimers.get(uriText);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.automaticTimers.delete(uriText);
    }
    this.pendingOffsets.delete(uriText);
    this.pendingDirtySentences.delete(uriText);
    this.documentSources.delete(uriText);
    this.abortForUri(document.uri);
    this.issueState.delete(uriText);
    this.clearSelectedIssue(uriText);
    this.reviewSummaries.delete(uriText);
    this.generations.delete(uriText);
    this.automaticReviewKeys.delete(uriText);
    this.automaticReviewLimitVersions.delete(uriText);
    this.refreshIssueDecorations(document.uri);
    this.issueListEmitter.fire();
  }

  private clearAllDiagnostics(): void {
    // Clearing is a durable user/configuration action. Persist empty records
    // before dropping memory state so a later VS Code restart cannot restore
    // suggestions which the user already cleared or invalidated by changing
    // the provider, model, language, style, consent, or API key.
    this.globalRestoreEpoch += 1;
    const clearedUris = new Set<string>();
    for (const document of vscode.workspace.textDocuments) {
      if (!this.isPersistableDocument(document)) {
        continue;
      }
      const uriText = document.uri.toString();
      clearedUris.add(uriText);
      this.invalidateRestore(document.uri);
      this.scheduleIssuePersistence(document.uri, document.version, []);
    }
    for (const [uriText, state] of this.issueState) {
      if (clearedUris.has(uriText)) {
        continue;
      }
      try {
        const uri = vscode.Uri.parse(uriText, true);
        this.invalidateRestore(uri);
        this.scheduleIssuePersistence(uri, state.version, []);
      } catch {
        // An invalid internal URI is already fail-closed by clearing memory.
      }
    }
    this.issueState.clear();
    this.clearSelectedIssue();
    this.reviewSummaries.clear();
    this.automaticReviewKeys.clear();
    this.automaticReviewLimitVersions.clear();
    this.pendingDirtySentences.clear();
    this.refreshIssueDecorations();
    this.issueListEmitter.fire();
    void this.persistence.clearAllRecords();
  }

  private reportError(
    error: unknown,
    interactive: boolean,
    providerContext?: ProviderContext,
  ): void {
    if (this.disposed) {
      return;
    }
    const clientError = asAIClientError(error);
    if (clientError?.kind === "cancelled") {
      return;
    }
    const provider = clientError === undefined
      ? "AI"
      : clientError instanceof OpenAIClientError
      ? "OpenAI"
      : "DeepSeek";
    const kind = clientError?.kind ?? "unknown";
    const code = clientError === undefined ? "unknown" : safeErrorCode(clientError.code);
    const message = friendlyError(error);
    const providerIdentity = providerContext?.identity ?? provider;
    this.output.warn(`AI 写作请求失败 [${providerIdentity}/${kind}/${code}]：${message}`);
    if (!interactive) {
      const now = Date.now();
      const cooldownKey = `${providerIdentity}:${kind}:${code}`;
      const next = this.errorCooldown.get(cooldownKey) ?? 0;
      if (next > now) {
        return;
      }
      this.errorCooldown.set(cooldownKey, now + 60_000);
    }
    if (kind === "authentication") {
      void vscode.window
        .showErrorMessage(`TeXLeaf AI：${message}`, "重新设置 API Key")
        .then((choice) => {
          if (choice === "重新设置 API Key") {
            if (providerContext === undefined) {
              void this.setApiKey();
            } else {
              void this.promptAndStoreApiKey(providerContext);
            }
          }
        });
    } else {
      void vscode.window.showWarningMessage(`TeXLeaf AI：${message}`);
    }
  }

  private logUsage(
    operation: string,
    model: string,
    usage: DeepSeekUsage | undefined,
  ): void {
    if (usage === undefined) {
      this.output.debug(`AI ${operation} 完成：model=${model}；未返回 usage。`);
      return;
    }
    this.output.debug(
      `AI ${operation} 完成：model=${model}, input=${usage.inputTokens}, output=${usage.outputTokens}, total=${usage.totalTokens} tokens。`,
    );
  }

  private async updateStatus(editor: vscode.TextEditor | undefined): Promise<void> {
    if (this.disposed) {
      return;
    }
    const generation = ++this.statusGeneration;
    if (
      editor === undefined ||
      !this.isStaticScope(editor.document)
    ) {
      this.status.hide();
      return;
    }
    const config = readConfig(editor.document.uri);
    let provider: ProviderContext;
    try {
      provider = providerContext(config);
    } catch (error: unknown) {
      if (generation !== this.statusGeneration || this.disposed) {
        return;
      }
      this.status.text = "$(warning) TeXLeaf AI";
      this.status.tooltip = friendlyError(error);
      this.status.show();
      return;
    }
    const hasKey = (await this.context.secrets.get(provider.secretKey)) !== undefined;
    if (
      generation !== this.statusGeneration ||
      this.disposed ||
      !sameProviderContext(
        providerContextOrUndefined(readConfig(editor.document.uri)),
        provider,
      )
    ) {
      return;
    }
    const uriText = editor.document.uri.toString();
    const checking = this.requests.has(requestKeyFor(editor.document.uri, "review"));
    const scheduled = this.automaticTimers.has(uriText);
    const pending = this.pendingDirtySentences.get(uriText);
    const pendingCount = pending?.version === editor.document.version
      ? pending.ranges.length
      : 0;
    const state = this.issueState.get(uriText);
    const currentSource = state?.version === editor.document.version
      ? editor.document.getText()
      : undefined;
    const issueCount = currentSource !== undefined && state !== undefined
      ? state.issues.filter((issue) =>
        storedIssueMatchesCurrentSource(
          editor.document,
          currentSource,
          issue,
        )
      ).length
      : 0;
    if (!config.aiWritingEnabled) {
      this.status.text = "$(circle-slash) TeXLeaf AI";
      this.status.tooltip = "AI 写作助手已关闭；点击打开 AI 写作问题列表。";
    } else if (!vscode.workspace.isTrusted) {
      this.status.text = "$(shield) TeXLeaf AI";
      this.status.tooltip = "未信任工作区中 AI 写作被强制停用。";
    } else if (!this.hasConsent(provider) || !hasKey) {
      this.status.text = "$(key) TeXLeaf AI";
      this.status.tooltip = `需要确认正文传输并设置 ${provider.label} API Key。`;
    } else if (checking) {
      this.status.text = "$(sync~spin) TeXLeaf AI";
      this.status.tooltip = `${provider.label} 正在检查当前正文段落；点击打开问题列表。`;
    } else if (scheduled) {
      this.status.text = "$(watch) TeXLeaf AI";
      this.status.tooltip = `等待输入停顿 ${config.aiWritingReviewDelayMs} ms 后检查改动句子；点击打开问题列表。`;
    } else if (pendingCount > 0) {
      this.status.text = `$(history) TeXLeaf AI · ${issueCount}`;
      this.status.tooltip = `${pendingCount} 个改动句子仍待局部复检；其他 ${issueCount} 个问题继续保留。`;
    } else {
      this.status.text = issueCount > 0
        ? `$(sparkle) TeXLeaf AI · ${issueCount}`
        : "$(sparkle) TeXLeaf AI";
      this.status.tooltip = `${provider.label} · ${provider.model} · ${writingStyle(config)} · 点击打开问题列表`;
    }
    this.status.show();
  }
}

function providerContext(config: TeXLeafConfig): ProviderContext {
  if (config.aiWritingProvider === "deepseek") {
    const providerIdentity = deepSeekProviderIdentityFor(
      config.aiWritingDeepSeekBaseUrl,
    );
    return {
      id: "deepseek",
      label: "DeepSeek",
      model: config.aiWritingDeepSeekModel,
      destination: providerIdentity.endpoint,
      identity: `deepseek:${providerIdentity.identity}`,
      secretKey: providerIdentity.secretKey,
      consentKey: providerIdentity.consentKey,
      deepSeekBaseUrl: providerIdentity.canonicalBaseUrl,
      isOfficialDefault:
        providerIdentity.canonicalBaseUrl === DEEPSEEK_API_BASE_URL,
    };
  }

  const providerIdentity = openAIProviderIdentityFor(
    config.aiWritingOpenAIBaseUrl,
  );
  const model = normalizeOpenAIModel(config.aiWritingOpenAIModel);
  return {
    id: "openai",
    label: "OpenAI",
    model,
    destination: providerIdentity.endpoint,
    identity: `openai:${providerIdentity.identity}`,
    secretKey: providerIdentity.secretKey,
    consentKey: providerIdentity.consentKey,
    openAIBaseUrl: providerIdentity.canonicalBaseUrl,
  };
}

function providerContextOrUndefined(
  config: TeXLeafConfig,
): ProviderContext | undefined {
  try {
    return providerContext(config);
  } catch {
    return undefined;
  }
}

function currentProviderMatches(
  expected: ProviderContext,
  resource: vscode.Uri | undefined,
): boolean {
  return sameProviderContext(
    providerContextOrUndefined(readConfig(resource)),
    expected,
  );
}

function sameProviderContext(
  left: ProviderContext | undefined,
  right: ProviderContext,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.identity === right.identity &&
    left.model === right.model &&
    left.destination === right.destination &&
    left.secretKey === right.secretKey &&
    left.consentKey === right.consentKey
  );
}

function createAIWritingClient(
  provider: ProviderContext,
  apiKey: string,
): AIWritingClient {
  if (provider.id === "deepseek") {
    const model = provider.model === "deepseek-v4-pro"
      ? "deepseek-v4-pro"
      : "deepseek-v4-flash";
    return new DeepSeekClient({
      apiKey,
      model,
      baseUrl: provider.deepSeekBaseUrl,
    });
  }
  return new OpenAIClient({
    apiKey,
    model: provider.model,
    baseUrl: provider.openAIBaseUrl,
  });
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function issueFingerprint(
  uri: vscode.Uri,
  sourceStart: number,
  sourceEnd: number,
  original: string,
  replacement: string,
  category: string,
): string {
  return sha256Hex([
    "texleaf-ai-issue-v1",
    uri.toString(),
    String(sourceStart),
    String(sourceEnd),
    original,
    replacement,
    category,
  ].join("\u0000"));
}

/**
 * Revalidate every issue at the point where it can become visible or
 * actionable. State version checks alone are insufficient: an edit can leave
 * `original` as a prefix of text that already equals the longer replacement.
 */
function storedIssueMatchesCurrentSource(
  document: vscode.TextDocument,
  source: string,
  issue: StoredIssue,
): boolean {
  return document.offsetAt(issue.range.start) === issue.sourceStart &&
    document.offsetAt(issue.range.end) === issue.sourceEnd &&
    source.slice(issue.sourceStart, issue.sourceEnd) === issue.original &&
    !aiIssueReplacementAlreadyPresent(
      source,
      issue.sourceStart,
      issue.sourceEnd,
      issue.original,
      issue.replacement,
    );
}

/** Return only suggestions which remain actionable in this exact document. */
function currentSafeIssues(
  document: vscode.TextDocument,
  state: DocumentIssues | undefined,
): readonly StoredIssue[] {
  if (state?.version !== document.version) {
    return [];
  }
  const source = document.getText();
  return state.issues.filter((issue) =>
    issue.documentVersion === document.version &&
    storedIssueMatchesCurrentSource(document, source, issue)
  );
}

function storedIssuesOverlap(issues: readonly StoredIssue[]): boolean {
  const ranges = issues.map((issue) => ({
    start: issue.sourceStart,
    end: issue.sourceEnd,
  }));
  for (let leftIndex = 0; leftIndex < ranges.length; leftIndex += 1) {
    const left = ranges[leftIndex];
    if (left === undefined) {
      return true;
    }
    for (let rightIndex = leftIndex + 1; rightIndex < ranges.length; rightIndex += 1) {
      const right = ranges[rightIndex];
      if (
        right === undefined ||
        aiIssueRangesOverlap(left, right)
      ) {
        return true;
      }
    }
  }
  return false;
}

function secretFingerprint(value: string): string {
  return sha256Hex(value);
}

type AIClientError = DeepSeekClientError | OpenAIClientError;

function asAIClientError(error: unknown): AIClientError | undefined {
  return error instanceof DeepSeekClientError || error instanceof OpenAIClientError
    ? error
    : undefined;
}

function safeErrorCode(value: string | number): string {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : "unknown";
  }
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value)
    ? value
    : "unknown";
}

function requestKeyFor(uri: vscode.Uri, operation: string): string {
  return `${uri.toString()}\u0000${operation}`;
}

function offsetRangeTouchesSegment(
  range: AiProseOffsetRange,
  segment: AiProseSegment,
): boolean {
  if (range.start === range.end) {
    return (
      range.start >= segment.sourceStart &&
      range.start <= segment.sourceEnd
    );
  }
  return (
    range.start < segment.sourceEnd &&
    range.end > segment.sourceStart
  );
}

function issueRangeContainsPosition(
  issueRange: vscode.Range,
  position: vscode.Position,
): boolean {
  return issueRange.isEmpty
    ? issueRange.start.isEqual(position)
    : issueRange.contains(position);
}

function editorRangeTouchesIssue(
  requested: vscode.Range,
  issueRange: vscode.Range,
): boolean {
  if (requested.isEmpty) {
    return issueRangeContainsPosition(issueRange, requested.start);
  }
  if (issueRange.isEmpty) {
    return requested.contains(issueRange.start);
  }
  return requested.intersection(issueRange) !== undefined;
}

function decorationRangeForIssue(
  document: vscode.TextDocument,
  range: vscode.Range,
): vscode.Range {
  if (!range.isEmpty) {
    return range;
  }
  const line = document.lineAt(range.start.line);
  if (range.start.character < line.text.length) {
    return new vscode.Range(
      range.start,
      range.start.translate(0, 1),
    );
  }
  if (range.start.character > 0) {
    return new vscode.Range(
      range.start.translate(0, -1),
      range.start,
    );
  }
  return range;
}

function paragraphSegmentsAt(
  segments: readonly AiProseSegment[],
  offset: number,
): readonly AiProseSegment[] {
  return segments.filter((segment) =>
    offset >= segment.sourceStart && offset <= segment.sourceEnd
  ).slice(0, 1);
}

function sliceSegmentsForRange(
  segments: readonly AiProseSegment[],
  sourceStart: number,
  sourceEnd: number,
): readonly AiProseSegment[] {
  const result: AiProseSegment[] = [];
  for (const segment of segments) {
    const start = Math.max(sourceStart, segment.sourceStart);
    const end = Math.min(sourceEnd, segment.sourceEnd);
    if (start >= end) {
      continue;
    }
    const relativeStart = start - segment.sourceStart;
    const relativeEnd = end - segment.sourceStart;
    const editableRanges = segment.editableRanges
      .map((range) => ({
        start: Math.max(range.start, relativeStart) - relativeStart,
        end: Math.min(range.end, relativeEnd) - relativeStart,
      }))
      .filter((range) => range.start < range.end);
    const text = segment.text.slice(relativeStart, relativeEnd);
    if (!/[\p{L}\p{N}]/u.test(text)) {
      continue;
    }
    result.push({
      id: `${segment.id}-selection-${relativeStart}-${relativeEnd}`,
      text,
      sourceStart: start,
      sourceEnd: end,
      editableRanges,
    });
  }
  return result;
}

function rewriteTarget(editor: vscode.TextEditor): RewriteTarget | undefined {
  const document = editor.document;
  const source = document.getText();
  const prose = extractAiProseDocument(source);
  let sourceStart: number;
  let sourceEnd: number;
  let segment: AiProseSegment | undefined;
  if (editor.selection.isEmpty) {
    const selection = findAiProseSentenceAtOffset(
      prose,
      document.offsetAt(editor.selection.active),
    );
    if (selection === undefined) {
      return undefined;
    }
    sourceStart = selection.sourceStart;
    sourceEnd = selection.sourceEnd;
    segment = prose.segments.find((candidate) =>
      candidate.id === selection.segmentId
    );
  } else {
    sourceStart = document.offsetAt(editor.selection.start);
    sourceEnd = document.offsetAt(editor.selection.end);
    segment = prose.segments.find((candidate) =>
      sourceStart >= candidate.sourceStart && sourceEnd <= candidate.sourceEnd
    );
  }
  if (segment === undefined || sourceStart >= sourceEnd) {
    return undefined;
  }
  const relativeStart = sourceStart - segment.sourceStart;
  const relativeEnd = sourceEnd - segment.sourceStart;
  const entirelyEditable = segment.editableRanges.some((range) =>
    relativeStart >= range.start && relativeEnd <= range.end
  );
  if (!entirelyEditable) {
    return undefined;
  }
  const text = source.slice(sourceStart, sourceEnd);
  if (!safePlainText(text, 32_768, false)) {
    return undefined;
  }
  return {
    range: new vscode.Range(
      document.positionAt(sourceStart),
      document.positionAt(sourceEnd),
    ),
    text,
  };
}

async function chooseRewriteInstruction(
  providerLabel: ProviderContext["label"],
): Promise<string | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: "提高学术表达", instruction: "Improve academic clarity and grammar while preserving meaning." },
      { label: "修复语法与拼写", instruction: "Correct grammar, spelling, and punctuation with minimal rewriting." },
      { label: "改得更简洁", instruction: "Make the prose concise and direct while preserving all factual claims." },
      { label: "改得更自然", instruction: "Make the prose natural and fluent while preserving meaning." },
      { label: "自定义要求…", instruction: "" },
    ],
    { title: "选择 AI 改写目标", placeHolder: "原文不会在确认前被修改" },
  );
  if (choice === undefined) {
    return undefined;
  }
  if (choice.instruction.length > 0) {
    return choice.instruction;
  }
  const custom = await vscode.window.showInputBox({
    title: "AI 改写要求",
    prompt: `不要在这里粘贴 API Key；要求会与所选正文一起发送到 ${providerLabel}。`,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const normalized = value.trim();
      if (normalized.length === 0) {
        return "请输入改写要求。";
      }
      if (normalized.length > 1_024 || /[\r\n\u0000]/u.test(normalized)) {
        return "改写要求必须是 1–1024 字符的单行文本。";
      }
      return undefined;
    },
  });
  return custom?.trim();
}

function isEditableInsertion(segment: AiProseSegment, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > segment.text.length) {
    return false;
  }
  const left = offset > 0 && segment.editableRanges.some((range) =>
    offset - 1 >= range.start && offset - 1 < range.end
  );
  const right = offset < segment.text.length && segment.editableRanges.some((range) =>
    offset >= range.start && offset < range.end
  );
  if (offset === 0) {
    return right;
  }
  if (offset === segment.text.length) {
    return left;
  }
  return left && right;
}

function completionContextIsUseful(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (trimmed.length < 8 || !/[\p{L}\p{N}]/u.test(trimmed)) {
    return false;
  }
  const last = prefix[prefix.length - 1] ?? "";
  return /[\p{L}\p{N}\s,.;:!?，。；：！？]/u.test(last);
}

function safePlainText(
  value: string,
  maximumLength: number,
  allowEmpty: boolean,
): boolean {
  return (
    typeof value === "string" &&
    value.length <= maximumLength &&
    (allowEmpty || value.trim().length > 0) &&
    !/[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029]/u.test(value) &&
    !/[\u202a-\u202e\u2066-\u2069]/u.test(value) &&
    !/[\\{}$%#&_~^]/u.test(value)
  );
}

function sameAIWritingConfig(
  left: TeXLeafConfig,
  right: TeXLeafConfig,
): boolean {
  return (
    left.aiWritingEnabled === right.aiWritingEnabled &&
    left.aiWritingAutomaticReview === right.aiWritingAutomaticReview &&
    left.aiWritingInlineCompletions === right.aiWritingInlineCompletions &&
    left.aiWritingProvider === right.aiWritingProvider &&
    left.aiWritingDeepSeekModel === right.aiWritingDeepSeekModel &&
    left.aiWritingDeepSeekBaseUrl === right.aiWritingDeepSeekBaseUrl &&
    left.aiWritingOpenAIModel === right.aiWritingOpenAIModel &&
    left.aiWritingOpenAIBaseUrl === right.aiWritingOpenAIBaseUrl &&
    left.aiWritingModel === right.aiWritingModel &&
    left.aiWritingLanguage === right.aiWritingLanguage &&
    left.aiWritingStyle === right.aiWritingStyle &&
    left.aiWritingReviewDelayMs === right.aiWritingReviewDelayMs &&
    left.aiWritingCompletionDelayMs === right.aiWritingCompletionDelayMs &&
    left.aiWritingMaxParagraphLength === right.aiWritingMaxParagraphLength &&
    left.aiWritingMaxDocumentLength === right.aiWritingMaxDocumentLength
  );
}

function writingStyle(config: TeXLeafConfig): string {
  switch (config.aiWritingStyle) {
    case "academic":
      return "formal academic writing";
    case "general":
      return "clear general writing";
    case "concise":
      return "concise academic writing";
  }
}

function diagnosticSeverity(
  severity: PlannedAiProseEdit["severity"],
  category: string,
): vscode.DiagnosticSeverity {
  if (severity === "error") {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === "warning") {
    return vscode.DiagnosticSeverity.Warning;
  }
  if (severity === "hint") {
    return vscode.DiagnosticSeverity.Hint;
  }
  return category === "spelling" || category === "grammar"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Information;
}

function categoryLabel(category: string): string {
  const labels: Readonly<Record<string, string>> = {
    spelling: "拼写",
    grammar: "语法",
    punctuation: "标点",
    "word-choice": "措辞",
    clarity: "清晰度",
    style: "风格",
    consistency: "一致性",
  };
  return labels[category] ?? "写作建议";
}

function friendlyError(error: unknown): string {
  const clientError = asAIClientError(error);
  if (clientError === undefined) {
    return "请求失败，原文保持不变。";
  }
  const provider = clientError instanceof OpenAIClientError ? "OpenAI" : "DeepSeek";
  switch (clientError.kind) {
    case "authentication":
      return `${provider} API Key 无效或无权访问当前模型/接口，请重新设置。`;
    case "payment-required":
      return `${provider} 账户余额、配额或计费状态不足。`;
    case "rate-limit":
      return `${provider} 请求过于频繁，请稍后重试或提高防抖时间。`;
    case "timeout":
      return `${provider} 请求超时，请检查网络后重试。`;
    case "network":
      return `无法连接 ${provider}，请检查网络或自定义 Base URL。`;
    case "invalid-response": {
      const code = safeErrorCode(clientError.code);
      if (code === "empty-content") {
        return provider === "DeepSeek"
          ? "DeepSeek 连续两次返回空内容（TeXLeaf 已自动重试一次）；原文没有修改。"
          : "OpenAI 或兼容接口返回了空内容；原文没有修改。";
      }
      if (code === "invalid-json-output") {
        return provider === "DeepSeek"
          ? "DeepSeek 连续两次返回无效 JSON（TeXLeaf 已自动重试一次）；原文没有修改。"
          : "OpenAI 或兼容接口没有返回符合严格 Schema 的 JSON；原文没有修改。";
      }
      if (code === "refusal") {
        return `${provider} 拒绝了这次请求；原文没有修改。`;
      }
      if (code === "issue-location-ambiguous") {
        return `${provider} 返回的建议对应到多处相同原文，TeXLeaf 无法无歧义确定位置；该建议已忽略，原文没有修改。`;
      }
      if (code === "issue-original-not-found") {
        return `${provider} 返回的 original 无法在当前正文中逐字找到；TeXLeaf 不会做模糊匹配，原文没有修改。`;
      }
      if (code === "invalid-original") {
        return `${provider} 返回了没有非空原文锚点的建议；为避免把插入内容放错位置，该建议已忽略。`;
      }
      if (code === "invalid-issue-offset") {
        return `${provider} 返回的字符位置无法按 UTF-16、Unicode、UTF-8 或换行坐标安全解析；原文没有修改。`;
      }
      return `${provider} 返回内容未通过 TeXLeaf 严格校验（${code}）；原文没有修改。`;
    }
    case "truncated":
      return `${provider} 输出被截断；原文没有修改，请缩小选区。`;
    case "configuration": {
      const code = safeErrorCode(clientError.code);
      if (code === "language-too-long") {
        return "TeXLeaf 生成的语言标签超过客户端安全上限；请升级扩展或重新加载窗口后重试。";
      }
      return `AI 写作配置、模型名称、自定义 Base URL 或发送内容不符合安全限制（${code}）。`;
    }
    case "http": {
      const code = safeErrorCode(clientError.code);
      if (provider === "OpenAI" && (code === "404" || code === "405")) {
        return "当前 Base URL 没有可用的 /responses 接口；TeXLeaf 不支持仅提供 /chat/completions 的代理。";
      }
      if (provider === "OpenAI" && (code === "400" || code === "422")) {
        return "当前模型或接口未完整兼容 OpenAI Responses 与 Structured Outputs（400/422）。";
      }
      return `${provider} 或兼容服务暂时不可用（${code}）。`;
    }
    case "cancelled":
      return "请求已取消。";
  }
}

function cancellationDelay(
  milliseconds: number,
  token: vscode.CancellationToken,
): Promise<boolean> {
  if (token.isCancellationRequested) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let cancellation: vscode.Disposable | undefined;
    const timer = setTimeout(() => {
      cancellation?.dispose();
      resolve(true);
    }, milliseconds);
    cancellation = token.onCancellationRequested(() => {
      clearTimeout(timer);
      cancellation?.dispose();
      resolve(false);
    });
  });
}

function stableHash(value: string): string {
  return sha256Hex(`texleaf-ai-cache-v1\u0000${value}`);
}

function previewText(value: string, maximum: number): string {
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1)}…`;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll(/[\\`*_{}\[\]()#+\-.!|>]/gu, "\\$&");
}
