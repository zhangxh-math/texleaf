/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import {
  createMathPreviewCursorRenderInput,
  createMathPreviewRenderInput,
  resolveLatexPreviewCapability,
  resolveLatexPackagePreviewMacros,
  findVisualHeadingForLabel,
  findVisualLabelsInRange,
  innermostLatexMathRegion,
  mathPreviewMacroEnvironmentAtOffset,
  isConfiguredMatrixContext,
  isExcludedLatexContext,
  planAutoEnlargeAncestors,
  planLeftRightEnter,
  planTabout,
  planVisualAlignTab,
  planVisualEnvironmentExit,
  planVisualAutoFraction,
  planVisualSelectionFraction,
  replacementPartsToCodeMirrorSnippet,
  replacementPartsToText,
  replacementPartsToVirtualSnippet,
  resolveVisualBibliography,
  scanLatexContext,
  scanMathPreviewDocument,
  scanVisualDocumentStructure,
  selectVisualFormulaViewportBatch,
  shouldActivateVisualProviderCompletion,
  shouldRunVisualAutomaticSnippet,
  visualCompletionFollowUpCursor,
  visualFormulaViewportsKeepPriority,
  visualLatexCompletionContextAt,
  vscodeSnippetToCodeMirrorSnippet,
  vscodeSnippetToVirtualSnippet,
  type BibTeXEntry,
  type CompiledSnippet,
  type LatexContext,
  type MathPreviewFormula,
  type MathPreviewMacroEnvironment,
  type MathPreviewRenderInput,
  type MathPreviewSnapshot,
  type ReplacementPart,
  type VisualDocumentStructure,
  type VisualDocumentStructureScanOptions,
  type VisualBibliographyRecord,
  type VisualImageRecord,
  type VisualLatexCompletionContext,
  type VisualMathFragment,
  type VisualStructureRecord,
} from "./core";
import {
  LatexProjectContextService,
  type LatexProjectContext,
  type LatexProjectFile,
  type LatexProjectLabelTarget,
} from "./latexProjectContext";
import {
  createMathPreviewCursorMarker,
  resolveMathPreviewAppearance,
} from "./mathPreviewAppearance";
import { readConfig, type TeXLeafConfig } from "./config";
import {
  AIWritingController,
  TEXLEAF_AI_DIAGNOSTIC_SOURCE,
} from "./aiWritingController";
import { CitationController } from "./citationController";
import {
  replacementPartsToSnippetString,
  SnippetRuntime,
} from "./snippetRuntime";
import { TemplateManager } from "./templateManager";
import {
  VISUAL_EDITOR_PROTOCOL,
  VISUAL_EDITOR_REVEAL_DIAGNOSTIC_COMMAND,
  VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND,
  VISUAL_EDITOR_REVEAL_RANGE_COMMAND,
  type VisualEditorChange,
  type VisualEditorAiIssue,
  type VisualEditorCompletionItem,
  type VisualEditorDiagnostic,
  type VisualEditorBackground,
  type VisualEditorFocusOptions,
  type VisualEditorHostMessage,
  type VisualEditorInputAction,
  type VisualEditorSelection,
  type VisualEditorSnippetModifier,
  type VisualEditorTemplateMenuItem,
  type VisualEditorVirtualCompletionItem,
  type VisualEditorVirtualInputContext,
  type VisualEditorWebviewCommand,
  type VisualEditorWebviewMessage,
  type VisualFormulaRenderError,
  type VisualFormulaLabel,
  type VisualFormulaRecord,
  type VisualFormulaRenderResult,
} from "./visualEditorProtocol";
import { VisualEditorRenderer } from "./visualEditorRenderer";
import {
  VisualEditorSyntaxThemeResolver,
  type VisualEditorIncrementalSyntaxInput,
  type VisualEditorSyntaxLineInput,
} from "./visualEditorSyntaxTheme";
import {
  prepareLatexWorkshopVisualEditor,
  prepareLatexWorkshopVisualSave,
  provideLatexWorkshopVisualCompletionItems,
  runLatexWorkshopAutoBuildAfterVisualSave,
  runLatexWorkshopInBackground,
  type LatexWorkshopBackgroundCommand,
} from "./latexWorkshopBridge";

export const VISUAL_EDITOR_VIEW_TYPE = "texleaf.visualEditor";
export const OPEN_VISUAL_EDITOR_COMMAND = "texleaf.visualEditor.open";
export const OPEN_SOURCE_EDITOR_COMMAND = "texleaf.visualEditor.openSource";
export const VISUAL_EDITOR_BUILD_COMMAND = "texleaf.visualEditor.build";
export const VISUAL_EDITOR_VIEW_PDF_COMMAND = "texleaf.visualEditor.viewPdf";
export const VISUAL_EDITOR_SYNCTEX_COMMAND = "texleaf.visualEditor.synctex";
export const VISUAL_EDITOR_NAVIGATE_BACK_COMMAND = "texleaf.visualEditor.navigateBack";

const LATEX_WORKSHOP_EXTENSION_ID = "James-Yu.latex-workshop";
const MAX_DOCUMENT_LENGTH = 50_000_000;
// A maximum 64-level auto-enlarge cascade produces 128 delimiter edits plus
// one snippet replacement. Keep a small fixed ceiling above that contract.
const MAX_CHANGE_COUNT = 256;
const MAX_INSERTED_TEXT = 5_000_000;
const MAX_VISIBLE_FORMULAS = 48;
const VIEWPORT_FORMULA_RENDER_BATCH_SIZE = 8;
const MAX_RESIDENT_FORMULA_IDS = 384;
const MAX_VISUAL_IMAGE_PREVIEWS = 64;
const MAX_VISUAL_STRUCTURE_MATH_FRAGMENTS = 160;
const MAX_VISUAL_COMPLETION_ITEMS = 200;
const MAX_VISUAL_REFERENCE_PREVIEW_FILES = 24;
const MAX_VISUAL_PROJECT_BIBLIOGRAPHIES = 64;
const MAX_VISUAL_COMPLETION_ITEM_TEXT = 100_000;
const MAX_VISUAL_COMPLETION_TOTAL_TEXT = 1_000_000;
const MAX_VISUAL_EXTENSION_SNIPPET_FILES = 96;
const MAX_VISUAL_EXTENSION_SNIPPET_FILE_BYTES = 5_000_000;
const MAX_VISUAL_EXTENSION_SNIPPETS = 4_000;
const MAX_VISUAL_VIRTUAL_INPUT_LENGTH = 32_768;
const MAX_REFERENCE_HOVER_THEOREM_SOURCE = 12_000;
const MAX_REFERENCE_HOVER_THEOREM_FORMULAS = 24;
/**
 * Native Problems navigation first activates a normal text editor and only
 * then applies the diagnostic selection. Keep the hand-off window short so a
 * deliberate, later source-tab activation is never mistaken for a Problems
 * click.
 */
const NATIVE_PROBLEM_NAVIGATION_WINDOW_MS = 2_000;
const NATIVE_PROBLEM_SELECTION_SETTLE_MS = 40;
const VISUAL_EDITOR_GROUP_FOCUS_COMMANDS: readonly (string | undefined)[] = [
  undefined,
  "workbench.action.focusFirstEditorGroup",
  "workbench.action.focusSecondEditorGroup",
  "workbench.action.focusThirdEditorGroup",
  "workbench.action.focusFourthEditorGroup",
  "workbench.action.focusFifthEditorGroup",
  "workbench.action.focusSixthEditorGroup",
  "workbench.action.focusSeventhEditorGroup",
  "workbench.action.focusEighthEditorGroup",
];
const VISUAL_CURSOR_MARKER_COMMANDS = ["color", "rule", "mathord"] as const;
const VISUAL_CORE_LATEX_COMPLETIONS: readonly VisualCoreLatexCompletion[] = [
  {
    label: "\\begin",
    body: "\\begin{${1:environment}}\n\t$0\n\\end{$1}",
    detail: "通用 LaTeX 环境",
  },
  {
    label: "\\end",
    body: "\\end{${1:environment}}$0",
    detail: "结束 LaTeX 环境",
  },
  {
    label: "\\begin{equation}",
    body: "\\begin{equation}\n\t$0\n\\end{equation}",
    detail: "equation 环境",
  },
  {
    label: "\\begin{align}",
    body: "\\begin{align}\n\t$0\n\\end{align}",
    detail: "align 环境",
  },
  {
    label: "\\begin{theorem}",
    body: "\\begin{theorem}\n\t$0\n\\end{theorem}",
    detail: "theorem 环境",
  },
  {
    label: "\\begin{proof}",
    body: "\\begin{proof}\n\t$0\n\\end{proof}",
    detail: "proof 环境",
  },
  {
    label: "\\begin{itemize}",
    body: "\\begin{itemize}\n\t\\item $0\n\\end{itemize}",
    detail: "无序列表",
  },
  {
    label: "\\begin{enumerate}",
    body: "\\begin{enumerate}\n\t\\item $0\n\\end{enumerate}",
    detail: "有序列表",
  },
  {
    label: "\\begin{table}",
    body: "\\begin{table}[htbp]\n\t\\centering\n\t\\caption{${1:caption}}\n\t\\label{tab:${2:label}}\n\t\\begin{tabular}{${3:cc}}\n\t\t$0\n\t\\end{tabular}\n\\end{table}",
    detail: "浮动表格",
  },
  {
    label: "\\begin{longtable}",
    body: "\\begin{longtable}[c]{${1:cc}}\n\t\\caption{${2:caption}}\\label{tab:${3:label}} \\\\\n\t$0\n\\end{longtable}",
    detail: "跨页长表格",
  },
  {
    label: "\\begin{tikzcd}",
    body: "\\begin{tikzcd}\n\t$0\n\\end{tikzcd}",
    detail: "tikz-cd 交换图",
  },
  {
    label: "\\textcolor",
    body: "\\textcolor{${1:red}}{${2:text}}$0",
    detail: "彩色文本",
  },
  {
    label: "\\textbf",
    body: "\\textbf{${1:text}}$0",
    detail: "粗体文本",
  },
  {
    label: "\\emph",
    body: "\\emph{${1:text}}$0",
    detail: "强调文本",
  },
  {
    label: "\\label",
    body: "\\label{${1}}$0",
    detail: "定义交叉引用标签",
  },
  {
    label: "\\ref",
    body: "\\ref{${1}}$0",
    detail: "普通交叉引用",
  },
  {
    label: "\\eqref",
    body: "\\eqref{${1}}$0",
    detail: "方程交叉引用",
  },
  {
    label: "\\pageref",
    body: "\\pageref{${1}}$0",
    detail: "页码交叉引用",
  },
  {
    label: "\\autoref",
    body: "\\autoref{${1}}$0",
    detail: "自动类型交叉引用",
  },
  {
    label: "\\cref",
    body: "\\cref{${1}}$0",
    detail: "cleveref 交叉引用",
  },
  {
    label: "\\Cref",
    body: "\\Cref{${1}}$0",
    detail: "句首 cleveref 交叉引用",
  },
];
const VISUAL_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
] as const;
const DOCUMENT_SYNC_DELAY_MS = 70;
// Cursor Math Preview and the local CodeMirror transaction update immediately.
// The expensive full-document structure scan and TextMate tokenization should
// wait for a short typing pause; otherwise ordinary 80–150 ms key intervals
// trigger one whole-document pass per character in a large paper.
const DOCUMENT_EDIT_IDLE_SYNC_DELAY_MS = 260;
// A formula edit has a separate, much cheaper cursor-render path. Keep the
// whole-document rescan out of that path until cursor preview traffic has been
// quiet for this long. This matters after a short pause: without the guard the
// 260 ms document timer can start a large project scan just before the next
// character, making only that character feel randomly sluggish.
const CURSOR_PREVIEW_DOCUMENT_SYNC_QUIET_MS = 520;
// A committed viewport SVG is lower priority than the live cursor preview.
// Yield briefly after typing so a large document cannot queue stale committed
// renders ahead of the formula currently being edited.
const VIEWPORT_RENDER_INPUT_QUIET_MS = 280;
const TRACE_MATH_PREVIEW_PERFORMANCE =
  process.env.TEXLEAF_TRACE_MATH_PREVIEW === "1";
const SYNTAX_REFRESH_RETRY_DELAYS_MS = [120, 240, 480, 960, 1_500] as const;
const MANAGED_ASSOCIATION_STATE_KEY = "texleaf.visualEditor.managedAssociation";

interface QuickPickVisualSnippet extends vscode.QuickPickItem {
  readonly snippet: CompiledSnippet;
}

interface VisualCoreLatexCompletion {
  readonly label: string;
  readonly body: string;
  readonly detail: string;
}

interface VisualReferenceCompletionContext {
  readonly command: string;
  readonly from: number;
  readonly to: number;
  readonly query: string;
}

interface VisualCompletionAction {
  readonly baseRevision: number;
  readonly from: number;
  readonly insertedText: string;
  readonly command: vscode.Command;
}

interface QuickPickCitation extends vscode.QuickPickItem {
  readonly item: vscode.CompletionItem;
}

interface VisualExtensionSnippetDefinition {
  readonly prefixes: readonly string[];
  readonly body: string;
  readonly description: string | undefined;
  readonly source: string;
}

const visualExtensionSnippetCache = new Map<
  string,
  Promise<readonly VisualExtensionSnippetDefinition[]>
>();

interface VisualSnapshot {
  readonly text: string;
  readonly version: number;
  readonly preview: MathPreviewSnapshot;
  readonly records: readonly VisualFormulaRecord[];
  readonly formulaById: ReadonlyMap<string, MathPreviewFormula>;
  readonly structures: readonly VisualStructureRecord[];
  readonly projectContext: LatexProjectContext | undefined;
  readonly projectContextKey: string;
}

interface VisualNavigationLocation {
  readonly uri: string;
  readonly selection: VisualEditorSelection;
}

interface VisualSourceGuard {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
}

interface VisualProjectReferenceResolution {
  readonly context: LatexProjectContext;
  readonly target: LatexProjectLabelTarget;
  readonly snapshot: VisualSnapshot;
}

interface VisualProjectReferenceDescriptor {
  readonly snapshot: VisualSnapshot | undefined;
  readonly source: string | undefined;
}

/**
 * Build the source-indexed part of a visual snapshot without rendering every
 * structure. Completion can call this while the normal idle snapshot is still
 * pending, so reference candidates and their previews never have to wait for
 * the whole-document presentation refresh.
 */
function buildVisualSnapshot(
  text: string,
  version: number,
  preview: MathPreviewSnapshot,
  structures: readonly VisualStructureRecord[],
  mathPreviewScale: number,
  projectContext?: LatexProjectContext,
): VisualSnapshot {
  const collapsedRanges = visualCollapsedSourceRanges(structures);
  const records: VisualFormulaRecord[] = [];
  const formulaById = new Map<string, MathPreviewFormula>();
  const formulaIdentityOccurrences = new Map<string, number>();
  for (const formula of preview.formulas) {
    if (!formula.closed) {
      continue;
    }
    if (collapsedRanges.some(
      ([from, to]) =>
        formula.outerRange.start >= from && formula.outerRange.end <= to,
    )) {
      continue;
    }
    const renderInput = createMathPreviewRenderInput(text, formula, preview);
    const identity = visualFormulaIdentity(
      renderInput === undefined
        ? {
            tex: text.slice(formula.outerRange.start, formula.outerRange.end),
            display: formula.mode === "block",
            macroFingerprint: preview.macroFingerprint,
          }
        : renderInput,
      mathPreviewScale,
    );
    const occurrence = formulaIdentityOccurrences.get(identity) ?? 0;
    formulaIdentityOccurrences.set(identity, occurrence + 1);
    const id = `${identity}:${occurrence}`;
    records.push({
      id,
      from: formula.outerRange.start,
      to: formula.outerRange.end,
      bodyFrom: formula.bodyRange.start,
      bodyTo: formula.bodyRange.end,
      display: formula.mode === "block",
      ...(formula.environmentName === undefined
        ? {}
        : { environmentName: formula.environmentName }),
      labels: visualFormulaLabels(text, formula),
    });
    formulaById.set(id, formula);
  }
  return {
    text,
    version,
    preview,
    records,
    formulaById,
    structures,
    projectContext,
    projectContextKey: projectContext === undefined
      ? `single:${version}`
      : `${projectContext.contextId}:${projectContext.revision}`,
  };
}

interface VisualEditorSession {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: vscode.Disposable[];
  readonly renderedFormulaIds: Set<string>;
  ready: boolean;
  disposed: boolean;
  acceptedRevision: number;
  selection: VisualEditorSelection;
  snapshot: VisualSnapshot | undefined;
  documentGeneration: number;
  renderGeneration: number;
  viewportRenderSequence: number;
  viewportRenderActive: boolean;
  viewportRenderRequest: VisualViewportRenderRequest | undefined;
  viewportRenderBudgetSequence: number;
  viewportRenderBudgetUsed: number;
  completionGeneration: number;
  cursorPreviewActive: boolean;
  cursorPreviewPending:
    | Extract<VisualEditorWebviewMessage, { readonly type: "cursorPreview" }>
    | undefined;
  readonly completionActions: Map<string, VisualCompletionAction>;
  bibliographyRequest: string | undefined;
  bibliographyEntries: readonly BibTeXEntry[] | undefined;
  backgroundViewColumn: vscode.ViewColumn | undefined;
  /**
   * A full TextMate snapshot must reach each Webview at least once. An
   * initialize request can be superseded by an early view-column/background
   * refresh while tokenization is still running, so a document-wide flag alone
   * cannot prove that this particular session received its native colors.
   */
  syntaxRefreshRequired: boolean;
  syntaxRefreshAttempts: number;
}

interface VisualViewportRenderRequest {
  readonly sequence: number;
  readonly generation: number;
  readonly version: number;
  readonly from: number;
  readonly to: number;
  readonly anchorFrom: number;
  readonly anchorTo: number;
}

interface VisualDocumentState {
  readonly key: string;
  readonly document: vscode.TextDocument;
  readonly sessions: Set<VisualEditorSession>;
  mirrorText: string;
  epoch: number;
  pendingEdits: number;
  queue: Promise<void>;
  syntaxQueue: Promise<void>;
  syncTimer: ReturnType<typeof setTimeout> | undefined;
  syncKind: "normal" | "edit" | undefined;
  lastCursorPreviewAt: number;
  diagnosticTimer: ReturnType<typeof setTimeout> | undefined;
  refreshSyntaxOnNextSync: boolean;
}

interface RecentVisualDeactivation {
  readonly session: VisualEditorSession;
  readonly at: number;
}

/**
 * A text-document-backed custom editor. CodeMirror owns only the presentation;
 * every source edit is applied to VS Code's TextDocument so dirty state, save,
 * file watching, source control and external editors keep one canonical file.
 */
export class VisualEditorProvider
  implements vscode.CustomTextEditorProvider, vscode.Disposable
{
  private readonly renderer: VisualEditorRenderer;
  private readonly syntaxTheme: VisualEditorSyntaxThemeResolver;
  private readonly projectContexts: LatexProjectContextService;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly states = new Map<string, VisualDocumentState>();
  private readonly projectFileSnapshotCache = new Map<string, VisualSnapshot>();
  /**
   * Navigation is provider-wide rather than panel-local so a jump from one
   * included TeX file to another can return to the physical source document.
   */
  private readonly navigationHistory: VisualNavigationLocation[] = [];
  /**
   * TeXLeaf edits update the Webview optimistically and schedule one idle full
   * snapshot. Their synchronous TextDocument notification must invalidate
   * project caches without invalidating every live visual session immediately.
   */
  private quietProjectContextInvalidationDepth = 0;
  private activeSession: VisualEditorSession | undefined;
  private recentVisualDeactivation: RecentVisualDeactivation | undefined;
  private explicitSourceNavigation:
    | { readonly uriText: string; readonly until: number }
    | undefined;
  private nativeProblemNavigationEpoch = 0;
  private nativeProblemNavigationTask: Promise<void> | undefined;
  private visualFocusRequestSequence = 0;
  private readonly visualFocusAcknowledgements = new Map<
    number,
    {
      readonly session: VisualEditorSession;
      readonly complete: (applied: boolean) => void;
    }
  >();
  private disposed = false;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
    private readonly runtime: SnippetRuntime,
    private readonly templates: TemplateManager,
    private readonly citations: CitationController,
    private readonly aiWriting: AIWritingController,
  ) {
    this.renderer = new VisualEditorRenderer(context);
    this.syntaxTheme = new VisualEditorSyntaxThemeResolver(context);
    this.projectContexts = new LatexProjectContextService();
  }

  public register(): void {
    void this.synchronizeDefaultEditorAssociation();
    void vscode.commands.executeCommand(
      "setContext",
      "texleaf.visualNavigationAvailable",
      false,
    );
    const projectWatcher = vscode.workspace.createFileSystemWatcher("**/*.tex");
    const invalidateProjectFile = (uri: vscode.Uri): void => {
      this.projectContexts.invalidate(uri);
    };
    this.disposables.push(
      this.projectContexts,
      projectWatcher,
      projectWatcher.onDidCreate(invalidateProjectFile),
      projectWatcher.onDidChange(invalidateProjectFile),
      projectWatcher.onDidDelete(invalidateProjectFile),
      this.projectContexts.onDidInvalidate((invalidation) => {
        this.projectFileSnapshotCache.clear();
        if (this.quietProjectContextInvalidationDepth > 0) {
          return;
        }
        const invalidatedProjectContextKey = `invalidated:${invalidation.revision}`;
        for (const state of this.states.values()) {
          for (const session of state.sessions) {
            session.documentGeneration += 1;
            session.renderGeneration += 1;
            resetViewportRenderRequest(session);
            session.completionGeneration += 1;
            session.renderedFormulaIds.clear();
            session.bibliographyRequest = undefined;
            session.bibliographyEntries = undefined;
            if (!session.disposed) {
              void session.panel.webview.postMessage({
                protocol: VISUAL_EDITOR_PROTOCOL,
                type: "projectContextInvalidated",
                projectContextKey: invalidatedProjectContextKey,
              } satisfies VisualEditorHostMessage);
            }
          }
          this.scheduleDocumentSync(state, 0);
        }
      }),
      vscode.window.registerCustomEditorProvider(
        VISUAL_EDITOR_VIEW_TYPE,
        this,
        {
          supportsMultipleEditorsPerDocument: true,
          webviewOptions: { retainContextWhenHidden: true },
        },
      ),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isBibliographyDocument(event.document)) {
          this.invalidateBibliographyPreviews();
        }
        if (isLatexProjectUri(event.document.uri)) {
          const state = this.states.get(event.document.uri.toString());
          const optimisticVisualEdit = state !== undefined &&
            state.mirrorText === event.document.getText();
          if (optimisticVisualEdit) {
            this.quietProjectContextInvalidationDepth += 1;
            try {
              this.projectContexts.invalidate(event.document.uri);
            } finally {
              this.quietProjectContextInvalidationDepth -= 1;
            }
          } else {
            this.projectContexts.invalidate(event.document.uri);
          }
        }
        this.handleDocumentChanged(event.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (isLatexProjectUri(document.uri)) {
          this.projectContexts.invalidate(document.uri);
        }
        this.closeDocumentState(document);
      }),
      vscode.workspace.onWillSaveTextDocument((event) => {
        const session = this.activeVisualSessionFor(event.document);
        const extension = latexWorkshopExtension();
        if (
          session === undefined || extension === undefined ||
          !this.shouldBridgeLatexWorkshop(event.document.uri)
        ) {
          return;
        }
        event.waitUntil(prepareLatexWorkshopVisualSave(extension).then(
          () => [],
          (error: unknown) => {
            this.output.warn(
              `可视化保存前无法准备 LaTeX Workshop 后台构建：${errorMessage(error)}`,
            );
            return [];
          },
        ));
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        const session = this.activeVisualSessionFor(document);
        if (session !== undefined && this.shouldBridgeLatexWorkshop(document.uri)) {
          void this.runLatexWorkshopAutoBuild(session);
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        this.renderer.clear();
        this.syntaxTheme.invalidate();
        for (const state of this.states.values()) {
          state.refreshSyntaxOnNextSync = true;
          for (const session of state.sessions) {
            session.syntaxRefreshRequired = true;
            session.syntaxRefreshAttempts = 0;
            session.renderedFormulaIds.clear();
            session.renderGeneration += 1;
            resetViewportRenderRequest(session);
            if (session.ready && session.snapshot !== undefined) {
              void this.postDocument(session, "document");
            }
          }
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.scheduleNativeProblemNavigation(editor);
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (vscode.window.activeTextEditor === event.textEditor) {
          this.scheduleNativeProblemNavigation(event.textEditor, event.kind);
        }
      }),
      this.aiWriting.onDidChange(() => {
        for (const state of this.states.values()) {
          for (const session of state.sessions) {
            void this.postAiIssues(session);
          }
        }
      }),
      this.templates.onDidChange(() => {
        for (const state of this.states.values()) {
          this.scheduleDocumentSync(state, 0);
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        const backgroundChanged = event.affectsConfiguration("background");
        const syntaxThemeChanged =
          event.affectsConfiguration("workbench.colorTheme") ||
          event.affectsConfiguration("editor.tokenColorCustomizations");
        const texleafChanged =
          event.affectsConfiguration("texleaf.visualEditor") ||
          event.affectsConfiguration("texleaf.mathPreview") ||
          event.affectsConfiguration("texleaf.bibliographyFile") ||
          event.affectsConfiguration("texleaf.project");
        if (
          !texleafChanged &&
          !backgroundChanged &&
          !syntaxThemeChanged
        ) {
          return;
        }
        if (syntaxThemeChanged) {
          this.syntaxTheme.invalidate();
          for (const state of this.states.values()) {
            state.refreshSyntaxOnNextSync = true;
            for (const session of state.sessions) {
              session.syntaxRefreshRequired = true;
              session.syntaxRefreshAttempts = 0;
            }
          }
        }
        if (event.affectsConfiguration("texleaf.visualEditor.defaultMode")) {
          void this.synchronizeDefaultEditorAssociation();
        }
        if (texleafChanged) {
          this.renderer.clear();
        }
        if (event.affectsConfiguration("texleaf.bibliographyFile")) {
          this.invalidateBibliographyPreviews();
        }
        if (event.affectsConfiguration("texleaf.project")) {
          this.projectContexts.invalidateAll();
        }
        for (const state of this.states.values()) {
          this.scheduleDocumentSync(state, 0);
        }
      }),
      vscode.commands.registerCommand(
        OPEN_VISUAL_EDITOR_COMMAND,
        (resource?: vscode.Uri) => this.openVisualEditor(resource),
      ),
      vscode.commands.registerCommand(
        OPEN_SOURCE_EDITOR_COMMAND,
        (resource?: vscode.Uri) => this.openSourceEditor(resource),
      ),
      vscode.commands.registerCommand(
        VISUAL_EDITOR_REVEAL_RANGE_COMMAND,
        (
          resource: vscode.Uri | string,
          from: number,
          to: number,
          options?: VisualEditorFocusOptions,
        ) => this.revealVisualRange(resource, from, to, options),
      ),
      vscode.commands.registerCommand(
        VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND,
        (
          resource: vscode.Uri | string,
          from: number,
          to: number,
          options?: VisualEditorFocusOptions,
        ) => this.revealOpenVisualRange(resource, from, to, options),
      ),
      vscode.commands.registerCommand(
        VISUAL_EDITOR_REVEAL_DIAGNOSTIC_COMMAND,
        (
          resource: vscode.Uri | string,
          startLine: number,
          startCharacter: number,
          endLine: number,
          endCharacter: number,
        ) => this.revealVisualDiagnostic(
          resource,
          startLine,
          startCharacter,
          endLine,
          endCharacter,
        ),
      ),
      vscode.commands.registerCommand(VISUAL_EDITOR_BUILD_COMMAND, () =>
        this.runLatexWorkshop("latex-workshop.build", "正在交给 LaTeX Workshop 编译…"),
      ),
      vscode.commands.registerCommand(VISUAL_EDITOR_VIEW_PDF_COMMAND, () =>
        this.runLatexWorkshop("latex-workshop.view", "正在打开 LaTeX Workshop PDF…"),
      ),
      vscode.commands.registerCommand(VISUAL_EDITOR_SYNCTEX_COMMAND, () =>
        this.runLatexWorkshop("latex-workshop.synctex", "正在执行正向 SyncTeX…"),
      ),
      vscode.commands.registerCommand(VISUAL_EDITOR_NAVIGATE_BACK_COMMAND, () =>
        this.navigateBack(this.activeSession),
      ),
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: visualEditorResourceRoots(
        this.context.extensionUri,
        document,
      ),
    };

    const state = this.stateFor(document);
    const session: VisualEditorSession = {
      document,
      panel,
      subscriptions: [],
      renderedFormulaIds: new Set<string>(),
      ready: false,
      disposed: false,
      acceptedRevision: 0,
      selection: { anchor: 0, head: 0 },
      snapshot: undefined,
      documentGeneration: 0,
      renderGeneration: 0,
      viewportRenderSequence: 0,
      viewportRenderActive: false,
      viewportRenderRequest: undefined,
      viewportRenderBudgetSequence: -1,
      viewportRenderBudgetUsed: 0,
      completionGeneration: 0,
      cursorPreviewActive: false,
      cursorPreviewPending: undefined,
      completionActions: new Map(),
      bibliographyRequest: undefined,
      bibliographyEntries: undefined,
      backgroundViewColumn: panel.viewColumn,
      syntaxRefreshRequired: true,
      syntaxRefreshAttempts: 0,
    };
    state.sessions.add(session);
    if (panel.active) {
      this.activeSession = session;
      this.recentVisualDeactivation = undefined;
    }

    session.subscriptions.push(
      panel.webview.onDidReceiveMessage((value: unknown) => {
        void this.handleWebviewMessage(session, value).catch((error: unknown) => {
          this.output.error(
            `可视化编辑器消息处理失败：${errorMessage(error)}`,
          );
          void this.postStatus(session, "error", `操作失败：${errorMessage(error)}`);
        });
      }),
      panel.onDidChangeViewState((event) => {
        if (session.backgroundViewColumn !== event.webviewPanel.viewColumn) {
          session.backgroundViewColumn = event.webviewPanel.viewColumn;
          this.scheduleDocumentSync(state, 0);
        }
        if (event.webviewPanel.active) {
          this.activeSession = session;
          this.recentVisualDeactivation = undefined;
        } else if (this.activeSession === session) {
          this.recentVisualDeactivation = {
            session,
            at: Date.now(),
          };
          this.activeSession = undefined;
        }
      }),
      panel.onDidDispose(() => this.disposeSession(session)),
    );

    panel.webview.html = this.createWebviewHtml(panel.webview);
    if (this.shouldBridgeLatexWorkshop(document.uri)) {
      const extension = latexWorkshopExtension();
      if (extension !== undefined) {
        try {
          await prepareLatexWorkshopVisualEditor(extension);
        } catch (error: unknown) {
          // Visual editing remains available when LaTeX Workshop is still
          // starting or changes an internal module.  A later toolbar action
          // retries the same bridge installation.
          this.output.warn(
            `可视化编辑器未能提前安装反向 SyncTeX 桥接：${errorMessage(error)}`,
          );
        }
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.nativeProblemNavigationEpoch += 1;
    this.recentVisualDeactivation = undefined;
    this.explicitSourceNavigation = undefined;
    this.projectFileSnapshotCache.clear();
    for (const state of this.states.values()) {
      if (state.syncTimer !== undefined) {
        clearTimeout(state.syncTimer);
      }
      if (state.diagnosticTimer !== undefined) {
        clearTimeout(state.diagnosticTimer);
      }
      for (const session of [...state.sessions]) {
        this.disposeSession(session);
      }
    }
    this.states.clear();
    this.renderer.dispose();
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private stateFor(document: vscode.TextDocument): VisualDocumentState {
    const key = document.uri.toString();
    const existing = this.states.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const state: VisualDocumentState = {
      key,
      document,
      sessions: new Set<VisualEditorSession>(),
      mirrorText: document.getText(),
      epoch: 0,
      pendingEdits: 0,
      queue: Promise.resolve(),
      syntaxQueue: Promise.resolve(),
      syncTimer: undefined,
      syncKind: undefined,
      lastCursorPreviewAt: 0,
      diagnosticTimer: undefined,
      refreshSyntaxOnNextSync: false,
    };
    this.states.set(key, state);
    return state;
  }

  private async handleWebviewMessage(
    session: VisualEditorSession,
    value: unknown,
  ): Promise<void> {
    const message = parseWebviewMessage(value);
    if (message === undefined || session.disposed) {
      return;
    }
    const state = this.stateFor(session.document);
    switch (message.type) {
      case "ready":
        session.ready = true;
        session.renderedFormulaIds.clear();
        resetViewportRenderRequest(session);
        await this.postDocument(session, "initialize");
        return;
      case "focusApplied": {
        const pending = this.visualFocusAcknowledgements.get(message.requestId);
        if (pending?.session === session) {
          pending.complete(true);
        }
        return;
      }
      case "edit":
        await this.acceptWebviewEdit(state, session, message);
        return;
      case "inputRequest":
        await this.handleInputRequest(state, session, message);
        return;
      case "completionRequest":
        await this.handleCompletionRequest(state, session, message);
        return;
      case "completionAccepted":
        await this.handleCompletionAccepted(state, session, message);
        return;
      case "virtualSnippetRequest":
        await this.handleVirtualSnippetRequest(state, session, message);
        return;
      case "virtualCompletionRequest":
        await this.handleVirtualCompletionRequest(state, session, message);
        return;
      case "virtualMathRenderRequest":
        await this.renderVirtualMathInput(session, message);
        return;
      case "clipboard":
        await this.handleClipboardAction(state, session, message);
        return;
      case "navigate":
        await this.handleVisualNavigation(state, session, message);
        return;
      case "aiIssueAction":
        await this.handleAiIssueAction(state, session, message);
        return;
      case "diagnosticInsightRequest":
        await this.handleDiagnosticInsightRequest(session, message);
        return;
      case "selection":
        session.selection = clampSelection(message.selection, state.mirrorText.length);
        return;
      case "viewport":
        await this.renderViewport(session, message.version, message.from, message.to);
        return;
      case "cursorPreview":
        this.enqueueCursorPreview(session, message);
        return;
      case "formulaCommitPreview":
        await this.renderCommittedFormula(session, message);
        return;
      case "referencePreview":
        await this.renderReferencePreview(session, message);
        return;
      case "completionReferencePreview":
        await this.renderCompletionReferencePreview(session, message);
        return;
      case "command":
        await this.runWebviewCommand(session, message.command);
        return;
      case "openTemplate":
        await this.openTemplateAsUntitledDocument(message.templateId);
        return;
    }
  }

  private async handleClipboardAction(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "clipboard" }>,
  ): Promise<void> {
    await state.queue;
    const text = state.mirrorText;
    const selection = clampSelection(message.selection, text.length);
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    if (
      session.disposed ||
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision ||
      session.document.getText() !== text
    ) {
      await this.postStatus(session, "warning", "文档已变化，本次剪贴板操作已取消。");
      return;
    }

    if (message.action === "copy" || message.action === "cut") {
      if (from === to) {
        await this.postStatus(session, "warning", "请先选择要复制或剪切的内容。");
        return;
      }
      await vscode.env.clipboard.writeText(text.slice(from, to));
      if (message.action === "copy") {
        await this.postStatus(session, "info", "已复制所选内容。");
        return;
      }
      await this.postApplyEdit(
        state,
        session,
        from,
        to,
        "",
        { anchor: from, head: from },
        message.revision,
      );
      return;
    }

    const insert = await vscode.env.clipboard.readText();
    if (insert.length > MAX_INSERTED_TEXT) {
      await this.postStatus(
        session,
        "warning",
        `剪贴板内容超过 ${MAX_INSERTED_TEXT.toLocaleString()} 个字符，已停止粘贴。`,
      );
      return;
    }
    await this.postApplyEdit(
      state,
      session,
      from,
      to,
      insert,
      { anchor: from + insert.length, head: from + insert.length },
      message.revision,
    );
  }

  private async renderVirtualMathInput(
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "virtualMathRenderRequest" }>,
  ): Promise<void> {
    const snapshot = session.snapshot;
    const state = this.stateFor(session.document);
    const tex = message.tex.trim();
    const text = state.mirrorText;
    if (
      snapshot === undefined ||
      tex.length === 0 ||
      session.disposed ||
      message.revision !== session.acceptedRevision ||
      message.projectContextKey !== snapshot.projectContextKey ||
      !Number.isSafeInteger(message.anchor) ||
      message.anchor < 0 ||
      message.anchor > text.length ||
      session.document.getText() !== text
    ) {
      return;
    }
    const generation = session.renderGeneration;
    const environment = mathPreviewMacroEnvironmentAtOffset(
      snapshot.preview,
      message.anchor,
    );
    const config = readConfig(session.document.uri);
    try {
      const rendered = await this.renderer.renderInteractive({
        tex,
        display: false,
        macros: environment.macros,
        macroFingerprint: environment.macroFingerprint,
      }, config.mathPreviewScale);
      if (
        session.disposed ||
        session.renderGeneration !== generation ||
        session.snapshot !== snapshot ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText !== text ||
        session.document.getText() !== text
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualMathRenderResult",
        requestId: message.requestId,
        revision: message.revision,
        projectContextKey: snapshot.projectContextKey,
        tex,
        svg: rendered.svg,
        widthEm: rendered.widthEm,
        heightEm: rendered.heightEm,
      } satisfies VisualEditorHostMessage);
    } catch (error: unknown) {
      this.traceMathPreview("cursor:error", {
        requestId: message.requestId,
        message: errorMessage(error),
      });
      if (
        session.disposed ||
        session.renderGeneration !== generation ||
        session.snapshot !== snapshot ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText !== text ||
        session.document.getText() !== text
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualMathRenderError",
        requestId: message.requestId,
        revision: message.revision,
        projectContextKey: snapshot.projectContextKey,
        tex,
        message: errorMessage(error),
      } satisfies VisualEditorHostMessage);
    }
  }

  private async acceptWebviewEdit(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "edit" }>,
  ): Promise<void> {
    if (message.revision !== session.acceptedRevision + 1) {
      await this.postStatus(
        session,
        "warning",
        "编辑版本已变化，已重新同步磁盘中的最新文本。",
      );
      this.invalidatePendingEdits(state);
      return;
    }
    const changes = normalizeChanges(message.changes, state.mirrorText.length);
    if (changes === undefined) {
      await this.postStatus(session, "error", "编辑范围无效，改动未应用。");
      this.invalidatePendingEdits(state);
      return;
    }
    const beforeText = state.mirrorText;
    const afterText = applyChanges(beforeText, changes);
    const syntaxEditSpan = visualSyntaxEditSpan(state.document, changes);
    if (afterText.length > MAX_DOCUMENT_LENGTH) {
      await this.postStatus(
        session,
        "error",
        `文档超过可视化编辑器的 ${MAX_DOCUMENT_LENGTH.toLocaleString()} 字符安全上限。`,
      );
      this.invalidatePendingEdits(state);
      return;
    }

    session.acceptedRevision = message.revision;
    session.selection = clampSelection(message.selection, afterText.length);
    state.mirrorText = afterText;
    state.pendingEdits += 1;
    for (const candidate of state.sessions) {
      candidate.documentGeneration += 1;
    }
    const epoch = state.epoch;
    const operation = async (): Promise<void> => {
      if (epoch !== state.epoch || session.disposed) {
        return;
      }
      if (state.document.getText() !== beforeText) {
        this.invalidatePendingEdits(state);
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const change of changes) {
        edit.replace(
          state.document.uri,
          new vscode.Range(
            state.document.positionAt(change.from),
            state.document.positionAt(change.to),
          ),
          change.insert,
        );
      }
      await vscode.workspace.applyEdit(edit);
      const actualAfterEdit = state.document.getText();
      if (
        epoch !== state.epoch ||
        actualAfterEdit !== afterText
      ) {
        this.invalidatePendingEdits(state);
        return;
      }
      const syntaxInput = visualIncrementalSyntaxInput(
        state.document,
        beforeText,
        afterText,
        syntaxEditSpan,
      );
      if (syntaxInput !== undefined) {
        this.enqueueIncrementalSyntaxPatch(
          state,
          session,
          syntaxInput,
          message.revision,
          epoch,
        );
      }
      state.pendingEdits = Math.max(0, state.pendingEdits - 1);
      if (state.pendingEdits === 0) {
        state.mirrorText = state.document.getText();
        const transformed = message.source === "user" && !message.composing
          ? await this.tryPostInputTransform(
              state,
              session,
              beforeText,
              changes,
              message.revision,
            )
          : false;
        this.scheduleDocumentSync(
          state,
          transformed
            ? DOCUMENT_SYNC_DELAY_MS * 4
            : DOCUMENT_EDIT_IDLE_SYNC_DELAY_MS,
          "edit",
        );
      }
    };
    state.queue = state.queue.then(operation, operation);
  }

  private enqueueIncrementalSyntaxPatch(
    state: VisualDocumentState,
    session: VisualEditorSession,
    input: VisualEditorIncrementalSyntaxInput,
    revision: number,
    epoch: number,
  ): void {
    const operation = async (): Promise<void> => {
      if (state.epoch !== epoch || session.disposed) {
        return;
      }
      const patch = await this.syntaxTheme.tokenizeIncremental(
        input,
        session.document.uri,
      );
      if (state.epoch !== epoch || session.disposed) {
        return;
      }
      if (patch === undefined || !patch.complete) {
        session.syntaxRefreshRequired = true;
        session.syntaxRefreshAttempts = 0;
        state.refreshSyntaxOnNextSync = true;
      }
      if (
        patch === undefined ||
        session.acceptedRevision !== revision ||
        state.mirrorText !== input.afterText
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "syntaxTokenPatch",
        revision,
        from: patch.from,
        to: patch.to,
        expectedText: patch.expectedText,
        tokens: patch.tokens,
      } satisfies VisualEditorHostMessage);
    };
    state.syntaxQueue = state.syntaxQueue.then(operation, operation);
  }

  private async tryPostInputTransform(
    state: VisualDocumentState,
    session: VisualEditorSession,
    beforeText: string,
    changes: readonly VisualEditorChange[],
    revision: number,
  ): Promise<boolean> {
    if (
      session.disposed ||
      session.acceptedRevision !== revision ||
      state.pendingEdits !== 0 ||
      session.selection.anchor !== session.selection.head
    ) {
      return false;
    }
    const document = session.document;
    const config = readConfig(document.uri);
    if (!isVisualEditingDocument(document, config)) {
      return false;
    }
    const text = document.getText();
    const cursorOffset = session.selection.head;
    if (text !== state.mirrorText || cursorOffset < 0 || cursorOffset > text.length) {
      return false;
    }

    const single = changes.length === 1 ? changes[0] : undefined;
    if (single !== undefined && single.from < single.to) {
      const selectedText = beforeText.slice(single.from, single.to);
      const insertedCodePoints = [...single.insert];
      const context = this.runtime.contextAt(
        document,
        document.positionAt(Math.min(single.from, text.length)),
      );
      if (!isExcludedLatexContext(context, config.excludedEnvironments)) {
        if (
          config.visualSnippets &&
          insertedCodePoints.length === 1 &&
          single.insert.length > 0
        ) {
          const match = this.runtime.matchText(
            document,
            single.insert,
            text.slice(single.from + single.insert.length, single.from + single.insert.length + 1),
            context,
            "visual",
            config,
            selectedText,
          );
          if (match !== undefined) {
            return this.postSnippet(
              state,
              session,
              single.from + match.startOffset,
              single.from + match.endOffset,
              match.replacement,
              revision,
            );
          }
        }
        if (
          config.autoFraction &&
          single.insert === "/" &&
          context.mathMode !== "text"
        ) {
          const fraction = planVisualSelectionFraction(
            selectedText,
            { start: single.from, end: single.from + 1 },
            config.autoFractionCommand,
          );
          if (fraction !== undefined) {
            return this.postSnippet(
              state,
              session,
              fraction.range.start,
              fraction.range.end,
              fraction.parts,
              revision,
            );
          }
        }
      }
    }

    if (
      config.autoSnippets &&
      shouldRunVisualAutomaticSnippet(changes, cursorOffset)
    ) {
      const position = document.positionAt(cursorOffset);
      const template = this.templates.match(document, position);
      if (template !== undefined) {
        return this.postSnippet(
          state,
          session,
          document.offsetAt(template.range.start),
          document.offsetAt(template.range.end),
          template.parts,
          revision,
        );
      }
      const automatic = this.runtime.matchAt(
        document,
        position,
        "auto",
        config,
      );
      if (automatic !== undefined) {
        return this.postSnippet(
          state,
          session,
          document.offsetAt(automatic.range.start),
          document.offsetAt(automatic.range.end),
          automatic.match.replacement,
          revision,
        );
      }
    }

    if (
      config.autoFraction &&
      single !== undefined &&
      single.from === single.to &&
      single.insert.length > 0 &&
      !/[\r\n]/u.test(single.insert)
    ) {
      const context = this.runtime.contextAt(
        document,
        document.positionAt(cursorOffset),
      );
      if (
        context.mathMode !== "text" &&
        !isExcludedLatexContext(context, config.excludedEnvironments)
      ) {
        const fraction = planVisualAutoFraction(
          text,
          cursorOffset,
          single.insert,
          {
            command: config.autoFractionCommand,
            breakingCharacters: config.autoFractionBreakingCharacters,
          },
        );
        if (fraction !== undefined) {
          return this.postSnippet(
            state,
            session,
            fraction.range.start,
            fraction.range.end,
            fraction.parts,
            revision,
          );
        }
      }
    }
    return false;
  }

  private async handleInputRequest(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "inputRequest" }>,
  ): Promise<void> {
    await state.queue;
    if (session.disposed) {
      return;
    }
    const selection = clampSelection(message.selection, state.mirrorText.length);
    if (
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision ||
      selection.anchor !== selection.head ||
      state.document.getText() !== state.mirrorText
    ) {
      await this.postInputFallback(session, message);
      return;
    }
    session.selection = selection;
    const document = state.document;
    const config = readConfig(document.uri);
    if (!isVisualEditingDocument(document, config)) {
      await this.postInputFallback(session, message);
      return;
    }
    const offset = selection.head;
    const position = document.positionAt(offset);

    if (message.action === "auto") {
      if (config.autoSnippets) {
        const template = this.templates.match(document, position);
        if (
          template !== undefined &&
          await this.postSnippet(
            state,
            session,
            document.offsetAt(template.range.start),
            document.offsetAt(template.range.end),
            template.parts,
            message.revision,
            message.requestId,
          )
        ) {
          return;
        }
        const automatic = this.runtime.matchAt(document, position, "auto", config);
        if (
          automatic !== undefined &&
          await this.postSnippet(
            state,
            session,
            document.offsetAt(automatic.range.start),
            document.offsetAt(automatic.range.end),
            automatic.match.replacement,
            message.revision,
            message.requestId,
          )
        ) {
          return;
        }
      }
      await this.postInputFallback(session, message);
      return;
    }

    if (
      message.action === "tab" ||
      message.action === "shiftTab" ||
      message.action === "space"
    ) {
      if (message.action === "shiftTab") {
        const alignPlan = planVisualAlignTab(
          document.getText(),
          offset,
          -1,
          config.matrixEnvironments,
        );
        if (alignPlan !== undefined) {
          await this.postApplyEdit(
            state,
            session,
            alignPlan.range.start,
            alignPlan.range.end,
            alignPlan.insert,
            { anchor: alignPlan.cursorOffset, head: alignPlan.cursorOffset },
            message.revision,
            message.requestId,
          );
          return;
        }
        await this.postInputFallback(session, message);
        return;
      }
      const expectedTrigger = message.action === "tab" ? "tab" : "space";
      if (message.action === "tab") {
        const template = this.templates.match(document, position);
        if (
          template !== undefined &&
          await this.postSnippet(
            state,
            session,
            document.offsetAt(template.range.start),
            document.offsetAt(template.range.end),
            template.parts,
            message.revision,
            message.requestId,
          )
        ) {
          return;
        }
      }
      if (config.manualTrigger === expectedTrigger) {
        const manual = this.runtime.matchAt(
          document,
          position,
          "manual",
          config,
        );
        if (
          manual !== undefined &&
          await this.postSnippet(
            state,
            session,
            document.offsetAt(manual.range.start),
            document.offsetAt(manual.range.end),
            manual.match.replacement,
            message.revision,
            message.requestId,
          )
        ) {
          return;
        }
      }
      if (message.action === "space") {
        await this.postInputFallback(session, message);
        return;
      }

      const context = this.runtime.contextAt(document, position);
      const source = document.getText();
      const alignPlan = planVisualAlignTab(
        source,
        offset,
        1,
        config.matrixEnvironments,
      );
      if (alignPlan !== undefined) {
        await this.postApplyEdit(
          state,
          session,
          alignPlan.range.start,
          alignPlan.range.end,
          alignPlan.insert,
          { anchor: alignPlan.cursorOffset, head: alignPlan.cursorOffset },
          message.revision,
          message.requestId,
        );
        return;
      }
      if (config.tabout) {
        const line = document.lineAt(position.line);
        const plan = context.mathMode === "text"
          ? planTabout(source, offset, {
              innerStart: document.offsetAt(line.range.start),
              innerEnd: document.offsetAt(line.range.end),
              outerEnd: document.offsetAt(line.range.end),
              arrayMode: true,
            })
          : planTabout(source, offset, {
              arrayMode: isConfiguredMatrixContext(
                context,
                config.matrixEnvironments,
              ),
            });
        const mathRegion = innermostLatexMathRegion(source, offset);
        if (
          plan !== undefined &&
          (plan.kind !== "math-delimiter" ||
            (
              mathRegion?.mode === "inline" &&
              mathRegion.environmentName === undefined
            ))
        ) {
          await this.postApplyEdit(
            state,
            session,
            offset,
            offset,
            "",
            { anchor: plan.to, head: plan.to },
            message.revision,
            message.requestId,
          );
          return;
        }
      }
      await this.postInputFallback(session, message);
      return;
    }

    const context = this.runtime.contextAt(document, position);
    if (message.action === "enter") {
      if (config.matrixShortcuts) {
        const leftRight = planLeftRightEnter(document.getText(), offset, {
          eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
        });
        if (leftRight !== undefined) {
          await this.postApplyEdit(
            state,
            session,
            leftRight.insertionOffset,
            leftRight.insertionOffset,
            leftRight.insertionText,
            {
              anchor: leftRight.cursorOffset,
              head: leftRight.cursorOffset,
            },
            message.revision,
            message.requestId,
          );
          return;
        }
        if (isConfiguredMatrixContext(context, config.matrixEnvironments)) {
          const lineText = document.lineAt(position.line).text;
          const indentation = /^\s*/u.exec(lineText)?.[0] ?? "";
          const eol = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
          const insertion = context.mathMode === "block"
            ? ` \\\\${eol}${indentation}`
            : " \\\\ ";
          await this.postApplyEdit(
            state,
            session,
            offset,
            offset,
            insertion,
            {
              anchor: offset + insertion.length,
              head: offset + insertion.length,
            },
            message.revision,
            message.requestId,
          );
          return;
        }
      }
      await this.postInputFallback(session, message);
      return;
    }

    if (message.action === "shiftEnter") {
      const exitPlan = planVisualEnvironmentExit(document.getText(), offset);
      if (exitPlan !== undefined) {
        await this.postApplyEdit(
          state,
          session,
          exitPlan.range.start,
          exitPlan.range.end,
          exitPlan.insert,
          { anchor: exitPlan.cursorOffset, head: exitPlan.cursorOffset },
          message.revision,
          message.requestId,
        );
        return;
      }
    }
    await this.postInputFallback(session, message);
  }

  private async handleCompletionRequest(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "completionRequest" }>,
  ): Promise<void> {
    await state.queue;
    const generation = ++session.completionGeneration;
    session.completionActions.clear();
    const initialProjectContextKey = session.snapshot?.projectContextKey ??
      `single:${session.document.version}`;
    const respond = async (
      items: readonly VisualEditorCompletionItem[],
      providerFiltered = false,
      responseProjectContextKey = initialProjectContextKey,
    ): Promise<void> => {
      if (session.disposed || generation !== session.completionGeneration) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "completionResult",
        requestId: message.requestId,
        revision: message.revision,
        projectContextKey: responseProjectContextKey,
        from: message.from,
        ...(providerFiltered ? { providerFiltered: true } : {}),
        items,
      } satisfies VisualEditorHostMessage);
    };
    const text = state.mirrorText;
    if (
      session.disposed ||
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision ||
      message.position < 0 ||
      message.position > text.length ||
      message.from < 0 ||
      message.from > message.position ||
      session.selection.anchor !== session.selection.head ||
      session.selection.head !== message.position ||
      state.document.getText() !== text ||
      !readVisualProviderCompletionSetting(session.document.uri)
    ) {
      await respond([]);
      return;
    }

    const position = session.document.positionAt(message.position);
    const config = readConfig(session.document.uri);
    const latexContext = this.runtime.contextAt(session.document, position);
    const completionContext = visualLatexCompletionContextAt(
      text,
      message.position,
      visualCitationCommandNames(text, message.position, config.citationCommands),
    );
    // Both sides use visualLatexCompletionContextAt. Refuse a stale or
    // differently-tokenized request instead of applying a provider edit to a
    // wider range than CodeMirror requested.
    if (completionContext.from !== message.from) {
      await respond([]);
      return;
    }
    const citationOnly = completionContext.kind === "citation";
    const query = completionContext.query;
    const characterBefore = message.position > 0
      ? text.slice(message.position - 1, message.position)
      : "";
    if (!shouldActivateVisualProviderCompletion({
      explicit: message.explicit,
      query,
      characterBefore,
      contextKind: completionContext.kind,
    })) {
      await respond([]);
      return;
    }
    if (
      !isVisualEditingDocument(session.document, config) ||
      (!message.explicit && isExcludedLatexContext(
        latexContext,
        config.excludedEnvironments,
      ))
    ) {
      await respond([]);
      return;
    }

    const referenceContext: VisualReferenceCompletionContext | undefined =
      completionContext.kind === "reference" &&
          completionContext.command !== undefined
        ? {
            command: completionContext.command,
            from: completionContext.from,
            to: completionContext.to,
            query: completionContext.query,
          }
        : undefined;
    if (referenceContext !== undefined) {
      const documentVersion = session.document.version;
      const projectContext = await this.projectContexts.getContext(session.document);
      if (
        session.disposed ||
        generation !== session.completionGeneration ||
        state.pendingEdits !== 0 ||
        message.revision !== session.acceptedRevision ||
        session.selection.anchor !== session.selection.head ||
        session.selection.head !== message.position ||
        state.mirrorText !== text ||
        session.document.version !== documentVersion ||
        session.document.getText() !== text
      ) {
        await respond([]);
        return;
      }
      const orderedKeys = visualReferenceCompletionKeys(
        projectContext.labelsByKey,
        referenceContext,
      );
      const contextualSnapshot = session.snapshot?.text === text &&
          session.snapshot.version === documentVersion &&
          session.snapshot.projectContextKey ===
            `${projectContext.contextId}:${projectContext.revision}`
        ? session.snapshot
        : undefined;
      const descriptors = this.projectReferenceCompletionDescriptors(
        projectContext,
        orderedKeys,
        session.document,
        contextualSnapshot,
      );
      await respond(
        visualReferenceCompletionItems(
          text,
          referenceContext,
          orderedKeys,
          projectContext.labelsByKey,
          descriptors,
        ),
        true,
        `${projectContext.contextId}:${projectContext.revision}`,
      );
      return;
    }

    let completionList: vscode.CompletionList<vscode.CompletionItem> | undefined;
    let latexWorkshopItems: readonly vscode.CompletionItem[] = [];
    // Every citation context must go through TeXLeaf's citation controller,
    // including a genuinely empty `\cite{}` segment. The controller itself
    // keeps Zotero out of an empty picker, while still returning every entry
    // already collected in the resolved project bibliography. Falling through
    // to VS Code's generic provider here makes the empty picker silently blank
    // because native providers are not required to answer an empty query.
    if (citationOnly) {
      const cancellation = new vscode.CancellationTokenSource();
      try {
        // Return `.bib` entries without waiting for Zotero's network timeout.
        // A newer Zotero snapshot retriggers this picker below while preserving
        // the bibliography path discovered from the actual root project.
        completionList = await this.citations.provideVisualCompletionItems(
          session.document,
          position,
          cancellation.token,
          session.bibliographyRequest,
        );
      } catch (error: unknown) {
        this.output.info(
          `可视化 Zotero/文献补全查询失败：${errorMessage(error)}`,
        );
      } finally {
        cancellation.dispose();
      }
    }
    if (
      (citationOnly && completionList === undefined) ||
      (!citationOnly && completionContext.kind !== "label-definition")
    ) {
      const genericProvider = Promise.resolve(
        vscode.commands.executeCommand<
          vscode.CompletionList<vscode.CompletionItem>
        >(
          "vscode.executeCompletionItemProvider",
          session.document.uri,
          position,
          undefined,
          64,
        ),
      ).catch((error: unknown) => {
          this.output.info(
            `可视化 Provider 补全查询失败：${errorMessage(error)}`,
          );
          return undefined;
        });
      const workshopExtension = !citationOnly
        ? latexWorkshopExtension()
        : undefined;
      const workshopProvider = workshopExtension === undefined
        ? Promise.resolve<readonly vscode.CompletionItem[]>([])
        : provideLatexWorkshopVisualCompletionItems(
            workshopExtension,
            session.document,
            position,
          ).catch((error: unknown) => {
            this.output.info(
              `可视化 LaTeX Workshop 补全桥接失败：${errorMessage(error)}`,
            );
            return [];
          });
      [completionList, latexWorkshopItems] = await Promise.all([
        genericProvider,
        workshopProvider,
      ]);
    }
    const snippetContext = completionContext.kind === "command" ||
      completionContext.kind === "snippet";
    const contributedSnippets = !snippetContext
      ? []
      : await visualExtensionSnippetCompletionItems(
          session.document,
          position,
          message.from,
          this.output,
        );
    const texleafSnippets = snippetContext && config.enableCompletions
      ? visualTeXLeafSnippetCompletionItems(
          this.runtime,
          session.document,
          position,
          message.from,
          latexContext,
          config,
        )
      : [];
    const coreLatexCompletions = !snippetContext
      ? []
      : visualCoreLatexCompletionItems(
          session.document,
          position,
          message.from,
          config.citationCommands,
        );
    let labelDefinitionItems: readonly vscode.CompletionItem[] = [];
    if (completionContext.kind === "label-definition") {
      const projectContext = await this.projectContexts.getContext(session.document);
      labelDefinitionItems = visualLabelDefinitionCompletionItems(
        session.document,
        position,
        completionContext,
        projectContext.labelsByKey,
      );
      // A label defines a new key. Generic macro/argument providers do not
      // know that distinction and otherwise fill `\label{}` with unrelated
      // commands; only project-aware prefix suggestions belong here.
      completionList = undefined;
      latexWorkshopItems = [];
    }
    if (
      session.disposed ||
      generation !== session.completionGeneration ||
      message.revision !== session.acceptedRevision ||
      session.selection.head !== message.position ||
      state.document.getText() !== text
    ) {
      await respond([]);
      return;
    }

    const variables = visualCompletionSnippetVariables(
      session.document,
      session.selection,
    );
    const items: VisualEditorCompletionItem[] = [];
    const seen = new Set<string>();
    let totalText = 0;
    const providerCandidates = citationOnly
      ? completionList?.items.filter((item) =>
          item.kind === vscode.CompletionItemKind.Reference
        ) ?? []
      : visualRankedCompletionCandidates(completionContext, [
          { priority: 0, items: texleafSnippets },
          { priority: 1, items: coreLatexCompletions },
          { priority: 2, items: labelDefinitionItems },
          { priority: 3, items: contributedSnippets },
          { priority: 4, items: latexWorkshopItems },
          { priority: 5, items: completionList?.items ?? [] },
        ]);
    for (const item of providerCandidates) {
      if (items.length >= MAX_VISUAL_COMPLETION_ITEMS) {
        break;
      }
      const completionActionId = this.citations.isVisualCompletionCommand(item.command)
        ? visualCompletionActionId()
        : undefined;
      const serialized = serializeVisualCompletionItem(
        session.document,
        position,
        message.from,
        item,
        variables,
        completionActionId,
      );
      if (serialized === undefined) {
        continue;
      }
      const identity = [
        serialized.label,
        serialized.from,
        serialized.to,
        serialized.insertedText,
      ].join("\u0000");
      if (seen.has(identity)) {
        continue;
      }
      const serializedSize = visualCompletionItemTextSize(serialized);
      if (totalText + serializedSize > MAX_VISUAL_COMPLETION_TOTAL_TEXT) {
        break;
      }
      seen.add(identity);
      totalText += serializedSize;
      items.push(serialized);
      if (completionActionId !== undefined && item.command !== undefined) {
        session.completionActions.set(completionActionId, {
          baseRevision: message.revision,
          from: serialized.from,
          insertedText: serialized.insertedText,
          command: item.command,
        });
      }
    }
    await respond(items, citationOnly);
    if (citationOnly) {
      const refreshRevision = message.revision;
      const refreshPosition = message.position;
      const refreshProjectContextKey = initialProjectContextKey;
      void this.citations.waitForVisualZoteroCompletionRefresh(
        session.document,
      ).then(async (updated) => {
        if (
          !updated ||
          session.disposed ||
          generation !== session.completionGeneration ||
          session.acceptedRevision !== refreshRevision ||
          session.selection.anchor !== refreshPosition ||
          session.selection.head !== refreshPosition ||
          state.pendingEdits !== 0 ||
          state.document.getText() !== state.mirrorText
        ) {
          return;
        }
        await session.panel.webview.postMessage({
          protocol: VISUAL_EDITOR_PROTOCOL,
          type: "completionRefresh",
          revision: refreshRevision,
          projectContextKey: refreshProjectContextKey,
          position: refreshPosition,
        } satisfies VisualEditorHostMessage);
      }).catch((error: unknown) => {
        this.output.debug(
          `可视化 Zotero 补全刷新失败：${errorMessage(error)}`,
        );
      });
    }
  }

  private async handleCompletionAccepted(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<
      VisualEditorWebviewMessage,
      { readonly type: "completionAccepted" }
    >,
  ): Promise<void> {
    const action = session.completionActions.get(message.actionId);
    session.completionActions.delete(message.actionId);
    if (action === undefined) {
      return;
    }
    await state.queue;
    const completionCursor = visualCompletionFollowUpCursor(
      state.mirrorText,
      action.from,
      action.insertedText,
    );
    if (
      session.disposed ||
      message.revision !== action.baseRevision + 1 ||
      session.acceptedRevision !== message.revision ||
      state.pendingEdits !== 0 ||
      state.document.getText() !== state.mirrorText ||
      completionCursor === undefined ||
      !this.citations.isVisualCompletionCommand(action.command)
    ) {
      await this.postStatus(
        session,
        "warning",
        "引用候选对应的文档已经变化，请重新触发补全。",
      );
      return;
    }
    const caret = await this.citations.acceptVisualCompletion(
      session.document,
      // The visible selection can move because accepting a CodeMirror item
      // closes its popup and may race focus changes. The validated inserted
      // range is the stable citation position for both Enter and mouse clicks.
      session.document.positionAt(completionCursor),
      action.command,
    );
    if (caret !== undefined && !session.disposed) {
      const offset = session.document.offsetAt(caret);
      const actionSelection = { anchor: completionCursor, head: completionCursor };
      if (sameSelection(session.selection, actionSelection)) {
        // Keep host state aligned with CodeMirror without stealing a newer
        // selection made while Zotero was exporting the bibliography entry.
        session.selection = { anchor: offset, head: offset };
      }
    }
  }

  private async handleVirtualSnippetRequest(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "virtualSnippetRequest" }>,
  ): Promise<void> {
    await state.queue;
    const respond = async (
      result: {
        readonly matched: boolean;
        readonly from?: number;
        readonly to?: number;
        readonly snippet?: ReturnType<typeof replacementPartsToVirtualSnippet>;
      },
    ): Promise<void> => {
      if (session.disposed) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualSnippetResult",
        requestId: message.requestId,
        revision: message.revision,
        expectedValue: message.value,
        selectionStart: message.selectionStart,
        selectionEnd: message.selectionEnd,
        matched: result.matched,
        ...(result.from === undefined ? {} : { from: result.from }),
        ...(result.to === undefined ? {} : { to: result.to }),
        ...(result.snippet === undefined ? {} : { snippet: result.snippet }),
      } satisfies VisualEditorHostMessage);
    };
    if (!validVirtualInputRequest(state, session, message)) {
      await respond({ matched: false });
      return;
    }
    const config = readConfig(session.document.uri);
    if (!isVisualEditingDocument(session.document, config)) {
      await respond({ matched: false });
      return;
    }
    const context = virtualLatexInputContext(
      this.runtime,
      session.document,
      message.anchor,
      message.value,
      message.selectionStart,
      message.context,
    );
    if (isExcludedLatexContext(context, config.excludedEnvironments)) {
      await respond({ matched: false });
      return;
    }
    if (
      (message.activation === "auto" && !config.autoSnippets) ||
      (message.activation === "manual" &&
        config.manualTrigger !== "tab" && config.manualTrigger !== "space")
    ) {
      await respond({ matched: false });
      return;
    }
    const textBefore = message.value.slice(0, message.selectionStart);
    const textAfter = message.value.slice(
      message.selectionEnd,
      Math.min(message.value.length, message.selectionEnd + 1),
    );
    const selectedText = message.value.slice(
      message.selectionStart,
      message.selectionEnd,
    );
    const match = this.runtime.matchText(
      session.document,
      textBefore,
      textAfter,
      context,
      message.activation,
      config,
      selectedText.length === 0 ? undefined : selectedText,
    );
    if (match !== undefined) {
      await respond({
        matched: true,
        from: match.startOffset,
        to: match.endOffset,
        snippet: replacementPartsToVirtualSnippet(match.replacement),
      });
      return;
    }
    if (
      message.activation === "auto" &&
      config.autoFraction &&
      context.mathMode !== "text" &&
      message.selectionStart === message.selectionEnd &&
      message.selectionStart > 0
    ) {
      const insertedSeed = message.value.slice(message.selectionStart - 1, message.selectionStart);
      const fraction = planVisualAutoFraction(
        message.value,
        message.selectionStart,
        insertedSeed,
        {
          command: config.autoFractionCommand,
          breakingCharacters: config.autoFractionBreakingCharacters,
        },
      );
      if (fraction !== undefined) {
        await respond({
          matched: true,
          from: fraction.range.start,
          to: fraction.range.end,
          snippet: replacementPartsToVirtualSnippet(fraction.parts),
        });
        return;
      }
    }
    await respond({ matched: false });
  }

  private async handleVirtualCompletionRequest(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "virtualCompletionRequest" }>,
  ): Promise<void> {
    await state.queue;
    const respond = async (
      items: readonly VisualEditorVirtualCompletionItem[],
    ): Promise<void> => {
      if (session.disposed) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualCompletionResult",
        requestId: message.requestId,
        revision: message.revision,
        expectedValue: message.value,
        selectionStart: message.selectionStart,
        selectionEnd: message.selectionEnd,
        items,
      } satisfies VisualEditorHostMessage);
    };
    if (
      !validVirtualInputRequest(state, session, message) ||
      !readVisualProviderCompletionSetting(session.document.uri)
    ) {
      await respond([]);
      return;
    }
    const config = readConfig(session.document.uri);
    const context = virtualLatexInputContext(
      this.runtime,
      session.document,
      message.anchor,
      message.value,
      message.selectionStart,
      message.context,
    );
    if (
      !isVisualEditingDocument(session.document, config) ||
      isExcludedLatexContext(context, config.excludedEnvironments)
    ) {
      await respond([]);
      return;
    }
    const prefixMatch = /\\?[\p{L}\p{N}_:@.-]*$/u.exec(
      message.value.slice(0, message.selectionStart),
    );
    const query = prefixMatch?.[0] ?? "";
    const from = message.selectionStart - query.length;
    if (!message.explicit && query.length < 2) {
      await respond([]);
      return;
    }
    const selectedText = message.value.slice(
      message.selectionStart,
      message.selectionEnd,
    );
    const variables = {
      ...visualCompletionSnippetVariables(session.document, {
        anchor: message.anchor,
        head: message.anchor,
      }),
      TM_SELECTED_TEXT: selectedText,
      TM_CURRENT_WORD: query,
    };
    const candidates: {
      readonly item: VisualEditorVirtualCompletionItem;
      readonly rank: number;
    }[] = [];
    const seen = new Set<string>();

    for (const snippet of this.runtime.compiledSnippetsFor(session.document, config)) {
      if (
        snippet.disabled ||
        snippet.triggerKind !== "literal" ||
        !snippetAppliesToContext(snippet, context) ||
        (snippet.options.visual && selectedText.length === 0)
      ) {
        continue;
      }
      const rank = visualVirtualCompletionRank(snippet.triggerSource, query);
      if (rank < 0) {
        continue;
      }
      const parts = this.runtime.partsForSnippet(
        snippet,
        snippet.options.visual ? selectedText : undefined,
      );
      const replaceFrom = snippet.options.visual ? message.selectionStart : from;
      const replaceTo = snippet.options.visual ? message.selectionEnd : message.selectionEnd;
      const identity = `texleaf\u0000${snippet.triggerSource}\u0000${replacementPartsToText(parts)}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      candidates.push({
        rank,
        item: {
          label: snippet.triggerSource,
          ...(snippet.description === undefined ? {} : { detail: snippet.description }),
          source: "TeXLeaf",
          from: replaceFrom,
          to: replaceTo,
          expectedText: message.value.slice(replaceFrom, replaceTo),
          snippet: replacementPartsToVirtualSnippet(parts),
        },
      });
    }

    const extensionDefinitions = await visualExtensionSnippetDefinitions(
      session.document.languageId,
      this.output,
    );
    if (
      session.disposed ||
      message.revision !== session.acceptedRevision ||
      state.mirrorText !== session.document.getText()
    ) {
      await respond([]);
      return;
    }
    for (const definition of extensionDefinitions) {
      for (const prefix of definition.prefixes) {
        const rank = visualVirtualCompletionRank(prefix, query);
        if (rank < 0) {
          continue;
        }
        const encoded = vscodeSnippetToVirtualSnippet(definition.body, variables);
        if (encoded === undefined) {
          continue;
        }
        const identity = `extension\u0000${prefix}\u0000${encoded.text}`;
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        candidates.push({
          rank,
          item: {
            label: prefix,
            ...(definition.description === undefined
              ? {}
              : { detail: definition.description }),
            source: definition.source,
            from,
            to: message.selectionEnd,
            expectedText: message.value.slice(from, message.selectionEnd),
            snippet: encoded,
          },
        });
      }
    }
    for (const candidate of visualCoreLatexCompletionCandidates(
      config.citationCommands,
    )) {
      const rank = visualVirtualCompletionRank(candidate.label, query);
      if (rank < 0) {
        continue;
      }
      const encoded = vscodeSnippetToVirtualSnippet(candidate.body, variables);
      if (encoded === undefined) {
        continue;
      }
      const identity = `core\u0000${candidate.label}\u0000${encoded.text}`;
      if (seen.has(identity)) {
        continue;
      }
      seen.add(identity);
      candidates.push({
        rank,
        item: {
          label: candidate.label,
          detail: candidate.detail,
          source: "TeXLeaf · LaTeX 核心",
          from,
          to: message.selectionEnd,
          expectedText: message.value.slice(from, message.selectionEnd),
          snippet: encoded,
        },
      });
    }
    candidates.sort((left, right) =>
      left.rank - right.rank ||
      left.item.label.localeCompare(right.item.label, undefined, {
        sensitivity: "base",
      })
    );
    await respond(candidates.slice(0, MAX_VISUAL_COMPLETION_ITEMS).map(({ item }) => item));
  }

  private async handleVisualNavigation(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "navigate" }>,
  ): Promise<void> {
    await state.queue;
    const text = state.mirrorText;
    if (
      session.disposed ||
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision ||
      message.from < 0 ||
      message.to <= message.from ||
      message.to > text.length ||
      state.document.getText() !== text
    ) {
      return;
    }
    const projectGeneration = session.documentGeneration;
    // A ThuThesis chapter (and most included body fragments) intentionally has
    // no local \begin{document}. Revalidate the Webview range with the same
    // project role/language hierarchy used to create its presentation; using
    // the legacy standalone scan here would reject every ref/cite click in
    // such a child file even though the displayed record is still current.
    const projectContext = await this.projectContexts.getContext(session.document);
    if (
      session.disposed ||
      session.documentGeneration !== projectGeneration ||
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision ||
      state.document.getText() !== text
    ) {
      return;
    }
    const structure = scanVisualDocumentStructure(
      projectExecutableText(projectContext, session.document.uri, text),
      visualProjectScanOptions(projectContext, session.document.uri),
    );
    const record = structure.records.find((candidate) =>
      candidate.kind === message.kind &&
      candidate.from === message.from &&
      candidate.to === message.to
    );
    if (
      record === undefined ||
      (record.kind !== "reference" && record.kind !== "citation")
    ) {
      await this.postStatus(session, "warning", "引用已变化，无法安全跳转。");
      return;
    }

    let key: string | undefined;
    if (message.key !== undefined) {
      if (!record.keys.includes(message.key)) {
        await this.postStatus(session, "warning", "当前引用项已变化，无法安全跳转。");
        return;
      }
      key = message.key;
    } else {
      key = record.keys[0];
    }
    if (message.key === undefined && record.keys.length > 1) {
      const selected = await vscode.window.showQuickPick(
        record.keys.map((candidate) => ({ label: candidate })),
        {
          placeHolder: message.kind === "reference"
            ? "选择要跳转到的 label"
            : "选择要跳转到的参考文献",
        },
      );
      key = selected?.label;
    }
    if (key === undefined) {
      return;
    }
    if (
      session.disposed ||
      session.documentGeneration !== projectGeneration ||
      state.pendingEdits !== 0 ||
      session.acceptedRevision !== message.revision ||
      state.document.getText() !== text
    ) {
      await this.postStatus(session, "warning", "文档已变化，本次跳转已取消。");
      return;
    }

    if (record.kind === "reference") {
      if (projectContext.graphIncomplete) {
        await this.postStatus(
          session,
          "warning",
          "项目包含关系不完整，已停止跨文件引用跳转以避免定位到错误目标。",
        );
        return;
      }
      const targets = projectContext.labelsByKey.get(key) ?? [];
      const repeatedOccurrence = targets.some((target) => target.occurrenceCount !== 1);
      if (targets.length !== 1 || repeatedOccurrence) {
        await this.postStatus(
          session,
          "warning",
          targets.length === 0
            ? `没有找到 label “${key}”。`
            : `label “${key}” 在项目中定义或执行了多次，已停止跳转以避免定位错误。`,
        );
        return;
      }
      if (
        session.disposed ||
        session.documentGeneration !== projectGeneration ||
        state.pendingEdits !== 0 ||
        session.acceptedRevision !== message.revision ||
        state.document.getText() !== text
      ) {
        await this.postStatus(session, "warning", "项目或文档已变化，本次跳转已取消。");
        return;
      }
      const target = targets[0]!;
      const targetFile = projectFileFor(projectContext, target.uri);
      if (
        targetFile === undefined ||
        targetFile.text.slice(target.keyFrom, target.keyTo) !== key
      ) {
        await this.postStatus(session, "warning", "引用目标已变化，无法安全跳转。");
        return;
      }
      await this.rememberNavigationOrigin(session, {
        anchor: record.from,
        head: record.from,
      });
      if (sameUri(target.uri, session.document.uri)) {
        if (
          session.disposed ||
          session.documentGeneration !== projectGeneration ||
          state.pendingEdits !== 0 ||
          session.acceptedRevision !== message.revision ||
          state.document.getText() !== text ||
          state.document.getText().slice(target.keyFrom, target.keyTo) !== key
        ) {
          await this.postStatus(session, "warning", "文档已变化，本次跳转已取消。");
          return;
        }
        session.selection = { anchor: target.keyFrom, head: target.keyFrom };
        await session.panel.webview.postMessage({
          protocol: VISUAL_EDITOR_PROTOCOL,
          type: "focus",
          selection: session.selection,
        } satisfies VisualEditorHostMessage);
      } else if (!await this.focusVisualRange(
        target.uri,
        target.keyFrom,
        target.keyFrom,
        false,
        {
          from: target.keyFrom,
          to: target.keyTo,
          expectedText: key,
        },
      )) {
        await this.postStatus(session, "warning", "无法打开跨文件引用目标。");
      }
      return;
    }

    const manualBibliographies = structure.records.filter(
      (candidate): candidate is VisualBibliographyRecord =>
        candidate.kind === "bibliography" && candidate.manual,
    );
    if (manualBibliographies.length > 0) {
      const manualTargets = manualBibliographies.flatMap((bibliography) =>
        bibliography.entries.filter(
          (entry) => entry.key === key && entry.sourceFrom !== undefined,
        )
      );
      if (manualTargets.length !== 1) {
        await this.postStatus(
          session,
          "warning",
          manualTargets.length === 0
            ? `没有在 thebibliography 中找到 “${key}”。`
            : `thebibliography 中存在多个 “${key}”，已停止跳转。`,
        );
        return;
      }
      const position = manualTargets[0]!.sourceFrom!;
      await this.rememberNavigationOrigin(session, {
        anchor: record.from,
        head: record.from,
      });
      session.selection = { anchor: position, head: position };
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "focus",
        selection: session.selection,
      } satisfies VisualEditorHostMessage);
      return;
    }

    let bibliographyUris: readonly vscode.Uri[];
    try {
      bibliographyUris = await this.resolveProjectBibliographyUris(
        projectContext,
        session.document,
        structure.bibliographyPaths,
        session.bibliographyRequest,
      );
    } catch (error) {
      await this.postStatus(
        session,
        "warning",
        `无法解析项目参考文献库：${errorMessage(error)}`,
      );
      return;
    }
    if (
      session.disposed ||
      session.documentGeneration !== projectGeneration ||
      state.pendingEdits !== 0 ||
      session.acceptedRevision !== message.revision ||
      state.document.getText() !== text
    ) {
      return;
    }
    const result = await this.citations.revealProjectBibliographyEntry(
      bibliographyUris,
      key,
    );
    if (result.status === "found") {
      await this.rememberNavigationOrigin(session, {
        anchor: record.from,
        head: record.from,
      });
    } else {
      await this.postStatus(
        session,
        "warning",
        result.status === "duplicate"
          ? `参考文献 “${key}” 在项目参考文献库中定义了多次，已停止跳转。`
          : result.searchedUris.length === 0
          ? "当前项目没有可搜索的 .bib 参考文献库。"
          : `没有在 ${result.searchedUris.length} 个项目参考文献库中找到 “${key}”。`,
      );
    }
  }

  private async resolveProjectBibliographyUris(
    context: LatexProjectContext,
    currentDocument: vscode.TextDocument,
    currentPaths: readonly string[],
    fallbackPath: string | undefined,
  ): Promise<readonly vscode.Uri[]> {
    const declarations: Array<{
      readonly documentUri: vscode.Uri;
      readonly bibliographyPath: string;
    }> = [];
    const reachableFiles = context.files
      .filter((file) => file.reachableFromRoot)
      .sort((left, right) => left.texOrder - right.texOrder);

    for (const file of reachableFiles) {
      const bibliographyPaths = sameUri(file.uri, currentDocument.uri)
        ? currentPaths
        : scanVisualDocumentStructure(
            projectExecutableText(context, file.uri, file.text),
            visualProjectScanOptions(context, file.uri),
          ).bibliographyPaths;
      for (const bibliographyPath of bibliographyPaths) {
        declarations.push({ documentUri: file.uri, bibliographyPath });
        if (declarations.length > MAX_VISUAL_PROJECT_BIBLIOGRAPHIES) {
          throw new Error(
            `项目声明的参考文献库超过安全上限 ${MAX_VISUAL_PROJECT_BIBLIOGRAPHIES} 个`,
          );
        }
      }
    }

    // Keep the configured library as a fallback for projects that use a class
    // or package macro which the lightweight structure scanner cannot see.
    if (fallbackPath !== undefined && fallbackPath.trim().length > 0) {
      declarations.push({
        documentUri: currentDocument.uri,
        bibliographyPath: fallbackPath,
      });
    }

    const result: vscode.Uri[] = [];
    const seen = new Set<string>();
    for (const declaration of declarations) {
      const sourceDocument = sameUri(declaration.documentUri, currentDocument.uri)
        ? currentDocument
        : await vscode.workspace.openTextDocument(declaration.documentUri);
      const bibliographyUri = await this.citations.resolveProjectBibliographyUri(
        sourceDocument,
        declaration.bibliographyPath,
      );
      const key = visualUriKey(bibliographyUri);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(bibliographyUri);
      if (result.length > MAX_VISUAL_PROJECT_BIBLIOGRAPHIES) {
        throw new Error(
          `项目参考文献库超过安全上限 ${MAX_VISUAL_PROJECT_BIBLIOGRAPHIES} 个`,
        );
      }
    }
    return result;
  }

  private async handleAiIssueAction(
    state: VisualDocumentState,
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "aiIssueAction" }>,
  ): Promise<void> {
    await state.queue;
    if (
      session.disposed ||
      state.pendingEdits !== 0 ||
      message.revision !== session.acceptedRevision
    ) {
      return;
    }
    const issue = visualAiIssuesFor(this.aiWriting, session.document).find(
      (candidate) => candidate.id === message.issueId,
    );
    if (issue === undefined) {
      await this.postAiIssues(session);
      return;
    }
    if (message.action === "apply") {
      // Keep a visual-editor action inside CodeMirror's own history. Applying
      // the same replacement through WorkspaceEdit first makes the following
      // document snapshot an external, history-free reset; Ctrl+Z can then
      // undo an older local edit and restore its stale selection (frequently
      // the end of a long document). The mirrored `edit` emitted by this
      // applyEdit transaction still reaches the canonical TextDocument, while
      // one local Ctrl+Z now restores both the prose and its exact caret.
      const delta = issue.replacement.length - (issue.to - issue.from);
      const mapOffset = (offset: number): number =>
        offset <= issue.from
          ? offset
          : offset >= issue.to
          ? offset + delta
          : issue.from + issue.replacement.length;
      const nextLength = state.mirrorText.length + delta;
      const selection = clampSelection({
        anchor: mapOffset(session.selection.anchor),
        head: mapOffset(session.selection.head),
      }, nextLength);
      const posted = await this.postApplyEdit(
        state,
        session,
        issue.from,
        issue.to,
        issue.replacement,
        selection,
        message.revision,
      );
      if (!posted) {
        await this.postAiIssues(session);
      }
      return;
    } else {
      this.aiWriting.ignoreVisualIssue(session.document, message.issueId);
    }
    await this.postAiIssues(session);
  }

  private async rememberNavigationOrigin(
    session: VisualEditorSession,
    requestedSelection: VisualEditorSelection = session.selection,
  ): Promise<void> {
    const selection = clampSelection(
      requestedSelection,
      this.stateFor(session.document).mirrorText.length,
    );
    const previous = this.navigationHistory.at(-1);
    if (
      previous === undefined ||
      previous.uri !== session.document.uri.toString() ||
      previous.selection.anchor !== selection.anchor ||
      previous.selection.head !== selection.head
    ) {
      this.navigationHistory.push({
        uri: session.document.uri.toString(),
        selection,
      });
      if (this.navigationHistory.length > 100) {
        this.navigationHistory.splice(0, this.navigationHistory.length - 100);
      }
    }
    this.activeSession = session;
    await vscode.commands.executeCommand(
      "setContext",
      "texleaf.visualNavigationAvailable",
      true,
    );
  }

  private async navigateBack(
    preferred: VisualEditorSession | undefined,
  ): Promise<void> {
    const session = preferred ?? this.activeSession;
    const location = this.navigationHistory.pop();
    if (session?.disposed === true || location === undefined) {
      await vscode.commands.executeCommand(
        "setContext",
        "texleaf.visualNavigationAvailable",
        false,
      );
      await vscode.commands.executeCommand("workbench.action.navigateBack");
      return;
    }
    const focused = await this.focusVisualRange(
      location.uri,
      location.selection.anchor,
      location.selection.head,
      false,
    );
    if (!focused) {
      this.navigationHistory.push(location);
    }
    await vscode.commands.executeCommand(
      "setContext",
      "texleaf.visualNavigationAvailable",
      this.navigationHistory.length > 0,
    );
  }

  private projectFileSnapshot(
    context: LatexProjectContext,
    file: LatexProjectFile,
  ): VisualSnapshot {
    const config = readConfig(file.uri);
    const environment = projectMathPreviewEnvironment(context, config);
    const structureOptions = visualProjectScanOptions(context, file.uri);
    const cacheKey = JSON.stringify([
      context.contextId,
      context.revision,
      context.rootUri?.toString(),
      file.uri.toString(),
      file.contentRevision,
      file.role,
      context.rootLanguage,
      context.numberingRoot,
      environment.macroFingerprint,
      config.mathPreviewMaxSourceLength,
      config.mathPreviewScale,
    ]);
    const cached = this.projectFileSnapshotCache.get(cacheKey);
    if (cached !== undefined) {
      this.projectFileSnapshotCache.delete(cacheKey);
      this.projectFileSnapshotCache.set(cacheKey, cached);
      return cached;
    }
    const executableText = projectExecutableText(context, file.uri, file.text);
    const snapshot = buildVisualSnapshot(
      file.text,
      file.documentVersion ?? 0,
      scanMathPreviewDocument(executableText, {
        maxSourceLength: config.mathPreviewMaxSourceLength,
        fragmentKind: structureOptions.fragmentKind ?? "standalone",
        inheritedMacroEnvironment: environment,
      }),
      scanVisualDocumentStructure(executableText, structureOptions).records,
      config.mathPreviewScale,
      context,
    );
    this.projectFileSnapshotCache.set(cacheKey, snapshot);
    while (this.projectFileSnapshotCache.size > 128) {
      const oldest = this.projectFileSnapshotCache.keys().next().value as string | undefined;
      if (oldest === undefined) {
        break;
      }
      this.projectFileSnapshotCache.delete(oldest);
    }
    return snapshot;
  }

  /**
   * Prepare just enough contextual snapshots to classify the highest-ranked
   * project labels. One file snapshot serves every label in that file; the
   * distinct-file ceiling prevents a broad project from making completion
   * latency proportional to its full include graph.
   */
  private projectReferenceCompletionDescriptors(
    context: LatexProjectContext,
    orderedKeys: readonly string[],
    document: vscode.TextDocument,
    currentSnapshot?: VisualSnapshot,
  ): ReadonlyMap<string, VisualProjectReferenceDescriptor> {
    const descriptors = new Map<string, VisualProjectReferenceDescriptor>();
    const snapshotsByUri = new Map<string, VisualSnapshot>();
    const preloadedUris = new Set<string>();
    const contextKey = `${context.contextId}:${context.revision}`;
    if (
      currentSnapshot !== undefined &&
      currentSnapshot.projectContextKey === contextKey &&
      currentSnapshot.text === document.getText()
    ) {
      snapshotsByUri.set(document.uri.toString(), currentSnapshot);
    }

    for (const key of orderedKeys) {
      const targets = context.labelsByKey.get(key) ?? [];
      const source = visualProjectReferenceSource(context, targets);
      if (
        context.graphIncomplete ||
        targets.length !== 1 ||
        targets[0]!.occurrenceCount !== 1
      ) {
        descriptors.set(key, { snapshot: undefined, source });
        continue;
      }

      const target = targets[0]!;
      const targetKey = target.uri.toString();
      let snapshot = snapshotsByUri.get(targetKey);
      if (snapshot === undefined && !snapshotsByUri.has(targetKey)) {
        if (preloadedUris.size < MAX_VISUAL_REFERENCE_PREVIEW_FILES) {
          const file = projectFileFor(context, target.uri);
          if (file !== undefined) {
            snapshot = this.projectFileSnapshot(context, file);
            snapshotsByUri.set(targetKey, snapshot);
            preloadedUris.add(targetKey);
          }
        }
      }
      descriptors.set(key, { snapshot, source });
    }
    return descriptors;
  }

  private async resolveProjectReference(
    document: vscode.TextDocument,
    key: string,
    currentSnapshot?: VisualSnapshot,
  ): Promise<VisualProjectReferenceResolution | undefined> {
    const context = await this.projectContexts.getContext(document);
    if (context.graphIncomplete) {
      return undefined;
    }
    const targets = context.labelsByKey.get(key) ?? [];
    if (targets.length !== 1 || targets[0]!.occurrenceCount !== 1) {
      return undefined;
    }
    const target = targets[0]!;
    if (
      currentSnapshot !== undefined &&
      currentSnapshot.projectContextKey === `${context.contextId}:${context.revision}` &&
      sameUri(target.uri, document.uri) &&
      currentSnapshot.text === document.getText()
    ) {
      return { context, target, snapshot: currentSnapshot };
    }
    const file = projectFileFor(context, target.uri);
    if (file === undefined) {
      return undefined;
    }
    return {
      context,
      target,
      snapshot: this.projectFileSnapshot(context, file),
    };
  }

  private async postSnippet(
    state: VisualDocumentState,
    session: VisualEditorSession,
    from: number,
    to: number,
    parts: readonly ReplacementPart[],
    revision: number,
    requestId?: number,
  ): Promise<boolean> {
    const text = state.mirrorText;
    if (
      session.disposed ||
      revision !== session.acceptedRevision ||
      from < 0 ||
      to < from ||
      to > text.length
    ) {
      return false;
    }
    const config = readConfig(session.document.uri);
    const modifiers = config.autoEnlargeBrackets
      ? planVisualAutoEnlarge(
          text,
          from,
          to,
          parts,
          config.autoEnlargeTriggers,
        )
      : [];
    const encoding = replacementPartsToCodeMirrorSnippet(parts);
    const posted = await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "applySnippet",
      revision,
      ...(requestId === undefined ? {} : { requestId }),
      from,
      to,
      expectedText: text.slice(from, to),
      template: encoding.template,
      insertedText: replacementPartsToText(parts),
      openBraceMarker: encoding.openBraceMarker,
      closeBraceMarker: encoding.closeBraceMarker,
      hasSnippetFields: parts.some((part) => part.kind === "tabstop"),
      modifiers,
    } satisfies VisualEditorHostMessage);
    return posted;
  }

  private async postApplyEdit(
    state: VisualDocumentState,
    session: VisualEditorSession,
    from: number,
    to: number,
    insert: string,
    selection: VisualEditorSelection,
    revision: number,
    requestId?: number,
  ): Promise<boolean> {
    const text = state.mirrorText;
    if (
      session.disposed ||
      revision !== session.acceptedRevision ||
      from < 0 ||
      to < from ||
      to > text.length
    ) {
      return false;
    }
    return session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "applyEdit",
      revision,
      ...(requestId === undefined ? {} : { requestId }),
      from,
      to,
      expectedText: text.slice(from, to),
      insert,
      selection,
    } satisfies VisualEditorHostMessage);
  }

  private async postInputFallback(
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "inputRequest" }>,
  ): Promise<void> {
    if (session.disposed) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "inputFallback",
      revision: message.revision,
      requestId: message.requestId,
      action: message.action,
    } satisfies VisualEditorHostMessage);
  }

  private handleDocumentChanged(document: vscode.TextDocument): void {
    const state = this.states.get(document.uri.toString());
    if (state === undefined || state.pendingEdits > 0) {
      return;
    }
    const documentText = document.getText();
    if (documentText === state.mirrorText) {
      // onDidChangeTextDocument may be delivered after workspace.applyEdit has
      // resolved and pendingEdits has returned to zero. The optimistic mirror
      // already contains that exact text, so this is a late notification for
      // our own edit—not an external/native-editor reset. Resetting revisions
      // here would force a full-document replacement into CodeMirror and map
      // away its local undo changes while retaining only the old selection.
      return;
    }
    state.epoch += 1;
    state.mirrorText = documentText;
    // Native/external edits can replace arbitrary grammar state. Unlike edits
    // originating in CodeMirror, they cannot safely reuse mapped TextMate
    // ranges, so refresh exact theme tokens on this synchronization only.
    state.refreshSyntaxOnNextSync = true;
    for (const session of state.sessions) {
      session.acceptedRevision = 0;
      session.syntaxRefreshRequired = true;
      session.syntaxRefreshAttempts = 0;
    }
    this.scheduleDocumentSync(state, DOCUMENT_SYNC_DELAY_MS);
  }

  private invalidatePendingEdits(state: VisualDocumentState): void {
    state.epoch += 1;
    state.pendingEdits = 0;
    state.mirrorText = state.document.getText();
    for (const session of state.sessions) {
      session.acceptedRevision = 0;
      void this.postDocument(session, "document");
    }
  }

  private scheduleDocumentSync(
    state: VisualDocumentState,
    delay: number,
    kind: "normal" | "edit" = "normal",
  ): void {
    if (state.syncTimer !== undefined) {
      clearTimeout(state.syncTimer);
    }
    state.syncKind = kind;
    state.syncTimer = setTimeout(() => {
      state.syncTimer = undefined;
      const scheduledKind = state.syncKind;
      state.syncKind = undefined;
      this.traceMathPreview("document:timer", {
        kind: scheduledKind,
        quietFor: Date.now() - state.lastCursorPreviewAt,
      });
      if (scheduledKind === "edit") {
        const remainingQuietTime =
          state.lastCursorPreviewAt + CURSOR_PREVIEW_DOCUMENT_SYNC_QUIET_MS -
          Date.now();
        if (remainingQuietTime > 0) {
          this.scheduleDocumentSync(state, remainingQuietTime, "edit");
          return;
        }
      }
      if (state.pendingEdits > 0) {
        this.scheduleDocumentSync(
          state,
          DOCUMENT_SYNC_DELAY_MS,
          scheduledKind ?? "normal",
        );
        return;
      }
      for (const session of state.sessions) {
        void this.postDocument(session, "document");
      }
    }, delay);
  }

  private invalidateBibliographyPreviews(): void {
    for (const state of this.states.values()) {
      for (const session of state.sessions) {
        session.bibliographyRequest = undefined;
        session.bibliographyEntries = undefined;
      }
      this.scheduleDocumentSync(state, DOCUMENT_SYNC_DELAY_MS);
    }
  }

  private async postDocument(
    session: VisualEditorSession,
    type: "initialize" | "document",
  ): Promise<void> {
    if (!session.ready || session.disposed) {
      return;
    }
    const documentGeneration = ++session.documentGeneration;
    this.traceMathPreview("document:start", {
      generation: documentGeneration,
      version: session.document.version,
    });
    const state = this.stateFor(session.document);
    if (state.pendingEdits > 0) {
      return;
    }
    const text = session.document.getText();
    const version = session.document.version;
    const config = readConfig(session.document.uri);
    const projectContext = await this.projectContexts.getContext(session.document);
    this.traceMathPreview("document:context", { generation: documentGeneration });
    if (
      session.disposed ||
      session.documentGeneration !== documentGeneration ||
      session.document.version !== version ||
      session.document.getText() !== text
    ) {
      return;
    }
    const projectEnvironment = projectMathPreviewEnvironment(projectContext, config);
    const structureOptions = visualProjectScanOptions(
      projectContext,
      session.document.uri,
    );
    // Full TextMate tokenization is synchronous and can take seconds for a
    // large paper with injection grammars. Local CodeMirror edits already map
    // the existing decorations through every change, so do not re-tokenize the
    // whole document after each 260 ms typing pause. This also keeps cursor
    // Math Preview messages responsive. Re-tokenize on initial load, theme
    // changes, and external/native-editor replacements instead.
    const refreshSyntax = type === "initialize" ||
      session.syntaxRefreshRequired || state.refreshSyntaxOnNextSync;
    const executableText = projectExecutableText(
      projectContext,
      session.document.uri,
      text,
    );
    let structure = scanVisualDocumentStructure(executableText, structureOptions);
    this.traceMathPreview("document:structure", { generation: documentGeneration });
    const rootFile = projectContext.rootUri === undefined
      ? undefined
      : projectFileFor(projectContext, projectContext.rootUri);
    const rootBibliographyPaths = rootFile === undefined ||
        sameUri(rootFile.uri, session.document.uri)
      ? structure.bibliographyPaths
      : scanVisualDocumentStructure(
          projectExecutableText(projectContext, rootFile.uri, rootFile.text),
          visualProjectScanOptions(projectContext, rootFile.uri),
        ).bibliographyPaths;
    const needsExternalBibliography = structure.citedKeys.length > 0 ||
      structure.records.some(
        (record) => record.kind === "bibliography" && !record.manual,
      );
    if (needsExternalBibliography) {
      const requestedPath = structure.bibliographyPaths[0] ??
        rootBibliographyPaths[0] ?? config.bibliographyFile;
      if (
        session.bibliographyRequest !== requestedPath ||
        session.bibliographyEntries === undefined
      ) {
        try {
          const bibliographyDocument = projectContext.rootUri === undefined
            ? session.document
            : await vscode.workspace.openTextDocument(projectContext.rootUri);
          const bibliography = await this.citations.readBibliographyPreview(
            bibliographyDocument,
            requestedPath,
          );
          session.bibliographyRequest = bibliography.configuredPath;
          session.bibliographyEntries = bibliography.entries;
        } catch (error: unknown) {
          session.bibliographyRequest = requestedPath;
          session.bibliographyEntries = [];
          this.output.warn(`可视化参考文献预览读取失败：${errorMessage(error)}`);
        }
      }
      if (
        session.disposed ||
        session.documentGeneration !== documentGeneration ||
        session.document.version !== version ||
        session.document.getText() !== text
      ) {
        return;
      }
      structure = resolveVisualBibliography(
        structure,
        session.bibliographyEntries ?? [],
        path.posix.basename(
          (session.bibliographyRequest ?? requestedPath).replaceAll("\\", "/"),
        ),
      );
    }
    structure = await resolveVisualImagePreviews(
      session.panel.webview,
      session.document,
      structure,
      projectContext.rootUri,
    );
    if (
      session.disposed ||
      session.documentGeneration !== documentGeneration ||
      session.document.version !== version ||
      session.document.getText() !== text
    ) {
      return;
    }
    const preview = scanMathPreviewDocument(executableText, {
      maxSourceLength: config.mathPreviewMaxSourceLength,
      fragmentKind: structureOptions.fragmentKind ?? "standalone",
      inheritedMacroEnvironment: projectEnvironment,
    });
    this.traceMathPreview("document:formula-scan", { generation: documentGeneration });
    structure = await resolveVisualStructureMath(
      this.renderer,
      structure,
      preview,
      config.mathPreviewScale,
    );
    this.traceMathPreview("document:structure-math", { generation: documentGeneration });
    if (
      session.disposed ||
      session.documentGeneration !== documentGeneration ||
      session.document.version !== version ||
      session.document.getText() !== text
    ) {
      return;
    }
    const snapshot = buildVisualSnapshot(
      text,
      version,
      preview,
      structure.records,
      config.mathPreviewScale,
      projectContext,
    );
    const records = snapshot.records;
    session.snapshot = snapshot;
    session.renderGeneration += 1;
    resetViewportRenderRequest(session);
    const currentFormulaIds = new Set(records.map((record) => record.id));
    for (const renderedId of session.renderedFormulaIds) {
      if (!currentFormulaIds.has(renderedId)) {
        session.renderedFormulaIds.delete(renderedId);
      }
    }
    const compatibility = this.shouldBridgeLatexWorkshop(session.document.uri);
    const aiIssues = visualAiIssuesFor(this.aiWriting, session.document);
    const diagnostics = visualDiagnosticsFor(session.document);
    const background = resolveVisualEditorBackground(
      session.panel.webview,
      session.document.uri,
      session.backgroundViewColumn,
    );
    const [syntaxPalette, syntaxTokens, templateCatalog] = await Promise.all([
      this.syntaxTheme.resolve(session.document.uri),
      refreshSyntax
        ? this.syntaxTheme.tokenize(text, session.document.uri)
        : Promise.resolve(undefined),
      this.templates.listTemplates(),
    ]);
    if (
      session.disposed ||
      session.documentGeneration !== documentGeneration ||
      session.document.version !== version ||
      session.document.getText() !== text
    ) {
      return;
    }
    const message: VisualEditorHostMessage = {
      protocol: VISUAL_EDITOR_PROTOCOL,
      type,
      text,
      version,
      revision: session.acceptedRevision,
      projectContextKey: snapshot.projectContextKey,
      editable: session.document.uri.scheme === "file" ||
        session.document.uri.scheme === "untitled",
      formulas: records,
      structures: structure.records,
      ...(type === "initialize" ? { selection: session.selection } : {}),
      mathPreviewPlacement: config.mathPreviewPlacement,
      capabilities: {
        latexWorkshopInstalled: latexWorkshopExtension() !== undefined,
        latexWorkshopCompatibility: compatibility,
      },
      inputFeatures: {
        enabled: config.enabled,
        manualTrigger: config.manualTrigger,
        matrixShortcuts: config.matrixShortcuts,
        matrixEnvironments: config.matrixEnvironments,
        autoDeleteMathDelimiters: config.autoDeleteMathDelimiters,
        providerCompletions: readVisualProviderCompletionSetting(
          session.document.uri,
        ),
        citationCommands: config.citationCommands,
      },
      ...(background === undefined ? {} : { background }),
      ...(syntaxPalette === undefined ? {} : { syntaxPalette }),
      ...(syntaxTokens === undefined ? {} : { syntaxTokens }),
      aiIssues,
      diagnostics,
      templates: templateCatalog.templates.map(
        ({ id, name, description, isFactory }): VisualEditorTemplateMenuItem => ({
          id,
          name,
          description,
          isFactory,
        }),
      ),
    };
    if (
      session.disposed ||
      session.documentGeneration !== documentGeneration ||
      session.document.version !== version ||
      session.document.getText() !== text
    ) {
      return;
    }
    const delivered = await session.panel.webview.postMessage(message);
    this.traceMathPreview("document:posted", {
      generation: documentGeneration,
      delivered,
    });
    if (
      refreshSyntax &&
      delivered &&
      session.document.version === version &&
      session.document.getText() === text
    ) {
      if (syntaxTokens !== undefined) {
        session.syntaxRefreshRequired = false;
        session.syntaxRefreshAttempts = 0;
        state.refreshSyntaxOnNextSync = [...state.sessions].some(
          (candidate) => candidate.ready && candidate.syntaxRefreshRequired,
        );
      } else {
        // On a fresh Extension Host, LaTeX Workshop's grammar contribution can
        // appear just after this custom editor's first ready message.  The old
        // code treated an omitted token snapshot as success, permanently
        // leaving that visual tab on fallback colours.  Retry a few times with
        // a rebuilt grammar runtime; future ordinary document syncs can still
        // retry after this bounded startup window.
        const retryDelay = SYNTAX_REFRESH_RETRY_DELAYS_MS[
          session.syntaxRefreshAttempts
        ];
        if (retryDelay !== undefined) {
          session.syntaxRefreshAttempts += 1;
          this.syntaxTheme.invalidateRuntime();
          this.scheduleDocumentSync(state, retryDelay);
        }
      }
    }
  }

  private async postAiIssues(session: VisualEditorSession): Promise<void> {
    if (!session.ready || session.disposed) {
      return;
    }
    const state = this.stateFor(session.document);
    if (state.pendingEdits > 0 || state.mirrorText !== session.document.getText()) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "aiIssues",
      version: session.document.version,
      revision: session.acceptedRevision,
      issues: visualAiIssuesFor(this.aiWriting, session.document),
    } satisfies VisualEditorHostMessage);
  }

  private async postDiagnostics(session: VisualEditorSession): Promise<void> {
    if (!session.ready || session.disposed) {
      return;
    }
    const state = this.stateFor(session.document);
    if (state.pendingEdits > 0 || state.mirrorText !== session.document.getText()) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "diagnostics",
      version: session.document.version,
      revision: session.acceptedRevision,
      diagnostics: visualDiagnosticsFor(session.document),
    } satisfies VisualEditorHostMessage);
  }

  private async handleDiagnosticInsightRequest(
    session: VisualEditorSession,
    message: Extract<
      VisualEditorWebviewMessage,
      { readonly type: "diagnosticInsightRequest" }
    >,
  ): Promise<void> {
    if (
      session.disposed ||
      message.revision !== session.acceptedRevision
    ) {
      return;
    }
    const diagnostics = vscode.languages.getDiagnostics(session.document.uri);
    const index = diagnostics.findIndex((diagnostic, diagnosticIndex) =>
      visualDiagnosticId(session.document, diagnostic, diagnosticIndex) ===
        message.diagnosticId
    );
    const diagnostic = index < 0 ? undefined : diagnostics[index];
    const version = session.document.version;
    const insight = diagnostic === undefined
      ? undefined
      : await this.aiWriting.explainDiagnostic(session.document, diagnostic);
    if (
      session.disposed ||
      session.document.version !== version ||
      session.acceptedRevision !== message.revision
    ) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "diagnosticInsight",
      requestId: message.requestId,
      version,
      revision: message.revision,
      diagnosticId: message.diagnosticId,
      available: insight !== undefined,
      ...(insight === undefined
        ? {}
        : {
            explanation: insight.explanation,
            suggestion: insight.suggestion,
            model: insight.model,
          }),
    } satisfies VisualEditorHostMessage);
  }

  private scheduleDiagnosticsSync(state: VisualDocumentState): void {
    if (state.diagnosticTimer !== undefined) {
      clearTimeout(state.diagnosticTimer);
    }
    state.diagnosticTimer = setTimeout(() => {
      state.diagnosticTimer = undefined;
      if (this.disposed || this.states.get(state.key) !== state) {
        return;
      }
      for (const session of state.sessions) {
        void this.postDiagnostics(session);
      }
    }, 220);
  }

  private async renderViewport(
    session: VisualEditorSession,
    version: number,
    requestedFrom: number,
    requestedTo: number,
  ): Promise<void> {
    if (!readConfig(session.document.uri).mathPreviewEnabled || session.disposed) {
      return;
    }
    const snapshot = session.snapshot;
    if (snapshot === undefined || snapshot.version !== version) {
      return;
    }
    const normalizedFrom = clampInteger(
      Math.min(requestedFrom, requestedTo),
      0,
      snapshot.text.length,
    );
    const normalizedTo = clampInteger(
      Math.max(requestedFrom, requestedTo),
      normalizedFrom,
      snapshot.text.length,
    );
    const requestGeneration = session.renderGeneration;
    const previous = session.viewportRenderRequest;
    const sequence = previous !== undefined &&
        previous.version === version &&
        previous.generation === requestGeneration &&
        visualFormulaViewportsKeepPriority(
          previous.anchorFrom,
          previous.anchorTo,
          normalizedFrom,
          normalizedTo,
        )
      ? previous.sequence
      : ++session.viewportRenderSequence;
    const anchorFrom = sequence === previous?.sequence
      ? previous.anchorFrom
      : normalizedFrom;
    const anchorTo = sequence === previous?.sequence
      ? previous.anchorTo
      : normalizedTo;
    if (session.viewportRenderBudgetSequence !== sequence) {
      session.viewportRenderBudgetSequence = sequence;
      session.viewportRenderBudgetUsed = 0;
    }
    session.viewportRenderRequest = {
      sequence,
      generation: requestGeneration,
      version,
      from: normalizedFrom,
      to: normalizedTo,
      anchorFrom,
      anchorTo,
    };
    if (session.viewportRenderActive) {
      // One pump always observes the latest request. A fast scrollbar gesture
      // therefore replaces the old viewport instead of queueing another
      // 48-formula render loop behind it.
      return;
    }

    session.viewportRenderActive = true;
    let immediateSequence = -1;
    const state = this.stateFor(session.document);
    try {
      while (!session.disposed) {
        await waitForViewportInputQuiet(state, session);
        const request: VisualViewportRenderRequest | undefined =
          session.viewportRenderRequest;
        const currentSnapshot = session.snapshot;
        if (
          request === undefined ||
          currentSnapshot === undefined ||
          currentSnapshot.version !== request.version ||
          request.generation !== session.renderGeneration
        ) {
          return;
        }
        const generation = request.generation;
        if (session.viewportRenderBudgetSequence !== request.sequence) {
          session.viewportRenderBudgetSequence = request.sequence;
          session.viewportRenderBudgetUsed = 0;
        }
        const remainingBudget = MAX_VISIBLE_FORMULAS -
          session.viewportRenderBudgetUsed;
        if (remainingBudget <= 0) {
          return;
        }
        const from = clampInteger(
          request.from - 2_000,
          0,
          currentSnapshot.text.length,
        );
        const to = clampInteger(
          request.to + 2_000,
          from,
          currentSnapshot.text.length,
        );
        const firstVisibleResult = immediateSequence !== request.sequence;
        const batchSize = Math.min(
          VIEWPORT_FORMULA_RENDER_BATCH_SIZE,
          remainingBudget,
        );
        const candidates = selectVisualFormulaViewportBatch(
          currentSnapshot.records,
          session.renderedFormulaIds,
          from,
          to,
          batchSize,
        );
        if (candidates.length === 0) {
          return;
        }

        const config = readConfig(session.document.uri);
        const results: VisualFormulaRenderResult[] = [];
        const errors: VisualFormulaRenderError[] = [];
        let reprioritize = false;
        let skippedWithoutAsset = false;
        for (const record of candidates) {
          await waitForViewportInputQuiet(state, session);
          const activeRequest: VisualViewportRenderRequest | undefined =
            session.viewportRenderRequest;
          if (
            session.disposed ||
            generation !== session.renderGeneration ||
            session.snapshot !== currentSnapshot ||
            activeRequest?.sequence !== request.sequence ||
            !visualFormulaViewportsKeepPriority(
              request.from,
              request.to,
              activeRequest.from,
              activeRequest.to,
            )
          ) {
            reprioritize = true;
            break;
          }
          if (
            session.viewportRenderBudgetSequence !== request.sequence ||
            session.viewportRenderBudgetUsed >= MAX_VISIBLE_FORMULAS
          ) {
            reprioritize = true;
            break;
          }
          session.viewportRenderBudgetUsed += 1;
          const formula = currentSnapshot.formulaById.get(record.id);
          const input = formula === undefined
            ? undefined
            : createMathPreviewRenderInput(
                currentSnapshot.text,
                formula,
                currentSnapshot.preview,
              );
          if (input === undefined) {
            // This immutable snapshot can never produce an asset for this ID.
            // Mark it once so geometry-only notifications do not retry it.
            rememberRenderedFormulaId(session, record.id);
            skippedWithoutAsset = true;
            continue;
          }
          try {
            const result = await this.renderer.render(input, config.mathPreviewScale);
            const latestRequest: VisualViewportRenderRequest | undefined =
              session.viewportRenderRequest;
            if (
              session.disposed ||
              generation !== session.renderGeneration ||
              session.snapshot !== currentSnapshot ||
              latestRequest?.sequence !== request.sequence ||
              !visualFormulaViewportsKeepPriority(
                request.from,
                request.to,
                latestRequest.from,
                latestRequest.to,
              )
            ) {
              reprioritize = true;
              break;
            }
            rememberRenderedFormulaId(session, record.id);
            results.push({
              formulaId: record.id,
              formulaSource: currentSnapshot.text.slice(record.from, record.to),
              svg: result.svg,
              widthEm: result.widthEm,
              heightEm: result.heightEm,
            });
            // Publish the nearest render immediately. If geometry or scrolling
            // refined the viewport meanwhile, recalculate around its new center.
            if (firstVisibleResult || latestRequest !== request) {
              reprioritize = true;
              break;
            }
          } catch (error: unknown) {
            const latestRequest: VisualViewportRenderRequest | undefined =
              session.viewportRenderRequest;
            if (
              session.disposed ||
              generation !== session.renderGeneration ||
              session.snapshot !== currentSnapshot ||
              latestRequest?.sequence !== request.sequence ||
              !visualFormulaViewportsKeepPriority(
                request.from,
                request.to,
                latestRequest.from,
                latestRequest.to,
              )
            ) {
              reprioritize = true;
              break;
            }
            rememberRenderedFormulaId(session, record.id);
            errors.push({
              formulaId: record.id,
              message: errorMessage(error),
            });
            if (firstVisibleResult || latestRequest !== request) {
              reprioritize = true;
              break;
            }
          }
        }

        const releaseUnposted = (): void => {
          for (const result of results) {
            session.renderedFormulaIds.delete(result.formulaId);
          }
          for (const error of errors) {
            session.renderedFormulaIds.delete(error.formulaId);
          }
        };
        if (session.disposed) {
          releaseUnposted();
          return;
        }
        if (
          generation !== session.renderGeneration ||
          session.snapshot !== currentSnapshot
        ) {
          releaseUnposted();
          continue;
        }
        const latestRequest = session.viewportRenderRequest;
        if (
          latestRequest?.sequence !== request.sequence ||
          !visualFormulaViewportsKeepPriority(
            request.from,
            request.to,
            latestRequest.from,
            latestRequest.to,
          )
        ) {
          // Keep the renderer cache warm, but do not publish stale SVG/DOM work
          // for a viewport the user has already left.
          releaseUnposted();
          continue;
        }
        if (results.length > 0 || errors.length > 0) {
          let delivered: boolean;
          try {
            delivered = await session.panel.webview.postMessage({
              protocol: VISUAL_EDITOR_PROTOCOL,
              type: "renderBatch",
              version: request.version,
              results,
              errors,
            } satisfies VisualEditorHostMessage);
          } catch (error: unknown) {
            releaseUnposted();
            if (session.disposed) {
              return;
            }
            if (session.viewportRenderRequest === request) {
              throw error;
            }
            continue;
          }
          if (delivered) {
            immediateSequence = request.sequence;
          } else {
            releaseUnposted();
            if (
              session.disposed ||
              session.viewportRenderRequest === request
            ) {
              return;
            }
            continue;
          }
        } else if (skippedWithoutAsset) {
          // Yield a task (not only a microtask) so fresh viewport messages can
          // supersede a run of empty/unrenderable formula records.
          await delay(0);
        }
        if (session.disposed) {
          return;
        }
        if (
          generation !== session.renderGeneration ||
          session.snapshot !== currentSnapshot
        ) {
          releaseUnposted();
          continue;
        }
        if (reprioritize) {
          continue;
        }
      }
    } finally {
      session.viewportRenderActive = false;
    }
  }

  private async renderCursorPreview(
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "cursorPreview" }>,
  ): Promise<void> {
    const snapshot = session.snapshot;
    this.traceMathPreview("cursor:start", {
      requestId: message.requestId,
      cursorOffset: message.cursorOffset,
    });
    const state = this.stateFor(session.document);
    const formulaTo = message.formulaFrom + message.formulaSource.length;
    if (
      snapshot === undefined ||
      snapshot.version !== message.version ||
      session.disposed ||
      message.revision !== session.acceptedRevision ||
      message.formulaFrom < 0 ||
      formulaTo > state.mirrorText.length ||
      state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource ||
      message.bodyFrom < 0 ||
      message.bodyTo < message.bodyFrom ||
      message.bodyTo > message.formulaSource.length ||
      message.cursorOffset < message.formulaFrom ||
      message.cursorOffset > formulaTo
    ) {
      return;
    }
    const relativeCursorOffset = message.cursorOffset - message.formulaFrom;
    const canonicalFormula = snapshot.formulaById.get(message.formulaId);
    if (canonicalFormula === undefined) {
      return;
    }
    const config = readConfig(session.document.uri);
    const inheritedMacroEnvironment = mathPreviewMacroEnvironmentAtOffset(
      snapshot.preview,
      canonicalFormula.outerRange.start,
    );
    // The full snapshot intentionally trails an optimistic CodeMirror edit.
    // Re-scan only the current formula against its last known project macro
    // environment instead of rejecting changed ranges until an expensive
    // multi-file context rebuild completes.
    const localPreview = scanMathPreviewDocument(message.formulaSource, {
      fragmentKind: "body",
      maxSourceLength: config.mathPreviewMaxSourceLength,
      inheritedMacroEnvironment,
    });
    this.traceMathPreview("cursor:scanned", { requestId: message.requestId });
    const formula = localPreview.formulas.find((candidate) =>
      candidate.closed &&
      candidate.outerRange.start === 0 &&
      candidate.outerRange.end === message.formulaSource.length &&
      candidate.bodyRange.start === message.bodyFrom &&
      candidate.bodyRange.end === message.bodyTo &&
      candidate.mode === (message.display ? "block" : "inline") &&
      candidate.environmentName === message.environmentName
    );
    if (formula === undefined) {
      return;
    }
    const appearance = resolveMathPreviewAppearance(
      vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark ||
        vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
    );
    const cursorMacroEnvironment = mathPreviewMacroEnvironmentAtOffset(
      localPreview,
      formula.outerRange.start,
    );
    const markerIsShadowed = VISUAL_CURSOR_MARKER_COMMANDS.some((name) =>
      Object.hasOwn(cursorMacroEnvironment.macros, name)
    );
    const input = markerIsShadowed
      ? undefined
      : createMathPreviewCursorRenderInput(
          message.formulaSource,
          formula,
          localPreview,
          relativeCursorOffset,
          createMathPreviewCursorMarker(appearance.cursor),
        );
    if (input === undefined) {
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "cursorRenderError",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        message: "当前光标位置暂时无法安全插入 Math Preview 标记。",
      } satisfies VisualEditorHostMessage);
      return;
    }
    try {
      const result = await this.renderer.renderCursor(
        input,
        config.mathPreviewScale,
        appearance.cursor,
      );
      this.traceMathPreview("cursor:rendered", { requestId: message.requestId });
      if (
        result.cursor === undefined ||
        session.disposed ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "cursorRenderResult",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        formulaSource: message.formulaSource,
        cursorOffset: message.cursorOffset,
        svg: result.svg,
        widthEm: result.widthEm,
        heightEm: result.heightEm,
      } satisfies VisualEditorHostMessage);
      this.traceMathPreview("cursor:posted", { requestId: message.requestId });
    } catch (error: unknown) {
      this.traceMathPreview("cursor:error", {
        requestId: message.requestId,
        message: errorMessage(error),
      });
      if (
        session.disposed ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "cursorRenderError",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        message: errorMessage(error),
      } satisfies VisualEditorHostMessage);
    }
  }

  private async renderCommittedFormula(
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "formulaCommitPreview" }>,
  ): Promise<void> {
    const snapshot = session.snapshot;
    const state = this.stateFor(session.document);
    const formulaTo = message.formulaFrom + message.formulaSource.length;
    this.traceMathPreview("commit:start", { requestId: message.requestId });
    if (
      snapshot === undefined ||
      snapshot.version !== message.version ||
      session.disposed ||
      message.revision !== session.acceptedRevision ||
      message.formulaFrom < 0 ||
      formulaTo > state.mirrorText.length ||
      state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource ||
      message.bodyFrom < 0 ||
      message.bodyTo < message.bodyFrom ||
      message.bodyTo > message.formulaSource.length
    ) {
      return;
    }
    const canonicalFormula = snapshot.formulaById.get(message.formulaId);
    if (canonicalFormula === undefined) {
      return;
    }
    const config = readConfig(session.document.uri);
    const inheritedMacroEnvironment = mathPreviewMacroEnvironmentAtOffset(
      snapshot.preview,
      canonicalFormula.outerRange.start,
    );
    const localPreview = scanMathPreviewDocument(message.formulaSource, {
      fragmentKind: "body",
      maxSourceLength: config.mathPreviewMaxSourceLength,
      inheritedMacroEnvironment,
    });
    const formula = localPreview.formulas.find((candidate) =>
      candidate.closed &&
      candidate.outerRange.start === 0 &&
      candidate.outerRange.end === message.formulaSource.length &&
      candidate.bodyRange.start === message.bodyFrom &&
      candidate.bodyRange.end === message.bodyTo &&
      candidate.mode === (message.display ? "block" : "inline") &&
      candidate.environmentName === message.environmentName
    );
    const input = formula === undefined
      ? undefined
      : createMathPreviewRenderInput(
          message.formulaSource,
          formula,
          localPreview,
        );
    if (input === undefined) {
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "formulaCommitRenderError",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        message: "当前公式暂时无法生成静态预览。",
      } satisfies VisualEditorHostMessage);
      return;
    }
    try {
      const result = await this.renderer.renderCommittedFormula(
        input,
        config.mathPreviewScale,
      );
      if (
        session.disposed ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "formulaCommitRenderResult",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        formulaSource: message.formulaSource,
        svg: result.svg,
        widthEm: result.widthEm,
        heightEm: result.heightEm,
      } satisfies VisualEditorHostMessage);
      this.traceMathPreview("commit:posted", { requestId: message.requestId });
    } catch (error: unknown) {
      if (
        session.disposed ||
        session.acceptedRevision !== message.revision ||
        state.mirrorText.slice(message.formulaFrom, formulaTo) !== message.formulaSource
      ) {
        return;
      }
      await session.panel.webview.postMessage({
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "formulaCommitRenderError",
        requestId: message.requestId,
        version: message.version,
        revision: message.revision,
        formulaId: message.formulaId,
        message: errorMessage(error),
      } satisfies VisualEditorHostMessage);
    }
  }

  /**
   * Keep cursor rendering responsive while the user types continuously.
   *
   * MathJax deliberately serializes work in its worker. Sending every
   * intermediate caret/source state would therefore make the second and later
   * keystrokes wait behind obsolete renders, even though the Webview correctly
   * ignores their eventual results. Each visual-editor session now keeps only
   * one active render and the newest pending request.
   */
  private enqueueCursorPreview(
    session: VisualEditorSession,
    message: Extract<VisualEditorWebviewMessage, { readonly type: "cursorPreview" }>,
  ): void {
    if (session.disposed) {
      return;
    }
    const state = this.stateFor(session.document);
    state.lastCursorPreviewAt = Date.now();
    this.traceMathPreview("cursor:enqueued", {
      requestId: message.requestId,
      active: session.cursorPreviewActive,
    });
    session.cursorPreviewPending = message;
    if (session.cursorPreviewActive) {
      return;
    }
    session.cursorPreviewActive = true;
    void this.pumpCursorPreviews(session);
  }

  private async pumpCursorPreviews(session: VisualEditorSession): Promise<void> {
    try {
      while (!session.disposed) {
        const message = session.cursorPreviewPending;
        session.cursorPreviewPending = undefined;
        if (message === undefined) {
          return;
        }
        await this.renderCursorPreview(session, message);
      }
    } catch (error: unknown) {
      if (!session.disposed) {
        this.output.error(
          `可视化 Math Preview 更新失败：${errorMessage(error)}`,
        );
      }
    } finally {
      session.cursorPreviewActive = false;
      // A message can arrive after the loop observes an empty slot but before
      // the async task reaches this finally block. Restart once so that newest
      // request cannot be stranded in that narrow hand-off window.
      const pending = session.cursorPreviewPending;
      if (!session.disposed && pending !== undefined) {
        this.enqueueCursorPreview(session, pending);
      }
    }
  }

  private async renderReferencePreview(
    session: VisualEditorSession,
    message: Extract<
      VisualEditorWebviewMessage,
      { readonly type: "referencePreview" }
    >,
  ): Promise<void> {
    const snapshot = session.snapshot;
    if (
      snapshot === undefined ||
      snapshot.version !== message.version ||
      session.acceptedRevision !== message.revision ||
      session.disposed
    ) {
      return;
    }
    const reference = snapshot.structures.find(
      (record): record is Extract<VisualStructureRecord, { readonly kind: "reference" }> =>
        record.kind === "reference" &&
        record.from === message.from &&
        record.to === message.to,
    );
    if (reference === undefined || !reference.keys.includes(message.key)) {
      return;
    }

    const generation = session.renderGeneration;
    const resolution = await this.resolveProjectReference(
      session.document,
      message.key,
      snapshot,
    );
    const payload = resolution === undefined
      ? unavailableReferencePreviewPayload(message.key)
      : await this.createReferencePreviewPayload(
          session,
          resolution.snapshot,
          message.key,
          resolution.target.uri,
        );
    if (
      session.disposed ||
      session.snapshot !== snapshot ||
      session.renderGeneration !== generation ||
      session.acceptedRevision !== message.revision
    ) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "referencePreviewResult",
      requestId: message.requestId,
      version: message.version,
      revision: message.revision,
      from: message.from,
      to: message.to,
      key: message.key,
      ...payload,
    } satisfies VisualEditorHostMessage);
  }

  private async renderCompletionReferencePreview(
    session: VisualEditorSession,
    message: Extract<
      VisualEditorWebviewMessage,
      { readonly type: "completionReferencePreview" }
    >,
  ): Promise<void> {
    const text = session.document.getText();
    const generation = session.renderGeneration;
    if (
      session.acceptedRevision !== message.revision ||
      session.disposed
    ) {
      return;
    }
    const resolution = await this.resolveProjectReference(
      session.document,
      message.key,
      session.snapshot?.text === text ? session.snapshot : undefined,
    );
    const payload = resolution === undefined
      ? unavailableReferencePreviewPayload(message.key)
      : await this.createReferencePreviewPayload(
          session,
          resolution.snapshot,
          message.key,
          resolution.target.uri,
        );
    if (
      session.disposed ||
      session.renderGeneration !== generation ||
      session.acceptedRevision !== message.revision ||
      session.document.getText() !== text
    ) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "completionReferencePreviewResult",
      requestId: message.requestId,
      version: message.version,
      revision: message.revision,
      key: message.key,
      ...payload,
    } satisfies VisualEditorHostMessage);
  }

  private async createReferencePreviewPayload(
    session: VisualEditorSession,
    snapshot: VisualSnapshot,
    key: string,
    resource: vscode.Uri = session.document.uri,
  ): Promise<Pick<
    Extract<VisualEditorHostMessage, { readonly type: "referencePreviewResult" }>,
    "previews" | "theorem" | "heading" | "unavailableKeys"
  >> {
    const config = readConfig(resource);
    const formulaMatches = snapshot.records.filter((record) =>
      record.labels.some((label) => label.key === key)
    );
    const formulaRecord = formulaMatches.length === 1
      ? formulaMatches[0]
      : formulaMatches.length === 0
        ? transparentFormulaRecordForReference(snapshot, key)
        : undefined;
    const formula = formulaRecord === undefined
      ? undefined
      : snapshot.formulaById.get(formulaRecord.id);
    const formulaLabel = formulaRecord?.labels.find((label) => label.key === key);
    const theoremMatches = formula === undefined
      ? snapshot.structures.filter(
          (record): record is Extract<VisualStructureRecord, { readonly kind: "theorem" }> =>
            record.kind === "theorem" &&
            record.labels.some((label) => label.key === key),
        )
      : [];
    const theoremRecord = theoremMatches.length === 1
      ? theoremMatches[0]
      : undefined;
    const headingRecord = formula === undefined && theoremRecord === undefined
      ? findVisualHeadingForLabel(snapshot.text, snapshot.structures, key)
      : undefined;

    const rendered = formulaRecord === undefined || formula === undefined
      ? []
      : [await (async () => {
      const input = createMathPreviewRenderInput(
        snapshot.text,
        formula,
        snapshot.preview,
      );
      if (input === undefined) {
        return { key, available: false } as const;
      }
      try {
        const result = await this.renderer.renderInteractive(
          input,
          config.mathPreviewScale,
        );
        return {
          key,
          available: true,
          svg: result.svg,
          widthEm: result.widthEm,
          heightEm: result.heightEm,
          rowIndex: formulaLabel?.rowIndex ?? 0,
          rowCount: Math.max(1, formulaLabel?.rowCount ?? 1),
        } as const;
      } catch {
        return { key, available: false } as const;
      }
    })()];

    let theorem: Extract<
      VisualEditorHostMessage,
      { readonly type: "referencePreviewResult" }
    >["theorem"];
    if (theoremRecord !== undefined) {
      const previewBodyTo = Math.min(
        theoremRecord.bodyTo,
        theoremRecord.bodyFrom + MAX_REFERENCE_HOVER_THEOREM_SOURCE,
      );
      const theoremFormulaRecords = snapshot.records
        .filter((record) =>
          record.from >= theoremRecord.bodyFrom &&
          record.to <= previewBodyTo
        )
        .slice(0, MAX_REFERENCE_HOVER_THEOREM_FORMULAS);
      const theoremFormulas = await Promise.all(theoremFormulaRecords.map(async (record) => {
        const targetFormula = snapshot.formulaById.get(record.id);
        if (targetFormula === undefined) {
          return undefined;
        }
        const input = createMathPreviewRenderInput(
          snapshot.text,
          targetFormula,
          snapshot.preview,
        );
        if (input === undefined) {
          return undefined;
        }
        try {
          const result = await this.renderer.renderInteractive(
            input,
            config.mathPreviewScale,
          );
          return {
            from: record.from - theoremRecord.bodyFrom,
            to: record.to - theoremRecord.bodyFrom,
            display: record.display,
            svg: result.svg,
            widthEm: result.widthEm,
            heightEm: result.heightEm,
          };
        } catch {
          return undefined;
        }
      }));
      theorem = {
        key,
        label: theoremRecord.label,
        ...(theoremRecord.number === undefined ? {} : { number: theoremRecord.number }),
        ...(theoremRecord.optionalTitle === undefined
          ? {}
          : { optionalTitle: theoremRecord.optionalTitle }),
        style: theoremRecord.style,
        body: snapshot.text.slice(theoremRecord.bodyFrom, previewBodyTo),
        formulas: theoremFormulas.filter(
          (entry): entry is NonNullable<typeof entry> => entry !== undefined,
        ),
        truncated: previewBodyTo < theoremRecord.bodyTo ||
          theoremFormulaRecords.length >= MAX_REFERENCE_HOVER_THEOREM_FORMULAS,
      };
    }
    const heading = headingRecord === undefined
      ? undefined
      : {
          key,
          command: headingRecord.command,
          ...(headingRecord.number === undefined ? {} : { number: headingRecord.number }),
          title: headingRecord.title,
        };
    const unavailableKeys = rendered.some((result) => result.available) ||
        theorem !== undefined || heading !== undefined
      ? []
      : [key];
    return {
      previews: rendered.flatMap((result) => result.available
        ? [{
            key: result.key,
            svg: result.svg,
            widthEm: result.widthEm,
            heightEm: result.heightEm,
            rowIndex: result.rowIndex,
            rowCount: result.rowCount,
        }]
        : []),
      ...(theorem === undefined ? {} : { theorem }),
      ...(heading === undefined ? {} : { heading }),
      unavailableKeys: [...new Set(unavailableKeys)],
    };
  }

  private async runWebviewCommand(
    session: VisualEditorSession,
    command: VisualEditorWebviewCommand,
  ): Promise<void> {
    this.activeSession = session;
    switch (command) {
      case "save":
        await this.waitForDocumentEdits(session.document);
        await session.document.save();
        return;
      case "openSource":
        await this.openSourceEditor(session.document.uri, session);
        return;
      case "build":
        await this.runLatexWorkshop(
          "latex-workshop.build",
          "正在交给 LaTeX Workshop 编译…",
          session,
        );
        return;
      case "buildPdfLaTex":
        await this.runLatexWorkshop(
          "texleaf.build.pdflatex",
          "正在使用 pdfLaTeX 编译…",
          session,
        );
        return;
      case "buildXeLaTex":
        await this.runLatexWorkshop(
          "texleaf.build.xelatex",
          "正在使用 XeLaTeX 编译…",
          session,
        );
        return;
      case "buildLuaLaTex":
        await this.runLatexWorkshop(
          "texleaf.build.lualatex",
          "正在使用 LuaLaTeX 编译…",
          session,
        );
        return;
      case "buildBibTex":
        await this.runLatexWorkshop(
          "texleaf.build.bibtex",
          "正在使用 BibTeX 编译参考文献…",
          session,
        );
        return;
      case "buildBibLaTex":
        await this.runLatexWorkshop(
          "texleaf.build.biber",
          "正在使用 BibLaTeX（Biber）编译参考文献…",
          session,
        );
        return;
      case "viewPdf":
        await this.runLatexWorkshop(
          "latex-workshop.view",
          "正在打开 LaTeX Workshop PDF…",
          session,
        );
        return;
      case "synctex":
        await this.runLatexWorkshop(
          "latex-workshop.synctex",
          "正在执行正向 SyncTeX…",
          session,
        );
        return;
      case "pickSnippet":
        await this.pickVisualSnippet(session);
        return;
      case "pickCitation":
        await this.pickVisualCitation(session);
        return;
      case "openSnippetManager":
        await vscode.commands.executeCommand("texleaf.openSnippetEditor");
        return;
      case "openTemplateManager":
        await vscode.commands.executeCommand("texleaf.openTemplateFile");
        return;
      case "openBibliography": {
        const projectContext = await this.projectContexts.getContext(session.document);
        const bibliographyDocument = projectContext.rootUri === undefined
          ? session.document
          : await vscode.workspace.openTextDocument(projectContext.rootUri);
        await this.citations.openVisualBibliography(
          bibliographyDocument,
          session.bibliographyRequest,
        );
        return;
      }
      case "aiReview":
        await this.runVisualAiReview(session, false);
        return;
      case "aiReviewDocument":
        await this.runVisualAiReview(session, true);
        return;
      case "aiRewrite":
        await this.runVisualAiRewrite(session);
        return;
      case "aiCompletion":
        await this.requestVisualAiCompletion(session);
        return;
      case "navigateBack":
        await this.navigateBack(session);
        return;
      case "undo":
      case "redo":
        await this.runNativeEditCommand(session, command);
    }
  }

  private async pickVisualSnippet(session: VisualEditorSession): Promise<void> {
    const state = this.stateFor(session.document);
    await state.queue;
    if (session.disposed || state.pendingEdits > 0) {
      return;
    }
    const config = readConfig(session.document.uri);
    if (!isVisualEditingDocument(session.document, config)) {
      void vscode.window.showWarningMessage("当前文档未启用 TeXLeaf。");
      return;
    }
    const selection = clampSelection(session.selection, state.mirrorText.length);
    const from = Math.min(selection.anchor, selection.head);
    const to = Math.max(selection.anchor, selection.head);
    const visualText = state.mirrorText.slice(from, to);
    const context = this.runtime.contextAt(
      session.document,
      session.document.positionAt(selection.head),
    );
    const candidates: QuickPickVisualSnippet[] = this.runtime
      .compiledSnippetsFor(session.document, config)
      .filter((snippet) =>
        !snippet.disabled &&
        snippet.triggerKind === "literal" &&
        snippetAppliesToContext(snippet, context) &&
        (visualText.length > 0 || !snippet.options.visual)
      )
      .map((snippet) => ({
        label: snippet.triggerSource,
        ...(snippet.options.visual
          ? { description: "包裹选区" }
          : snippet.description === undefined
            ? {}
            : { description: snippet.description }),
        detail: snippet.options.visual
          ? snippet.replacement
          : replacementPartsToText(this.runtime.partsForSnippet(snippet)),
        snippet,
      } satisfies QuickPickVisualSnippet));
    const selected = await vscode.window.showQuickPick(candidates, {
      title: visualText.length > 0 ? "TeXLeaf 片段与包裹方式" : "TeXLeaf 片段",
      placeHolder: "搜索触发器、说明或 replacement",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (
      selected === undefined ||
      session.disposed ||
      state.pendingEdits > 0 ||
      state.mirrorText !== session.document.getText() ||
      selection.anchor !== session.selection.anchor ||
      selection.head !== session.selection.head
    ) {
      return;
    }
    const parts = this.runtime.partsForSnippet(
      selected.snippet,
      selected.snippet.options.visual ? visualText : undefined,
    );
    await this.postSnippet(
      state,
      session,
      from,
      to,
      parts,
      session.acceptedRevision,
    );
  }

  private async pickVisualCitation(session: VisualEditorSession): Promise<void> {
    const state = this.stateFor(session.document);
    await state.queue;
    if (session.disposed || state.pendingEdits > 0) {
      return;
    }
    const startRevision = session.acceptedRevision;
    const selection = clampSelection(session.selection, state.mirrorText.length);
    if (selection.anchor !== selection.head) {
      void vscode.window.showInformationMessage(
        "TeXLeaf：请把光标放在 \\cite{…} 类命令的大括号内。",
      );
      return;
    }
    const cancellation = new vscode.CancellationTokenSource();
    const completions = await this.citations.provideCompletionItems(
      session.document,
      session.document.positionAt(selection.head),
      cancellation.token,
      {
        triggerKind: vscode.CompletionTriggerKind.Invoke,
        triggerCharacter: undefined,
      },
    ).finally(() => cancellation.dispose());
    if (completions === undefined || completions.items.length === 0) {
      void vscode.window.showInformationMessage(
        "TeXLeaf：当前引用位置没有可用条目；若 Zotero 正在首次载入，请稍后再打开一次。",
      );
      return;
    }
    const candidates: QuickPickCitation[] = completions.items.map((item) => ({
      label: completionItemLabel(item.label),
      ...(typeof item.label !== "string" && item.label.description !== undefined
        ? { description: item.label.description }
        : {}),
      ...(markdownText(item.documentation) === undefined
        ? {}
        : { detail: markdownText(item.documentation)! }),
      item,
    } satisfies QuickPickCitation));
    const selected = await vscode.window.showQuickPick(candidates, {
      title: "TeXLeaf 引用",
      placeHolder: "搜索标题、作者、年份或 citation key",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (
      selected === undefined ||
      session.disposed ||
      state.pendingEdits > 0 ||
      session.acceptedRevision !== startRevision ||
      session.selection.anchor !== selection.anchor ||
      session.selection.head !== selection.head
    ) {
      return;
    }
    const item = selected.item;
    if (item.command?.command === "texleaf.commitCitationCompletion") {
      await this.runSourceCommand(
        session,
        item.command.command,
        "正在从 Zotero 导入并插入引用…",
        item.command.arguments ?? [],
      );
      return;
    }
    const range = item.range instanceof vscode.Range ? item.range : undefined;
    const insert = typeof item.insertText === "string"
      ? item.insertText
      : item.insertText instanceof vscode.SnippetString
        ? item.insertText.value
        : undefined;
    if (range === undefined || insert === undefined) {
      void vscode.window.showWarningMessage("TeXLeaf：这条引用补全无法安全应用。");
      return;
    }
    const from = session.document.offsetAt(range.start);
    const to = session.document.offsetAt(range.end);
    await this.postApplyEdit(
      state,
      session,
      from,
      to,
      insert,
      { anchor: from + insert.length, head: from + insert.length },
      startRevision,
    );
  }

  private async runSourceCommand(
    session: VisualEditorSession,
    command: string,
    status: string,
    args: readonly unknown[] = [],
  ): Promise<void> {
    await this.waitForDocumentEdits(session.document);
    await this.postStatus(session, "info", status, true);
    try {
      const editor = await vscode.window.showTextDocument(session.document, {
        ...(session.panel.viewColumn === undefined
          ? {}
          : { viewColumn: session.panel.viewColumn }),
        preview: true,
        preserveFocus: false,
      });
      editor.selection = selectionForDocument(session.document, session.selection);
      await vscode.commands.executeCommand(command, ...args);
      if (!session.disposed) {
        session.panel.reveal(session.panel.viewColumn, false);
        await this.postStatus(session, "info", "操作已完成。", false);
      }
    } catch (error: unknown) {
      if (!session.disposed) {
        session.panel.reveal(session.panel.viewColumn, false);
        await this.postStatus(
          session,
          "error",
          `操作失败：${errorMessage(error)}`,
          false,
        );
      }
    }
  }

  /**
   * Run a review against the custom editor's canonical TextDocument.  In
   * particular, do not call showTextDocument here: doing so replaces the
   * custom-editor tab with a native source editor before the AI command can
   * inspect its selection.
   */
  private async runVisualAiReview(
    session: VisualEditorSession,
    wholeDocument: boolean,
  ): Promise<void> {
    await this.waitForDocumentEdits(session.document);
    if (session.disposed) {
      return;
    }
    await this.postStatus(
      session,
      "info",
      wholeDocument ? "正在检查当前文档…" : "正在检查当前段落或选区…",
      true,
    );
    try {
      if (wholeDocument) {
        await this.aiWriting.reviewDocumentInPlace(session.document);
      } else {
        await this.aiWriting.reviewDocumentSelection(
          session.document,
          selectionForDocument(session.document, session.selection),
        );
      }
      if (!session.disposed) {
        await this.postStatus(session, "info", "AI 检查已完成。", false);
      }
    } catch (error: unknown) {
      if (!session.disposed) {
        await this.postStatus(
          session,
          "error",
          `AI 检查失败：${errorMessage(error)}`,
          false,
        );
      }
    }
  }

  /** Run AI rewriting without replacing the custom-editor tab with source. */
  private async runVisualAiRewrite(
    session: VisualEditorSession,
  ): Promise<void> {
    await this.waitForDocumentEdits(session.document);
    if (session.disposed) {
      return;
    }
    await this.postStatus(session, "info", "正在准备 AI 改写…", true);
    try {
      await this.aiWriting.rewriteDocumentSelection(
        session.document,
        selectionForDocument(session.document, session.selection),
      );
      if (!session.disposed) {
        session.panel.reveal(session.panel.viewColumn, false);
        await this.postStatus(session, "info", "AI 改写已完成。", false);
      }
    } catch (error: unknown) {
      if (!session.disposed) {
        session.panel.reveal(session.panel.viewColumn, false);
        await this.postStatus(
          session,
          "error",
          `AI 改写失败：${errorMessage(error)}`,
          false,
        );
      }
    }
  }

  private async requestVisualAiCompletion(
    session: VisualEditorSession,
  ): Promise<void> {
    const state = this.stateFor(session.document);
    await state.queue;
    const selection = clampSelection(session.selection, state.mirrorText.length);
    if (
      session.disposed ||
      state.pendingEdits > 0 ||
      selection.anchor !== selection.head
    ) {
      void vscode.window.showInformationMessage(
        "TeXLeaf：AI 续写需要一个折叠光标。",
      );
      return;
    }
    const revision = session.acceptedRevision;
    const version = session.document.version;
    const cancellation = new vscode.CancellationTokenSource();
    await this.postStatus(session, "info", "正在生成 AI 续写建议…", true);
    try {
      const items = await this.aiWriting.provideVisualInlineCompletion(
        session.document,
        session.document.positionAt(selection.head),
        cancellation.token,
      );
      const item = items?.[0];
      if (item === undefined) {
        await this.postStatus(session, "info", "当前光标没有可用的 AI 续写建议。", false);
        return;
      }
      if (
        session.disposed ||
        state.pendingEdits > 0 ||
        session.acceptedRevision !== revision ||
        session.document.version !== version ||
        !sameSelection(session.selection, selection)
      ) {
        await this.postStatus(session, "warning", "文档已变化，本条 AI 续写建议已取消。", false);
        return;
      }
      const insert = typeof item.insertText === "string"
        ? item.insertText
        : item.insertText instanceof vscode.SnippetString
          ? item.insertText.value
          : undefined;
      const range = item.range instanceof vscode.Range
        ? item.range
        : new vscode.Range(
            session.document.positionAt(selection.head),
            session.document.positionAt(selection.head),
          );
      if (insert === undefined || insert.length === 0) {
        await this.postStatus(session, "info", "当前光标没有可用的 AI 续写建议。", false);
        return;
      }
      const preview = insert.length > 240 ? `${insert.slice(0, 240)}…` : insert;
      const choice = await vscode.window.showInformationMessage(
        `TeXLeaf AI 续写建议：${preview}`,
        "应用建议",
        "忽略建议",
      );
      if (
        choice !== "应用建议" ||
        session.disposed ||
        state.pendingEdits > 0 ||
        session.acceptedRevision !== revision ||
        session.document.version !== version ||
        !sameSelection(session.selection, selection)
      ) {
        await this.postStatus(session, "info", "AI 续写建议未应用。", false);
        return;
      }
      const from = session.document.offsetAt(range.start);
      const to = session.document.offsetAt(range.end);
      await this.postApplyEdit(
        state,
        session,
        from,
        to,
        insert,
        { anchor: from + insert.length, head: from + insert.length },
        revision,
      );
      await this.postStatus(session, "info", "AI 续写建议已应用。", false);
    } finally {
      cancellation.dispose();
    }
  }

  private async openVisualEditor(resource?: vscode.Uri): Promise<void> {
    const uri = resource ?? vscode.window.activeTextEditor?.document.uri ??
      this.activeSession?.document.uri;
    if (uri === undefined) {
      void vscode.window.showInformationMessage("TeXLeaf：请先打开一个 .tex 文件。");
      return;
    }
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      VISUAL_EDITOR_VIEW_TYPE,
      { preview: false },
    );
  }

  /**
   * Materialize a managed template into a new unsaved LaTeX document and open
   * that document with the visual editor. Re-reading the catalog by opaque ID
   * keeps template content out of the Webview and prevents a stale menu entry
   * from opening arbitrary source supplied by the page.
   */
  private async openTemplateAsUntitledDocument(templateId: string): Promise<void> {
    const catalog = await this.templates.listTemplates();
    const template = catalog.templates.find((candidate) => candidate.id === templateId);
    if (template === undefined) {
      throw new Error("模板已被删除或更新，请重新打开模板菜单后再试。");
    }
    const document = await vscode.workspace.openTextDocument({
      language: "latex",
      content: template.content,
    });
    await vscode.commands.executeCommand(
      "vscode.openWith",
      document.uri,
      VISUAL_EDITOR_VIEW_TYPE,
      {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active,
      },
    );
  }

  /**
   * VS Code's native Problems view opens diagnostics through the text-editor
   * service and therefore bypasses TeXLeaf's reveal command. Detect only that
   * narrow hand-off: a visual panel has just deactivated, the same .tex source
   * became active, and its selection lands on a TeXLeaf AI diagnostic. The
   * delayed check covers VS Code applying the diagnostic selection one event
   * after activating the editor.
   */
  private scheduleNativeProblemNavigation(
    editor: vscode.TextEditor | undefined,
    selectionKind?: vscode.TextEditorSelectionChangeKind,
  ): void {
    const epoch = ++this.nativeProblemNavigationEpoch;
    if (
      editor === undefined ||
      !editor.document.uri.path.toLowerCase().endsWith(".tex")
    ) {
      return;
    }
    setTimeout(() => {
      const task = this.rerouteNativeProblemNavigation(
        editor,
        epoch,
        selectionKind,
      ).catch(
        (error: unknown) => {
          this.output.warn(
            `无法将原生问题跳转送回可视化编辑器：${errorMessage(error)}`,
          );
        },
      );
      this.nativeProblemNavigationTask = task;
      void task.finally(() => {
        if (this.nativeProblemNavigationTask === task) {
          this.nativeProblemNavigationTask = undefined;
        }
      });
    }, NATIVE_PROBLEM_SELECTION_SETTLE_MS);
  }

  private async rerouteNativeProblemNavigation(
    editor: vscode.TextEditor,
    epoch: number,
    selectionKind?: vscode.TextEditorSelectionChangeKind,
  ): Promise<void> {
    if (this.disposed || epoch !== this.nativeProblemNavigationEpoch) {
      return;
    }
    const now = Date.now();
    if (
      this.explicitSourceNavigation?.uriText === editor.document.uri.toString() &&
      this.explicitSourceNavigation.until >= now
    ) {
      return;
    }
    const preferredSession = this.preferredVisualSession(editor.document);
    if (preferredSession === undefined || preferredSession.disposed) {
      return;
    }
    const recent = this.recentVisualDeactivation;
    const hasRecentVisualHandOff = recent !== undefined &&
      !recent.session.disposed &&
      recent.session.document.uri.toString() === editor.document.uri.toString() &&
      now - recent.at <= NATIVE_PROBLEM_NAVIGATION_WINDOW_MS;
    const isCommandNavigation =
      selectionKind === vscode.TextEditorSelectionChangeKind.Command;
    // Problems/F8 navigation is reported as a command selection.  It may be
    // delivered before the custom panel's deactivation event, or long after
    // the Problems view was first focused, so it must not depend on the old
    // two-second hand-off window.  Mouse/keyboard edits in an explicitly
    // opened source editor still require the narrow recent-panel guard and are
    // therefore never pulled back into the visual editor accidentally.
    if (!isCommandNavigation && !hasRecentVisualHandOff) {
      if (
        recent !== undefined &&
        now - recent.at > NATIVE_PROBLEM_NAVIGATION_WINDOW_MS
      ) {
        this.recentVisualDeactivation = undefined;
      }
      return;
    }
    const activeEditor = vscode.window.activeTextEditor;
    if (
      activeEditor === undefined ||
      activeEditor.document.uri.toString() !== editor.document.uri.toString()
    ) {
      return;
    }
    const selection = activeEditor.selection;
    const diagnostic = vscode.languages.getDiagnostics(editor.document.uri)
      .find((candidate) =>
        candidate.source === TEXLEAF_AI_DIAGNOSTIC_SOURCE &&
        (
          candidate.range.contains(selection.active) ||
          (!selection.isEmpty && candidate.range.intersection(selection) !== undefined)
        )
      );
    if (diagnostic === undefined) {
      return;
    }

    // Consume the hand-off before yielding so the source editor's remaining
    // selection events cannot launch a second visual reveal.
    this.recentVisualDeactivation = undefined;
    this.nativeProblemNavigationEpoch += 1;
    await this.focusVisualRange(
      editor.document.uri,
      editor.document.offsetAt(diagnostic.range.start),
      editor.document.offsetAt(diagnostic.range.end),
      false,
      undefined,
      false,
      { center: true, flash: true },
    );
  }

  /**
   * Focus a document problem inside the visual editor. Existing visual tabs
   * are reused; otherwise a visual tab is opened before the caller considers
   * falling back to VS Code's source editor.
   */
  private async revealVisualRange(
    resource: vscode.Uri | string,
    from: number,
    to: number,
    options?: VisualEditorFocusOptions,
  ): Promise<boolean> {
    return this.focusVisualRange(resource, from, to, true, undefined, true, options);
  }

  private async revealOpenVisualRange(
    resource: vscode.Uri | string,
    from: number,
    to: number,
    options?: VisualEditorFocusOptions,
  ): Promise<boolean> {
    return this.focusVisualRange(resource, from, to, true, undefined, false, options);
  }

  private async revealVisualDiagnostic(
    resource: vscode.Uri | string,
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ): Promise<boolean> {
    if (
      ![startLine, startCharacter, endLine, endCharacter].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    ) {
      return false;
    }
    let uri: vscode.Uri;
    try {
      uri = typeof resource === "string"
        ? vscode.Uri.parse(resource, true)
        : resource;
    } catch {
      return false;
    }
    if (!(uri instanceof vscode.Uri) || !uri.path.toLowerCase().endsWith(".tex")) {
      return false;
    }
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return false;
    }
    const lastLine = Math.max(0, document.lineCount - 1);
    const safeStartLine = Math.min(startLine, lastLine);
    const safeEndLine = Math.min(Math.max(endLine, safeStartLine), lastLine);
    const safeStart = new vscode.Position(
      safeStartLine,
      Math.min(startCharacter, document.lineAt(safeStartLine).text.length),
    );
    const safeEnd = new vscode.Position(
      safeEndLine,
      Math.min(endCharacter, document.lineAt(safeEndLine).text.length),
    );
    return this.revealVisualRange(
      uri,
      document.offsetAt(safeStart),
      document.offsetAt(safeEnd.isBefore(safeStart) ? safeStart : safeEnd),
      { center: true, flash: true },
    );
  }

  private async focusVisualRange(
    resource: vscode.Uri | string,
    from: number,
    to: number,
    rememberDestination: boolean,
    sourceGuard?: VisualSourceGuard,
    openIfMissing = true,
    focusOptions?: VisualEditorFocusOptions,
  ): Promise<boolean> {
    let uri: vscode.Uri;
    try {
      uri = typeof resource === "string"
        ? vscode.Uri.parse(resource, true)
        : resource;
    } catch {
      return false;
    }
    if (
      !(uri instanceof vscode.Uri) ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      (sourceGuard !== undefined && (
        !Number.isSafeInteger(sourceGuard.from) ||
        !Number.isSafeInteger(sourceGuard.to) ||
        sourceGuard.from < 0 ||
        sourceGuard.to < sourceGuard.from
      )) ||
      !uri.path.toLowerCase().endsWith(".tex")
    ) {
      return false;
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      return false;
    }
    let session = this.preferredVisualSession(document);
    if (session === undefined) {
      if (!openIfMissing) {
        return false;
      }
      await this.openVisualEditor(uri);
      for (let attempt = 0; attempt < 40; attempt += 1) {
        session = this.preferredVisualSession(document);
        if (session?.ready === true) {
          break;
        }
        await delay(25);
      }
    } else if (!session.ready) {
      for (let attempt = 0; attempt < 40 && !session.ready; attempt += 1) {
        await delay(25);
      }
    }
    if (session === undefined || session.disposed || !session.ready) {
      return false;
    }

    await this.waitForDocumentEdits(document);
    const documentText = document.getText();
    if (
      sourceGuard !== undefined &&
      (
        sourceGuard.to > documentText.length ||
        documentText.slice(sourceGuard.from, sourceGuard.to) !== sourceGuard.expectedText
      )
    ) {
      return false;
    }
    const length = documentText.length;
    const nextSelection = clampSelection({ anchor: from, head: to }, length);
    if (!sameSelection(session.selection, nextSelection) && rememberDestination) {
      await this.rememberNavigationOrigin(session);
    }
    session.selection = nextSelection;
    // `WebviewPanel.reveal()` does not reliably transfer focus when the panel
    // is already visible beside another custom editor (notably LaTeX
    // Workshop's PDF viewer).  Re-opening the same resource/view type in its
    // existing column is idempotent, but makes VS Code select the visual tab
    // before we post the target range.  Without this, reverse SyncTeX could
    // scroll the visual editor while keyboard focus remained in the PDF.
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      VISUAL_EDITOR_VIEW_TYPE,
      {
        preview: false,
        preserveFocus: false,
        viewColumn: session.panel.viewColumn ?? vscode.ViewColumn.Active,
      },
    );
    session.panel.reveal(session.panel.viewColumn, false);
    const visualColumn = session.panel.viewColumn;
    const focusGroupCommand = visualColumn === undefined
      ? undefined
      : VISUAL_EDITOR_GROUP_FOCUS_COMMANDS[visualColumn] ??
        (visualColumn > 8 ? "workbench.action.focusLastEditorGroup" : undefined);
    if (focusGroupCommand !== undefined) {
      // The PDF Webview can retain DOM focus after its double-click handler
      // sends reverse SyncTeX, even though the visual panel was revealed.
      // Focusing the panel's editor group after the reveal gives the user an
      // actual visual-editor jump instead of a background-only scroll.
      await vscode.commands.executeCommand(focusGroupCommand);
    }
    this.activeSession = session;
    return this.postVisualFocusWithAcknowledgement(
      session,
      session.selection,
      focusOptions,
    );
  }

  /**
   * A successful `Webview.postMessage` only means that Electron accepted the
   * message. It does not prove that a custom editor which is being reactivated
   * from the Problems panel has already delivered it to CodeMirror. Require an
   * acknowledgement from the Webview and retry the same idempotent request
   * while the panel finishes becoming active.
   */
  private async postVisualFocusWithAcknowledgement(
    session: VisualEditorSession,
    selection: VisualEditorSelection,
    options?: VisualEditorFocusOptions,
  ): Promise<boolean> {
    const requestId = ++this.visualFocusRequestSequence;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (this.disposed || session.disposed || !session.ready) {
        return false;
      }
      const acknowledgement = new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const pending = {
          session,
          complete: (applied: boolean): void => {
            if (this.visualFocusAcknowledgements.get(requestId) !== pending) {
              return;
            }
            this.visualFocusAcknowledgements.delete(requestId);
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            resolve(applied);
          },
        };
        timer = setTimeout(() => pending.complete(false), 180);
        this.visualFocusAcknowledgements.set(requestId, pending);
      });
      let posted = false;
      try {
        posted = await session.panel.webview.postMessage({
          protocol: VISUAL_EDITOR_PROTOCOL,
          type: "focus",
          requestId,
          selection,
          ...(options === undefined ? {} : { options }),
        } satisfies VisualEditorHostMessage);
      } catch {
        posted = false;
      }
      if (!posted) {
        this.visualFocusAcknowledgements.get(requestId)?.complete(false);
      }
      if (await acknowledgement) {
        return true;
      }
      if (this.disposed || session.disposed) {
        return false;
      }
      session.panel.reveal(session.panel.viewColumn, false);
      await delay(30);
    }
    return false;
  }

  private async openSourceEditor(
    resource?: vscode.Uri,
    preferredSession?: VisualEditorSession,
  ): Promise<void> {
    const session = preferredSession ?? this.activeSession;
    const uri = resource ?? session?.document.uri ??
      vscode.window.activeTextEditor?.document.uri;
    if (uri === undefined) {
      void vscode.window.showInformationMessage("TeXLeaf：没有可切换的 .tex 文档。");
      return;
    }
    const document = session?.document ?? await vscode.workspace.openTextDocument(uri);
    await this.waitForDocumentEdits(document);
    // A Problems click may still be completing its asynchronous custom-editor
    // reveal when the user immediately asks for source mode. Invalidate that
    // hand-off and let it settle first, then make the explicit source open the
    // last focus-changing operation. Otherwise the older reveal can steal
    // focus back after `showTextDocument` has already resolved.
    this.nativeProblemNavigationEpoch += 1;
    this.recentVisualDeactivation = undefined;
    await Promise.all([
      this.nativeProblemNavigationTask,
      this.aiWriting.settleProblemNavigationBeforeSource(document.uri),
    ]);
    this.explicitSourceNavigation = {
      uriText: document.uri.toString(),
      until: Date.now() + NATIVE_PROBLEM_NAVIGATION_WINDOW_MS,
    };
    const editor = await vscode.window.showTextDocument(document, {
      ...(session?.panel.viewColumn === undefined
        ? {}
        : { viewColumn: session.panel.viewColumn }),
      preview: false,
      preserveFocus: false,
    });
    if (session !== undefined) {
      const selection = selectionForDocument(document, session.selection);
      editor.selection = selection;
      editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  private async runLatexWorkshop(
    command: LatexWorkshopBackgroundCommand,
    status: string,
    preferredSession?: VisualEditorSession,
  ): Promise<void> {
    const session = preferredSession ?? this.activeSession;
    if (session === undefined || session.disposed) {
      void vscode.window.showInformationMessage(
        "TeXLeaf：请在可视化编辑器中运行这个命令。",
      );
      return;
    }
    const extension = latexWorkshopExtension();
    if (extension === undefined) {
      const action = await vscode.window.showWarningMessage(
        "TeXLeaf 没有检测到 LaTeX Workshop；可视化编辑仍可使用，但编译、PDF 与 SyncTeX 按钮需要先安装它。",
        "打开扩展市场",
      );
      if (action !== undefined) {
        await vscode.commands.executeCommand(
          "workbench.extensions.search",
          "@id:James-Yu.latex-workshop",
        );
      }
      return;
    }
    await this.waitForDocumentEdits(session.document);
    await this.postStatus(session, "info", status, true);
    try {
      const selection = selectionForDocument(session.document, session.selection);
      await runLatexWorkshopInBackground(
        extension,
        command,
        session.document,
        selection,
        session.panel.viewColumn ?? session.backgroundViewColumn,
      );
      await this.postStatus(session, "info", "LaTeX Workshop 操作已提交。", false);
    } catch (error: unknown) {
      await this.postStatus(
        session,
        "error",
        `LaTeX Workshop 操作失败：${errorMessage(error)}`,
        false,
      );
    }
  }

  private async runNativeEditCommand(
    session: VisualEditorSession,
    command: "undo" | "redo",
  ): Promise<void> {
    await this.waitForDocumentEdits(session.document);
    const editor = await vscode.window.showTextDocument(session.document, {
      ...(session.panel.viewColumn === undefined
        ? {}
        : { viewColumn: session.panel.viewColumn }),
      preview: true,
      preserveFocus: false,
    });
    editor.selection = selectionForDocument(session.document, session.selection);
    await vscode.commands.executeCommand(command);
    if (!session.disposed) {
      session.panel.reveal(session.panel.viewColumn, false);
    }
  }

  private async runLatexWorkshopAutoBuild(
    session: VisualEditorSession,
  ): Promise<void> {
    const extension = latexWorkshopExtension();
    if (extension === undefined || session.disposed) {
      return;
    }
    try {
      await runLatexWorkshopAutoBuildAfterVisualSave(extension, session.document);
    } catch (error: unknown) {
      this.output.warn(
        `可视化编辑器未能提交 LaTeX Workshop 自动构建：${errorMessage(error)}`,
      );
    }
  }

  private async waitForDocumentEdits(document: vscode.TextDocument): Promise<void> {
    const state = this.states.get(document.uri.toString());
    if (state !== undefined) {
      await state.queue;
    }
  }

  private activeVisualSessionFor(
    document: vscode.TextDocument,
  ): VisualEditorSession | undefined {
    return [...this.sessionsFor(document)].find(
      (session) => session.panel.active && !session.disposed,
    );
  }

  private preferredVisualSession(
    document: vscode.TextDocument,
  ): VisualEditorSession | undefined {
    const sessions = this.sessionsFor(document).filter((session) => !session.disposed);
    return sessions.find((session) => session.panel.active) ??
      sessions.find((session) => session.panel.visible) ??
      sessions[0];
  }

  private sessionsFor(document: vscode.TextDocument): readonly VisualEditorSession[] {
    return [...(this.states.get(document.uri.toString())?.sessions ?? [])];
  }

  private shouldBridgeLatexWorkshop(uri: vscode.Uri): boolean {
    return latexWorkshopExtension() !== undefined &&
      vscode.workspace.getConfiguration("texleaf", uri).get<boolean>(
        "visualEditor.latexWorkshopCompatibility",
        true,
      );
  }

  private async synchronizeDefaultEditorAssociation(): Promise<void> {
    try {
      const texleaf = vscode.workspace.getConfiguration("texleaf");
      const inspected = texleaf.inspect<string>("visualEditor.defaultMode");
      const explicitMode = inspected?.globalValue;
      const workbench = vscode.workspace.getConfiguration("workbench");
      const inspectedAssociations = workbench.inspect<Record<string, string>>(
        "editorAssociations",
      );
      const globalAssociations = {
        ...(inspectedAssociations?.globalValue ?? {}),
      };
      const current = globalAssociations["*.tex"];
      const managed = this.context.globalState.get<boolean>(
        MANAGED_ASSOCIATION_STATE_KEY,
        false,
      );

      if (explicitMode === "source" || explicitMode === "visual") {
        const desired = explicitMode === "source"
          ? "default"
          : VISUAL_EDITOR_VIEW_TYPE;
        if (current !== desired) {
          globalAssociations["*.tex"] = desired;
          await workbench.update(
            "editorAssociations",
            globalAssociations,
            vscode.ConfigurationTarget.Global,
          );
        }
        await this.context.globalState.update(MANAGED_ASSOCIATION_STATE_KEY, true);
        return;
      }

      // With no explicit TeXLeaf choice, the manifest's `priority: default`
      // selects the visual editor. Remove only an association that TeXLeaf
      // previously wrote; never erase a user's unrelated editor association.
      if (
        managed &&
        (current === "default" || current === VISUAL_EDITOR_VIEW_TYPE)
      ) {
        delete globalAssociations["*.tex"];
        await workbench.update(
          "editorAssociations",
          globalAssociations,
          vscode.ConfigurationTarget.Global,
        );
      }
      if (managed) {
        await this.context.globalState.update(MANAGED_ASSOCIATION_STATE_KEY, false);
      }
    } catch (error: unknown) {
      this.output.warn(
        `同步默认 .tex 编辑器设置失败：${errorMessage(error)}`,
      );
    }
  }

  private async postStatus(
    session: VisualEditorSession,
    level: "info" | "warning" | "error",
    message: string,
    busy?: boolean,
  ): Promise<void> {
    if (session.disposed) {
      return;
    }
    await session.panel.webview.postMessage({
      protocol: VISUAL_EDITOR_PROTOCOL,
      type: "status",
      level,
      message,
      ...(busy === undefined ? {} : { busy }),
    } satisfies VisualEditorHostMessage);
  }

  private traceMathPreview(
    event: string,
    details: Readonly<Record<string, unknown>> = {},
  ): void {
    if (!TRACE_MATH_PREVIEW_PERFORMANCE) {
      return;
    }
    this.output.info(
      `[Math Preview perf ${Date.now()}] ${event} ${JSON.stringify(details)}`,
    );
  }

  private disposeSession(session: VisualEditorSession): void {
    if (session.disposed) {
      return;
    }
    session.disposed = true;
    for (const pending of this.visualFocusAcknowledgements.values()) {
      if (pending.session === session) {
        pending.complete(false);
      }
    }
    session.renderGeneration += 1;
    resetViewportRenderRequest(session);
    session.completionGeneration += 1;
    session.cursorPreviewPending = undefined;
    session.completionActions.clear();
    for (const disposable of session.subscriptions.splice(0)) {
      disposable.dispose();
    }
    const state = this.states.get(session.document.uri.toString());
    state?.sessions.delete(session);
    if (this.activeSession === session) {
      this.activeSession = undefined;
    }
    if (state !== undefined && state.sessions.size === 0 && state.pendingEdits === 0) {
      if (state.syncTimer !== undefined) {
        clearTimeout(state.syncTimer);
      }
      if (state.diagnosticTimer !== undefined) {
        clearTimeout(state.diagnosticTimer);
      }
      this.states.delete(state.key);
    }
  }

  private closeDocumentState(document: vscode.TextDocument): void {
    const state = this.states.get(document.uri.toString());
    if (state === undefined || state.sessions.size > 0) {
      return;
    }
    if (state.syncTimer !== undefined) {
      clearTimeout(state.syncTimer);
    }
    this.states.delete(state.key);
  }

  private createWebviewHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString("base64");
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "visualEditor.js"),
    );
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; img-src ${webview.cspSource} https: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    :root { color-scheme: light dark; --texleaf-math-preview-caret: #ff2bd6; --texleaf-main-scrollbar-track: rgba(128, 128, 128, .34); --texleaf-main-scrollbar-thumb: rgba(224, 224, 224, .92); }
    body.vscode-dark, body.vscode-high-contrast { --texleaf-math-preview-caret: #ff2bd6; --texleaf-main-scrollbar-track: rgba(128, 128, 128, .34); --texleaf-main-scrollbar-thumb: rgba(224, 224, 224, .92); }
    body.vscode-light, body.vscode-high-contrast-light { --texleaf-math-preview-caret: #006dff; --texleaf-main-scrollbar-track: rgba(90, 90, 90, .25); --texleaf-main-scrollbar-thumb: rgba(48, 48, 48, .82); }
    @keyframes texleaf-reverse-sync-flash {
      0%, 100% { background-color: transparent; }
      12%, 42% { background-color: color-mix(in srgb, var(--vscode-editorInfo-foreground) 27%, transparent); }
      58% { background-color: transparent; }
      72% { background-color: color-mix(in srgb, var(--vscode-editorInfo-foreground) 18%, transparent); }
    }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; color: var(--vscode-editor-foreground); }
    body { display: flex; flex-direction: column; font-family: var(--vscode-font-family); }
    #editor { position: relative; flex: 1 1 auto; min-height: 0; box-sizing: border-box; padding-right: 20px; overflow: hidden; isolation: isolate; }
    #editor-background { position: absolute; inset: 0 20px 0 0; z-index: 0; pointer-events: none; background-color: transparent; background-image: none; }
    #editor-background.front { z-index: 3; }
    #editor > .cm-editor { position: relative; z-index: 1; width: 100%; height: 100%; background: transparent; }
    #editor > .texleaf-editor-scrollbar { position: absolute; z-index: 20; top: 0; right: 0; bottom: 0; box-sizing: border-box; width: 20px; padding: 3px; opacity: 1; visibility: visible; pointer-events: auto; background: var(--texleaf-main-scrollbar-track); border-left: 1px solid color-mix(in srgb, var(--texleaf-main-scrollbar-thumb) 76%, var(--vscode-editorWidget-border) 24%); box-shadow: -1px 0 0 color-mix(in srgb, var(--vscode-editor-background) 66%, transparent); cursor: default; touch-action: none; user-select: none; }
    #editor > .texleaf-editor-scrollbar:hover, #editor > .texleaf-editor-scrollbar:focus-visible { background: var(--texleaf-main-scrollbar-track); outline: none; }
    #editor > .texleaf-editor-scrollbar > .texleaf-editor-scrollbar-thumb { position: absolute; left: 3px; right: 3px; min-height: 52px; opacity: 1; visibility: visible; border: 1px solid color-mix(in srgb, var(--texleaf-main-scrollbar-thumb) 92%, transparent); border-radius: 7px; background: var(--texleaf-main-scrollbar-thumb); box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-editor-background) 38%, transparent), 0 0 5px color-mix(in srgb, var(--vscode-editor-background) 72%, transparent); cursor: grab; }
    #editor > .texleaf-editor-scrollbar > .texleaf-editor-scrollbar-thumb.disabled { opacity: .72; cursor: default; }
    #editor > .texleaf-editor-scrollbar:hover > .texleaf-editor-scrollbar-thumb, #editor > .texleaf-editor-scrollbar:focus-visible > .texleaf-editor-scrollbar-thumb { background: var(--texleaf-main-scrollbar-thumb); }
    #editor > .texleaf-editor-scrollbar > .texleaf-editor-scrollbar-thumb.dragging { background: var(--vscode-focusBorder); border-color: color-mix(in srgb, var(--vscode-editor-foreground) 92%, transparent); cursor: grabbing; }
    #toolbar { min-height: 36px; display: flex; align-items: center; gap: 4px; padding: 3px 8px; overflow-x: auto; overflow-y: hidden; box-sizing: border-box; border-bottom: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editorGroupHeader-tabsBackground); }
    #toolbar button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 5px; height: 28px; padding: 0 9px; border: 1px solid transparent; border-radius: 4px; color: var(--vscode-foreground); background: transparent; font: inherit; white-space: nowrap; cursor: pointer; }
    #toolbar button:hover { background: var(--vscode-toolbar-hoverBackground); }
    #toolbar button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    #toolbar button:disabled { opacity: .48; cursor: default; }
    #toolbar .format-strong { font-weight: 800; }
    #toolbar .format-emphasis { font-style: italic; }
    #toolbar .format-underline { text-decoration: underline; }
    #toolbar .format-strike { text-decoration: line-through; }
    #toolbar .primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    #toolbar .primary:hover { background: var(--vscode-button-hoverBackground); }
    #toolbar #build-menu-button { min-width: 68px; }
    #toolbar .toolbar-toggle[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    #toolbar .toolbar-menu-trigger[aria-expanded="true"] { border-color: var(--vscode-focusBorder); background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground)); }
    #toolbar .separator { width: 1px; height: 20px; margin: 0 3px; background: var(--vscode-editorWidget-border); }
    #toolbar .spacer { flex: 1; }
    .toolbar-popup-menu { position: fixed; z-index: 74; box-sizing: border-box; width: min(224px, calc(100vw - 12px)); max-height: min(520px, calc(100vh - 12px)); overflow: auto; padding: 5px; border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border)); border-radius: 7px; color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); font-family: var(--vscode-font-family); font-size: 13px; }
    .toolbar-popup-menu[hidden] { display: none; }
    .toolbar-popup-menu button { display: flex; width: 100%; min-width: 0; height: 30px; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 4px; color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .toolbar-popup-menu button:hover, .toolbar-popup-menu button:focus-visible { color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); outline: none; }
    .toolbar-popup-menu button:disabled { opacity: .48; cursor: default; }
    .toolbar-popup-menu .toolbar-menu-icon { width: 24px; flex: 0 0 24px; color: var(--vscode-textLink-foreground); text-align: center; font-size: 11px; font-weight: 700; }
    .toolbar-popup-menu .toolbar-menu-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toolbar-popup-menu .toolbar-menu-shortcut { flex: 0 0 auto; margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .toolbar-popup-menu .toolbar-menu-separator { height: 1px; margin: 4px 5px; background: var(--vscode-menu-separatorBackground, var(--vscode-editorWidget-border)); }
    #editing-context-menu { position: fixed; z-index: 72; box-sizing: border-box; width: min(268px, calc(100vw - 12px)); max-height: min(620px, calc(100vh - 12px)); overflow: auto; padding: 5px; border: 1px solid var(--vscode-menu-border, var(--vscode-editorWidget-border)); border-radius: 7px; color: var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground)); background: var(--vscode-menu-background, var(--vscode-editorWidget-background)); box-shadow: 0 5px 18px var(--vscode-widget-shadow); font-family: var(--vscode-font-family); font-size: 13px; }
    #editing-context-menu[hidden] { display: none; }
    #editing-context-menu .context-menu-group { display: grid; gap: 1px; }
    #editing-context-menu .context-menu-group + .context-menu-group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-editorWidget-border)); }
    #editing-context-menu button { display: flex; width: 100%; min-width: 0; height: 28px; align-items: center; gap: 8px; padding: 0 8px; border: 0; border-radius: 4px; color: inherit; background: transparent; font: inherit; text-align: left; cursor: pointer; }
    #editing-context-menu button:hover, #editing-context-menu button:focus-visible { color: inherit; background: var(--vscode-toolbar-hoverBackground); outline: 1px solid transparent; }
    #editing-context-menu button:disabled { opacity: .48; cursor: default; }
    #editing-context-menu .context-menu-icon { width: 20px; flex: 0 0 20px; text-align: center; }
    #editing-context-menu .context-menu-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #editing-context-menu .context-menu-shortcut { flex: 0 0 auto; margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 11px; }
    #editing-context-menu .format-strong .context-menu-icon { font-weight: 800; }
    #editing-context-menu .format-emphasis .context-menu-icon { font-style: italic; }
    #editing-context-menu .format-underline .context-menu-icon { text-decoration: underline; }
    #editing-context-menu .format-strike .context-menu-icon { text-decoration: line-through; }
    #text-color-button { min-width: 30px; padding-inline: 5px !important; }
    #text-color-swatch { width: 16px; height: 16px; border: 1px solid var(--vscode-contrastBorder, var(--vscode-editorWidget-border)); border-radius: 3px; background: #d73a49; box-shadow: inset 0 0 0 1px color-mix(in srgb, white 28%, transparent); }
    #text-color-popover { position: fixed; z-index: 60; width: 260px; box-sizing: border-box; display: grid; gap: 10px; padding: 12px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 7px; color: var(--vscode-editorWidget-foreground); background: var(--vscode-editorWidget-background); box-shadow: 0 8px 24px rgba(0, 0, 0, .32); }
    #text-color-popover[hidden] { display: none; }
    .text-color-row { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: center; gap: 8px; }
    .text-color-row > span { color: var(--vscode-descriptionForeground); }
    #text-color-picker { width: 100%; min-width: 0; height: 32px; padding: 2px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; background: var(--vscode-input-background); cursor: pointer; }
    #text-color-hex { min-width: 0; height: 30px; box-sizing: border-box; padding: 4px 8px; border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; text-transform: uppercase; }
    #text-color-hex.invalid { border-color: var(--vscode-inputValidation-errorBorder); }
    .text-color-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .text-color-actions button { min-height: 28px; padding: 3px 10px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); font: inherit; cursor: pointer; }
    .text-color-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #text-color-apply { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    #text-color-apply:hover { background: var(--vscode-button-hoverBackground); }
    #text-color-apply:disabled { opacity: .5; cursor: default; }
    #text-color-button #text-color-swatch { flex: 0 0 16px; }
    #status { min-width: 0; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 12px; }
    #status[data-level="error"] { color: var(--vscode-errorForeground); }
    #status[data-level="warning"] { color: var(--vscode-editorWarning-foreground); }
    #ai-suggestion { position: fixed; z-index: 90; display: none; box-sizing: border-box; width: min(430px, calc(100vw - 16px)); max-height: min(340px, calc(100vh - 16px)); overflow: auto; padding: 0; border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)); border-radius: 7px; color: var(--vscode-editorHoverWidget-foreground); background: var(--vscode-editorHoverWidget-background); box-shadow: 0 4px 14px var(--vscode-widget-shadow); font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.45; }
    #ai-suggestion.visible { display: block; }
    #ai-suggestion-title { margin: 0; padding: 7px 10px 6px; border-bottom: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 6px 0 0 0; font-weight: 700; font-size: 12.5px; line-height: 1.35; }
    #ai-suggestion[data-kind="diagnostic"][data-severity="error"] #ai-suggestion-title { border-left-color: var(--vscode-editorError-foreground); }
    #ai-suggestion[data-kind="diagnostic"][data-severity="warning"] #ai-suggestion-title { border-left-color: var(--vscode-editorWarning-foreground); }
    #ai-suggestion[data-kind="diagnostic"][data-severity="info"] #ai-suggestion-title { border-left-color: var(--vscode-editorInfo-foreground); }
    #ai-suggestion-text { min-width: 0; padding: 8px 10px 7px; white-space: normal; overflow-wrap: anywhere; }
    #ai-suggestion-message { font-weight: 600; line-height: 1.4; white-space: pre-wrap; }
    #ai-suggestion[data-kind="diagnostic"] #ai-suggestion-message { white-space: normal; }
    #ai-suggestion-explanation { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)) 70%, transparent); color: var(--vscode-editorHoverWidget-foreground); white-space: pre-wrap; }
    .texleaf-diagnostic-card-item { padding-left: 8px; border-left: 3px solid var(--vscode-editorInfo-foreground); }
    .texleaf-diagnostic-card-item + .texleaf-diagnostic-card-item { margin-top: 7px; padding-top: 7px; border-top: 1px solid color-mix(in srgb, var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)) 70%, transparent); }
    .texleaf-diagnostic-card-item[data-severity="error"] { border-left-color: var(--vscode-editorError-foreground); }
    .texleaf-diagnostic-card-item[data-severity="warning"] { border-left-color: var(--vscode-editorWarning-foreground); }
    .texleaf-diagnostic-card-item[data-severity="hint"] { border-left-color: var(--vscode-editorHint-foreground, var(--vscode-descriptionForeground)); }
    .texleaf-diagnostic-card-meta { margin-bottom: 2px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 600; }
    .texleaf-diagnostic-card-message { color: var(--vscode-editorHoverWidget-foreground); font-weight: 600; white-space: normal; }
    #ai-suggestion-proposal { margin-top: 7px; color: var(--vscode-descriptionForeground); }
    #ai-suggestion-replacement { display: block; margin-top: 3px; padding: 5px 7px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; color: var(--vscode-editorHoverWidget-foreground); background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); font-family: var(--vscode-editor-font-family); white-space: pre-wrap; overflow-wrap: anywhere; }
    #ai-suggestion-actions { display: flex; gap: 14px; padding: 0 10px 8px; }
    #ai-suggestion button { min-height: 0; padding: 0; border: 0; border-radius: 0; color: var(--vscode-textLink-foreground); background: transparent; font: inherit; cursor: pointer; }
    #ai-suggestion button:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; background: transparent; }
    #ai-suggestion-note { padding: 0 10px 8px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    #ai-suggestion[data-kind="diagnostic"]:not([data-has-insight="true"]) #ai-suggestion-explanation,
    #ai-suggestion[data-kind="diagnostic"]:not([data-has-insight="true"]) #ai-suggestion-proposal,
    #ai-suggestion[data-kind="diagnostic"] #ai-suggestion-actions,
    #ai-suggestion[data-kind="diagnostic"] #ai-suggestion-note { display: none; }
    #reference-hover { position: fixed; z-index: 85; display: none; box-sizing: border-box; width: min(460px, calc(100vw - 16px)); max-height: min(62vh, 420px); overflow: hidden; border: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)); border-radius: 7px; color: var(--vscode-editorHoverWidget-foreground); background: var(--vscode-editorHoverWidget-background); box-shadow: 0 4px 14px var(--vscode-widget-shadow); font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 13px); line-height: 1.45; }
    #reference-hover.visible { display: block; }
    #reference-hover-content { max-height: min(62vh, 420px); overflow: auto; overscroll-behavior: contain; }
    #reference-hover .texleaf-completion-info { padding: 12px 14px; }
    #reference-hover .texleaf-completion-info + .texleaf-completion-info { border-top: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)); }
    #reference-hover .texleaf-completion-info h3 { margin: 0 0 10px; color: inherit; font-family: var(--vscode-font-family); font-size: 1.08em; line-height: 1.3; }
    #reference-hover .texleaf-completion-info p { margin: 7px 0; }
    #reference-hover .texleaf-completion-info code { padding: 1px 4px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); border-radius: 3px; font-family: var(--vscode-editor-font-family); }
    #reference-hover .texleaf-completion-info hr { height: 1px; margin: 10px 0; border: 0; background: var(--vscode-editorWidget-border); }
    #reference-hover .texleaf-reference-hover-loading,
    #reference-hover .texleaf-reference-hover-empty { padding: 12px 14px; color: var(--vscode-descriptionForeground); }
    #reference-hover .texleaf-reference-hover-heading { display: grid; gap: 7px; margin: 10px; padding: 10px 11px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 6px; background: color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent); }
    #reference-hover .texleaf-reference-hover-heading-title { font-family: inherit; font-size: 1.08em; line-height: 1.35; }
    #reference-hover .texleaf-reference-hover-heading-meta { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--vscode-descriptionForeground); font-size: .82em; }
    #reference-hover .texleaf-reference-hover-heading-meta code { padding: 1px 5px; color: var(--vscode-descriptionForeground); background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; font-size: .92em; }
    #reference-hover .texleaf-reference-hover-formula { padding: 10px 12px 12px; }
    #reference-hover .texleaf-reference-hover-formula + .texleaf-reference-hover-formula { border-top: 1px solid var(--vscode-editorHoverWidget-border, var(--vscode-editorWidget-border)); }
    #reference-hover .texleaf-reference-hover-key { margin: 0 0 7px; color: var(--vscode-textLink-foreground); font-size: .88em; font-weight: 600; }
    #reference-hover .texleaf-reference-hover-math-scroll { max-width: 100%; max-height: min(44vh, 300px); padding: 8px; overflow: auto; border-radius: 4px; background: color-mix(in srgb, var(--vscode-editor-background) 74%, transparent); overscroll-behavior: contain; }
    #reference-hover .texleaf-reference-hover-math-canvas { position: relative; isolation: isolate; box-sizing: content-box; width: var(--texleaf-formula-width); height: var(--texleaf-formula-height); min-width: var(--texleaf-formula-width); min-height: var(--texleaf-formula-height); margin: 0 auto; }
    #reference-hover .texleaf-reference-hover-math-canvas svg { position: relative; z-index: 1; display: block; width: 100%; height: 100%; max-width: none; max-height: none; color: inherit; }
    #reference-hover .texleaf-reference-hover-row-highlight { position: absolute; z-index: 0; left: 0; right: 0; box-sizing: border-box; pointer-events: none; border-block: 1px solid var(--vscode-editor-findMatchBorder, var(--vscode-focusBorder)); border-radius: 3px; background: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 92, 0, 0.24)); }
    #reference-hover .texleaf-reference-hover-theorem { margin: 10px; overflow: hidden; border: 3px solid color-mix(in srgb, var(--vscode-editor-foreground) 44%, var(--vscode-editorWidget-border) 56%); border-radius: 7px; background: color-mix(in srgb, var(--vscode-editorWidget-background) 76%, transparent); }
    #reference-hover .texleaf-reference-hover-theorem-header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; padding: 9px 11px 7px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
    #reference-hover .texleaf-reference-hover-theorem-header strong { font-weight: 700; }
    #reference-hover .texleaf-reference-hover-theorem-header code { margin-left: auto; padding: 1px 5px; color: var(--vscode-descriptionForeground); background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; font-size: .78em; }
    #reference-hover .texleaf-reference-hover-theorem-body { padding: 9px 11px 10px; white-space: pre-wrap; }
    #reference-hover .texleaf-reference-hover-theorem-text { white-space: pre-wrap; }
    #reference-hover .texleaf-reference-hover-theorem-plain .texleaf-reference-hover-theorem-body { font-style: italic; }
    #reference-hover .texleaf-reference-hover-theorem-math { color: inherit; font-style: normal; }
    #reference-hover .texleaf-reference-hover-theorem-math-inline { display: inline-block; max-width: 100%; margin: 0 .18em; overflow-x: auto; vertical-align: middle; }
    #reference-hover .texleaf-reference-hover-theorem-math-display { display: block; max-width: 100%; margin: 8px 0; padding: 4px; overflow: auto; text-align: center; }
    #reference-hover .texleaf-reference-hover-theorem-math-canvas { display: inline-block; box-sizing: content-box; width: var(--texleaf-formula-width); height: var(--texleaf-formula-height); min-width: var(--texleaf-formula-width); min-height: var(--texleaf-formula-height); vertical-align: middle; }
    #reference-hover .texleaf-reference-hover-theorem-math-canvas svg { display: block; width: 100%; height: 100%; max-width: none; max-height: none; color: inherit; }
    #reference-hover .texleaf-reference-hover-theorem-qed { float: right; margin-left: 10px; }
    #reference-hover .texleaf-reference-hover-theorem-truncated { clear: both; margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: .86em; font-style: normal; }
    #editor { flex: 1; min-height: 0; overflow: hidden; background: transparent; }
  </style>
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="TeXLeaf 常用编辑工具栏">
    <button id="build-menu-button" class="primary toolbar-menu-trigger" type="button" title="选择 LaTeX 编译方式" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="build-menu"><span aria-hidden="true">▶</span><span>编译</span></button>
    <button id="top-view-pdf" type="button" title="使用 LaTeX Workshop 查看 PDF"><span aria-hidden="true">▣</span><span>PDF</span></button>
    <button id="top-open-source" class="toolbar-toggle" type="button" title="在当前标签页切换源码模式" aria-pressed="false"><span aria-hidden="true">⌨</span><span class="toolbar-button-label">源码</span></button>
    <button id="top-open-native-source" type="button" title="在 VS Code 原生编辑器中打开"><span aria-hidden="true">↗</span><span>原生</span></button>
    <button id="top-save-document" type="button" title="保存文档（Ctrl/Cmd+S）"><span aria-hidden="true">▣</span><span>保存</span></button>
    <span class="separator" aria-hidden="true"></span>
    <button id="edit-undo" type="button" title="撤销（Ctrl/Cmd+Z）">↶</button>
    <button id="edit-redo" type="button" title="重做（Ctrl/Cmd+Shift+Z）">↷</button>
    <span class="separator" aria-hidden="true"></span>
    <button data-texleaf-insert="section" type="button" title="插入章节标题">§ 章节</button>
    <button data-texleaf-insert="bold" class="format-strong" type="button" title="加粗选区或插入 textbf">B</button>
    <button data-texleaf-insert="italic" class="format-emphasis" type="button" title="斜体/强调选区">I</button>
    <button data-texleaf-insert="underline" class="format-underline" type="button" title="给选区添加下划线">U</button>
    <button data-texleaf-insert="strike" class="format-strike" type="button" title="给选区添加删除线（需要 ulem）">S</button>
    <button id="text-color-button" type="button" title="选择颜色并应用到当前选区" aria-label="正文颜色" aria-haspopup="dialog" aria-expanded="false"><span id="text-color-swatch" aria-hidden="true"></span></button>
    <span class="separator" aria-hidden="true"></span>
    <button id="formula-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="formula-menu">∑ 公式</button>
    <button id="environment-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="environment-menu">◇ 环境</button>
    <button id="image-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="image-menu">▧ 图片</button>
    <button id="table-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="table-menu">▦ 表格</button>
    <button id="reference-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="reference-menu">↪ 引用</button>
    <button id="snippet-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="snippet-menu">✦ 片段</button>
    <button id="template-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="template-menu">▤ 模板</button>
    <button id="ai-menu-button" class="toolbar-menu-trigger" type="button" aria-haspopup="menu" aria-expanded="false" data-toolbar-menu="ai-menu">✧ AI</button>
    <span class="spacer"></span>
    <span id="status" role="status" aria-live="polite">正在载入…</span>
  </div>
  <div id="build-menu" class="toolbar-popup-menu" role="menu" aria-label="选择编译方式" tabindex="-1" hidden>
    <button id="build-pdflatex" type="button" role="menuitem"><span class="toolbar-menu-icon">PDF</span><span class="toolbar-menu-label">使用 pdfLaTeX 编译</span></button>
    <button id="build-xelatex" type="button" role="menuitem"><span class="toolbar-menu-icon">Xe</span><span class="toolbar-menu-label">使用 XeLaTeX 编译</span></button>
    <button id="build-lualatex" type="button" role="menuitem"><span class="toolbar-menu-icon">Lua</span><span class="toolbar-menu-label">使用 LuaLaTeX 编译</span></button>
    <div class="toolbar-menu-separator" role="separator"></div>
    <button id="build-bibtex" type="button" role="menuitem"><span class="toolbar-menu-icon">Bib</span><span class="toolbar-menu-label">使用 BibTeX 编译文献</span></button>
    <button id="build-biblatex" type="button" role="menuitem"><span class="toolbar-menu-icon">Bbr</span><span class="toolbar-menu-label">使用 BibLaTeX（Biber）编译文献</span></button>
  </div>
  <div id="formula-menu" class="toolbar-popup-menu" role="menu" aria-label="插入公式" tabindex="-1" hidden>
    <button data-texleaf-insert="inlineMath" type="button" role="menuitem"><span class="toolbar-menu-icon">$</span><span class="toolbar-menu-label">行内公式</span></button>
    <button data-texleaf-insert="displayMath" type="button" role="menuitem"><span class="toolbar-menu-icon">&#92;[&#92;]</span><span class="toolbar-menu-label">行间公式</span></button>
    <button data-texleaf-insert="equation" type="button" role="menuitem"><span class="toolbar-menu-icon">Eq</span><span class="toolbar-menu-label">equation 方程环境</span></button>
    <button data-texleaf-insert="align" type="button" role="menuitem"><span class="toolbar-menu-icon">&amp;</span><span class="toolbar-menu-label">align 多行对齐</span></button>
    <button data-texleaf-insert="cases" type="button" role="menuitem"><span class="toolbar-menu-icon">{</span><span class="toolbar-menu-label">cases 分段公式</span></button>
    <button data-texleaf-insert="matrix" type="button" role="menuitem"><span class="toolbar-menu-icon">▦</span><span class="toolbar-menu-label">矩阵</span></button>
  </div>
  <div id="environment-menu" class="toolbar-popup-menu" role="menu" aria-label="插入环境" tabindex="-1" hidden>
    <button data-texleaf-insert="theorem" type="button" role="menuitem"><span class="toolbar-menu-icon">Thm</span><span class="toolbar-menu-label">定理环境</span></button>
    <button data-texleaf-insert="lemma" type="button" role="menuitem"><span class="toolbar-menu-icon">Lem</span><span class="toolbar-menu-label">引理环境</span></button>
    <button data-texleaf-insert="proposition" type="button" role="menuitem"><span class="toolbar-menu-icon">Prp</span><span class="toolbar-menu-label">命题环境</span></button>
    <button data-texleaf-insert="corollary" type="button" role="menuitem"><span class="toolbar-menu-icon">Cor</span><span class="toolbar-menu-label">推论环境</span></button>
    <button data-texleaf-insert="proof" type="button" role="menuitem"><span class="toolbar-menu-icon">∎</span><span class="toolbar-menu-label">证明环境</span></button>
    <div class="toolbar-menu-separator" role="separator"></div>
    <button data-texleaf-insert="itemize" type="button" role="menuitem"><span class="toolbar-menu-icon">•</span><span class="toolbar-menu-label">无序列表</span></button>
    <button data-texleaf-insert="enumerate" type="button" role="menuitem"><span class="toolbar-menu-icon">1.</span><span class="toolbar-menu-label">编号列表</span></button>
    <button data-texleaf-insert="description" type="button" role="menuitem"><span class="toolbar-menu-icon">≡</span><span class="toolbar-menu-label">说明列表</span></button>
  </div>
  <div id="image-menu" class="toolbar-popup-menu" role="menu" aria-label="插入图片与图形" tabindex="-1" hidden>
    <button data-texleaf-insert="figure" type="button" role="menuitem"><span class="toolbar-menu-icon">▧</span><span class="toolbar-menu-label">figure 图片环境</span></button>
    <button data-texleaf-insert="includeGraphics" type="button" role="menuitem"><span class="toolbar-menu-icon">Img</span><span class="toolbar-menu-label">插入 includegraphics</span></button>
    <button data-texleaf-insert="tikzcd" type="button" role="menuitem"><span class="toolbar-menu-icon">⇢</span><span class="toolbar-menu-label">交换图 tikzcd</span></button>
    <button data-texleaf-insert="tikzpicture" type="button" role="menuitem"><span class="toolbar-menu-icon">TikZ</span><span class="toolbar-menu-label">高级 TikZ 图形</span></button>
  </div>
  <div id="table-menu" class="toolbar-popup-menu" role="menu" aria-label="插入表格" tabindex="-1" hidden>
    <button data-texleaf-insert="table" type="button" role="menuitem"><span class="toolbar-menu-icon">▦</span><span class="toolbar-menu-label">带标题的 table</span></button>
    <button data-texleaf-insert="tabular" type="button" role="menuitem"><span class="toolbar-menu-icon">Tab</span><span class="toolbar-menu-label">基础 tabular</span></button>
    <button data-texleaf-insert="tabularx" type="button" role="menuitem"><span class="toolbar-menu-icon">TabX</span><span class="toolbar-menu-label">自适应宽度 tabularx</span></button>
    <button data-texleaf-insert="longtable" type="button" role="menuitem"><span class="toolbar-menu-icon">Long</span><span class="toolbar-menu-label">跨页 longtable</span></button>
  </div>
  <div id="reference-menu" class="toolbar-popup-menu" role="menu" aria-label="插入引用" tabindex="-1" hidden>
    <button data-texleaf-insert="label" type="button" role="menuitem"><span class="toolbar-menu-icon">#</span><span class="toolbar-menu-label">插入标签</span></button>
    <button data-texleaf-insert="plainReference" type="button" role="menuitem"><span class="toolbar-menu-icon">ref</span><span class="toolbar-menu-label">普通 ref 引用</span></button>
    <button data-texleaf-insert="reference" type="button" role="menuitem"><span class="toolbar-menu-icon">eq</span><span class="toolbar-menu-label">方程 eqref 引用</span></button>
    <button data-texleaf-insert="citation" type="button" role="menuitem"><span class="toolbar-menu-icon">“”</span><span class="toolbar-menu-label">文献 cite 引用</span></button>
    <button id="top-pick-citation" type="button" role="menuitem"><span class="toolbar-menu-icon">@</span><span class="toolbar-menu-label">搜索并插入文献</span></button>
  </div>
  <div id="snippet-menu" class="toolbar-popup-menu" role="menu" aria-label="片段" tabindex="-1" hidden>
    <button id="top-pick-snippet" type="button" role="menuitem"><span class="toolbar-menu-icon">✦</span><span class="toolbar-menu-label">搜索并插入片段</span><span class="toolbar-menu-shortcut">Ctrl+Alt+L</span></button>
    <button id="top-open-snippet-manager" type="button" role="menuitem"><span class="toolbar-menu-icon">⚙</span><span class="toolbar-menu-label">片段管理</span></button>
  </div>
  <div id="template-menu" class="toolbar-popup-menu" role="menu" aria-label="模板" tabindex="-1" hidden>
    <div id="template-menu-items" role="group" aria-label="现有模板"></div>
    <div class="toolbar-menu-separator" role="separator"></div>
    <button id="top-open-template-manager" type="button" role="menuitem"><span class="toolbar-menu-icon">▤</span><span class="toolbar-menu-label">TeX 模板管理</span></button>
  </div>
  <div id="ai-menu" class="toolbar-popup-menu" role="menu" aria-label="AI 写作" tabindex="-1" hidden>
    <button id="top-ai-review" type="button" role="menuitem"><span class="toolbar-menu-icon">✦</span><span class="toolbar-menu-label">AI 检查当前段落或选区</span></button>
    <button id="top-ai-rewrite" type="button" role="menuitem"><span class="toolbar-menu-icon">✎</span><span class="toolbar-menu-label">AI 改写</span></button>
    <button id="top-ai-completion" type="button" role="menuitem"><span class="toolbar-menu-icon">…</span><span class="toolbar-menu-label">AI 续写</span></button>
    <button id="top-ai-review-document" type="button" role="menuitem"><span class="toolbar-menu-icon">⌕</span><span class="toolbar-menu-label">AI 检查全文</span></button>
  </div>
  <div id="editing-context-menu" role="menu" aria-label="TeXLeaf 编辑菜单" tabindex="-1" hidden>
    <div class="context-menu-group" role="group" aria-label="PDF 与视图">
      <button id="view-pdf" type="button" role="menuitem" title="使用 LaTeX Workshop 查看 PDF"><span class="context-menu-icon">▣</span><span class="context-menu-label">查看 PDF</span></button>
      <button id="synctex" type="button" role="menuitem" title="从当前光标正向定位到 PDF"><span class="context-menu-icon">⇄</span><span class="context-menu-label">从光标定位到 PDF</span></button>
      <button id="open-source" type="button" role="menuitem" aria-pressed="false"><span class="context-menu-icon">⌨</span><span class="context-menu-label">源码模式</span></button>
      <button id="open-native-source" type="button" role="menuitem"><span class="context-menu-icon">↗</span><span class="context-menu-label">在原生编辑器打开</span></button>
      <button id="save-document" type="button" role="menuitem"><span class="context-menu-icon">▣</span><span class="context-menu-label">保存文档</span><span class="context-menu-shortcut">Ctrl+S</span></button>
    </div>
    <div class="context-menu-group" role="group" aria-label="剪贴板">
      <button id="edit-cut" type="button" role="menuitem"><span class="context-menu-icon">✂</span><span class="context-menu-label">剪切</span><span class="context-menu-shortcut">Ctrl+X</span></button>
      <button id="edit-copy" type="button" role="menuitem"><span class="context-menu-icon">▧</span><span class="context-menu-label">复制</span><span class="context-menu-shortcut">Ctrl+C</span></button>
      <button id="edit-paste" type="button" role="menuitem"><span class="context-menu-icon">▣</span><span class="context-menu-label">粘贴</span><span class="context-menu-shortcut">Ctrl+V</span></button>
      <button id="edit-format-document" type="button" role="menuitem" title="只整理 LaTeX 行首缩进，不改写正文"><span class="context-menu-icon">≣</span><span class="context-menu-label">整理 LaTeX 缩进</span><span class="context-menu-shortcut">Shift+Alt+F</span></button>
    </div>
    <div class="context-menu-group" role="group" aria-label="插入 LaTeX 结构">
      <button data-texleaf-insert="proof" type="button" role="menuitem"><span class="context-menu-icon">∎</span><span class="context-menu-label">证明环境</span></button>
      <button data-texleaf-insert="itemize" type="button" role="menuitem"><span class="context-menu-icon">≡</span><span class="context-menu-label">列表</span></button>
      <button data-texleaf-insert="table" type="button" role="menuitem"><span class="context-menu-icon">▦</span><span class="context-menu-label">添加表格</span></button>
      <button data-texleaf-insert="longtable" type="button" role="menuitem"><span class="context-menu-icon">▤</span><span class="context-menu-label">长表格</span></button>
      <button data-texleaf-insert="figure" type="button" role="menuitem"><span class="context-menu-icon">▧</span><span class="context-menu-label">图片</span></button>
      <button data-texleaf-insert="tikzcd" type="button" role="menuitem"><span class="context-menu-icon">⇢</span><span class="context-menu-label">交换图</span></button>
      <button data-texleaf-insert="label" type="button" role="menuitem"><span class="context-menu-icon">#</span><span class="context-menu-label">标签</span></button>
      <button data-texleaf-insert="reference" type="button" role="menuitem"><span class="context-menu-icon">↪</span><span class="context-menu-label">方程/定理引用</span></button>
      <button data-texleaf-insert="citation" type="button" role="menuitem"><span class="context-menu-icon">“”</span><span class="context-menu-label">文献引用</span></button>
    </div>
    <div class="context-menu-group" role="group" aria-label="AI 写作">
      <button id="ai-review" type="button" role="menuitem"><span class="context-menu-icon">✦</span><span class="context-menu-label">AI 检查当前段落或选区</span></button>
      <button id="ai-rewrite" type="button" role="menuitem"><span class="context-menu-icon">✎</span><span class="context-menu-label">AI 改写</span></button>
      <button id="ai-completion" type="button" role="menuitem"><span class="context-menu-icon">…</span><span class="context-menu-label">AI 续写</span></button>
      <button id="ai-review-document" type="button" role="menuitem"><span class="context-menu-icon">⌕</span><span class="context-menu-label">AI 检查全文</span></button>
    </div>
  </div>
  <div id="text-color-popover" role="dialog" aria-label="应用正文颜色" hidden>
    <label class="text-color-row"><span>颜色</span><input id="text-color-picker" type="color" value="#d73a49" aria-label="选择正文颜色"></label>
    <label class="text-color-row"><span>HEX</span><input id="text-color-hex" type="text" value="#D73A49" maxlength="7" spellcheck="false" aria-label="十六进制颜色"></label>
    <div class="text-color-actions">
      <button id="text-color-cancel" type="button">取消</button>
      <button id="text-color-apply" type="button">应用颜色</button>
    </div>
  </div>
  <div id="ai-suggestion" role="dialog" aria-live="polite" aria-label="TeXLeaf 问题详情" aria-hidden="true" data-kind="ai">
    <div id="ai-suggestion-title"></div>
    <div id="ai-suggestion-text">
      <div id="ai-suggestion-message"></div>
      <div id="ai-suggestion-explanation"></div>
      <div id="ai-suggestion-proposal">建议：<code id="ai-suggestion-replacement"></code></div>
    </div>
    <div id="ai-suggestion-actions">
      <button id="ai-apply" type="button">✓ 应用建议</button>
      <button id="ai-ignore" type="button">× 忽略建议</button>
    </div>
    <div id="ai-suggestion-note">应用后会重新核对当前原文；忽略建议仅对本次 VS Code 会话生效。</div>
  </div>
  <div id="reference-hover" role="tooltip" aria-hidden="true">
    <div id="reference-hover-content"></div>
  </div>
  <div id="editor" data-csp-nonce="${nonce}">
    <div id="editor-background" aria-hidden="true"></div>
    <div class="texleaf-editor-scrollbar" tabindex="0" role="scrollbar" aria-orientation="vertical" aria-label="可视化编辑器文档滚动条" title="可视化编辑器文档滚动条">
      <div class="texleaf-editor-scrollbar-thumb disabled" style="top: 3px; height: 52px"></div>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function isLatexProjectUri(uri: vscode.Uri): boolean {
  return uri.path.toLocaleLowerCase().endsWith(".tex");
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return visualUriKey(left) === visualUriKey(right);
}

function visualUriKey(uri: vscode.Uri): string {
  if (uri.scheme.toLowerCase() !== "file") {
    return uri.toString(true);
  }
  const normalized = uri.with({ query: "", fragment: "" }).toString(true);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function projectFileFor(
  context: LatexProjectContext,
  uri: vscode.Uri,
): LatexProjectFile | undefined {
  return context.files.find((file) => sameUri(file.uri, uri));
}

/**
 * TeX's executable physical source ends at the first proven top-level
 * `\endinput` or just after the first proven `\end{document}`. Keep the
 * original snapshot text for editing/version checks, but feed only this
 * offset-preserving prefix to Visual Structure and Math Preview. Retaining the
 * complete end-document command lets the structure layer emit its closing
 * record without exposing inert tail resources.
 */
function projectExecutableText(
  context: LatexProjectContext,
  uri: vscode.Uri,
  text: string,
): string {
  const file = projectFileFor(context, uri);
  if (file === undefined || file.text !== text) {
    return text;
  }
  const end = Math.min(
    text.length,
    file.sourceScan.endInput?.start ?? text.length,
    file.sourceScan.endDocument?.end ?? text.length,
  );
  return end === text.length
    ? text
    : text.slice(0, Math.max(0, end));
}

function visualProjectReferenceSource(
  context: LatexProjectContext,
  targets: readonly LatexProjectLabelTarget[],
): string | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  const paths = [...new Set(targets.map((target) =>
    visualProjectRelativePath(context, target.uri)
  ))];
  const visiblePaths = paths.slice(0, 2).join("、");
  const omitted = paths.length > 2 ? ` 等 ${paths.length} 个文件` : "";
  if (targets.length > 1) {
    return `${visiblePaths}${omitted}（${targets.length} 个定义）`;
  }
  const target = targets[0]!;
  return target.occurrenceCount > 1
    ? `${visiblePaths}（重复包含 ${target.occurrenceCount} 次）`
    : visiblePaths;
}

function visualProjectRelativePath(
  context: LatexProjectContext,
  uri: vscode.Uri,
): string {
  if (uri.scheme === "file") {
    const basePath = context.rootUri?.scheme === "file"
      ? path.dirname(context.rootUri.fsPath)
      : context.workspaceUri?.scheme === "file"
        ? context.workspaceUri.fsPath
        : undefined;
    if (basePath !== undefined) {
      const relative = path.relative(basePath, uri.fsPath);
      if (
        relative.length > 0 &&
        !path.isAbsolute(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`)
      ) {
        return relative.replaceAll("\\", "/");
      }
      if (relative.length === 0) {
        return path.basename(uri.fsPath);
      }
    }
  }
  return vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
}

function visualProjectScanOptions(
  context: LatexProjectContext,
  uri: vscode.Uri,
): VisualDocumentStructureScanOptions {
  const file = projectFileFor(context, uri);
  const role = file?.role ?? context.requestedRole;
  return {
    fragmentKind: role,
    documentLanguage: context.rootLanguage,
    numberingRootLevel: context.numberingRoot,
    numberingMode: role === "body" ? "unknown" : "local",
  };
}

/**
 * Resolve one immutable project-entry macro environment. A declarative class
 * capability supplies conservative renderer fallbacks, explicit user settings
 * may refine those approximations, and real static definitions from the
 * expanded root preamble win last.
 */
function projectMathPreviewEnvironment(
  context: LatexProjectContext,
  config: TeXLeafConfig,
): MathPreviewMacroEnvironment {
  const rootClass = context.rootUri === undefined
    ? undefined
    : projectFileFor(context, context.rootUri)?.sourceScan.documentClass;
  const capability = resolveLatexPreviewCapability(
    context.documentClass,
    rootClass?.options,
  );
  const packageMacros = resolveLatexPackagePreviewMacros(context.preambleSource);
  const capabilityAndConfigured = Object.assign(
    Object.create(null) as Record<string, string>,
    capability.mathMacros,
    packageMacros,
    config.mathPreviewMacros,
  );
  const snapshot = scanMathPreviewDocument(context.preambleSource, {
    fragmentKind: "preamble",
    configuredMacros: capabilityAndConfigured,
  });
  return {
    macros: snapshot.macros,
    macroFingerprint: snapshot.macroFingerprint,
  };
}

function unavailableReferencePreviewPayload(
  key: string,
): Pick<
  Extract<VisualEditorHostMessage, { readonly type: "referencePreviewResult" }>,
  "previews" | "theorem" | "heading" | "unavailableKeys"
> {
  return {
    previews: [],
    unavailableKeys: [key],
  };
}

function visualEditorResourceRoots(
  extensionUri: vscode.Uri,
  document: vscode.TextDocument,
): readonly vscode.Uri[] {
  const roots = [vscode.Uri.joinPath(extensionUri, "dist")];
  if (document.uri.scheme === "file") {
    roots.push(vscode.Uri.file(path.dirname(document.uri.fsPath)));
  }
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.push(folder.uri);
  }
  roots.push(...visualEditorBackgroundLocalRoots(document.uri));
  const seen = new Set<string>();
  return roots.filter((root) => {
    const key = root.toString();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

interface VisualBackgroundEditorConfig {
  readonly images: readonly string[];
  readonly style: Readonly<Record<string, unknown>>;
  readonly styles: readonly Readonly<Record<string, unknown>>[];
  readonly useFront: boolean;
}

function readVisualBackgroundEditorConfig(
  resource: vscode.Uri,
): VisualBackgroundEditorConfig | undefined {
  const configuration = vscode.workspace.getConfiguration("background", resource);
  if (!configuration.get<boolean>("enabled", true)) {
    return undefined;
  }
  const raw = configuration.get<unknown>("editor");
  if (!isUnknownRecord(raw)) {
    return undefined;
  }
  const images = Array.isArray(raw.images)
    ? raw.images.filter((value): value is string =>
        typeof value === "string" && value.trim().length > 0
      )
    : [];
  if (images.length === 0) {
    return undefined;
  }
  return {
    images,
    style: isUnknownRecord(raw.style) ? raw.style : {},
    styles: Array.isArray(raw.styles)
      ? raw.styles.map((value) => isUnknownRecord(value) ? value : {})
      : [],
    useFront: typeof raw.useFront === "boolean" ? raw.useFront : true,
  };
}

function resolveVisualEditorBackground(
  webview: vscode.Webview,
  resource: vscode.Uri,
  viewColumn: vscode.ViewColumn | undefined,
): VisualEditorBackground | undefined {
  const config = readVisualBackgroundEditorConfig(resource);
  if (config === undefined) {
    return undefined;
  }
  // Background 3.x initially assigns images to editor split views in order.
  // ViewColumn is the public VS Code counterpart of that split-view index.
  const column = typeof viewColumn === "number" && viewColumn > 0 ? viewColumn : 1;
  const index = (column - 1) % config.images.length;
  const imageUrl = visualBackgroundImageUrl(webview, config.images[index] ?? "");
  if (imageUrl === undefined) {
    return undefined;
  }
  const perImage = config.styles[index] ?? {};
  const style = { ...config.style, ...perImage };
  return {
    imageUrl,
    opacity: visualBackgroundOpacity(style.opacity),
    position: visualBackgroundCssValue(
      style["background-position"] ?? style.backgroundPosition,
      "100% 100%",
    ),
    size: visualBackgroundCssValue(
      style["background-size"] ?? style.backgroundSize,
      "auto",
    ),
    repeat: visualBackgroundRepeat(
      style["background-repeat"] ?? style.backgroundRepeat,
    ),
    useFront: config.useFront,
  };
}

function visualEditorBackgroundLocalRoots(resource: vscode.Uri): readonly vscode.Uri[] {
  const config = readVisualBackgroundEditorConfig(resource);
  if (config === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const roots: vscode.Uri[] = [];
  for (const image of config.images) {
    const uri = visualBackgroundLocalImageUri(image);
    if (uri === undefined) {
      continue;
    }
    const root = vscode.Uri.file(path.dirname(uri.fsPath));
    const key = root.toString();
    if (!seen.has(key)) {
      seen.add(key);
      roots.push(root);
    }
  }
  return roots;
}

function visualBackgroundImageUrl(
  webview: vscode.Webview,
  raw: string,
): string | undefined {
  const value = raw.trim();
  if (/^https:\/\//iu.test(value)) {
    return value.length <= 4_096 ? value : undefined;
  }
  if (/^data:image\//iu.test(value)) {
    return value.length <= 2_097_152 ? value : undefined;
  }
  const local = visualBackgroundLocalImageUri(value);
  return local === undefined ? undefined : webview.asWebviewUri(local).toString();
}

function visualBackgroundLocalImageUri(raw: string): vscode.Uri | undefined {
  let value = raw.trim();
  if (
    value.length === 0 ||
    /^(?:https?:|data:)/iu.test(value)
  ) {
    return undefined;
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    value = path.join(homedir(), value.slice(2));
  }
  value = value.replace(/\$\{(\w+)\}|\$(\w+)/gu, (match, braced, plain) => {
    const name = String(braced ?? plain ?? "");
    return process.env[name] ?? match;
  });
  try {
    if (/^file:/iu.test(value)) {
      const parsed = vscode.Uri.parse(value);
      return parsed.scheme === "file" ? parsed : undefined;
    }
    return path.isAbsolute(value) ? vscode.Uri.file(value) : undefined;
  } catch {
    return undefined;
  }
}

function visualBackgroundCssValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 256 && !/[;{}]/u.test(normalized)
    ? normalized
    : fallback;
}

function visualBackgroundOpacity(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseFloat(value)
      : 0.6;
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.6;
}

function visualBackgroundRepeat(value: unknown): string {
  const repeat = visualBackgroundCssValue(value, "no-repeat");
  return /^(?:no-repeat|repeat|repeat-x|repeat-y|space|round)(?:\s+(?:no-repeat|repeat|space|round))?$/u.test(
      repeat,
    )
    ? repeat
    : "no-repeat";
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveVisualImagePreviews(
  webview: vscode.Webview,
  document: vscode.TextDocument,
  structure: VisualDocumentStructure,
  projectRoot?: vscode.Uri,
): Promise<VisualDocumentStructure> {
  if (document.uri.scheme !== "file") {
    return structure;
  }
  const documentDirectory = path.resolve(path.dirname(document.uri.fsPath));
  const workspaceRoots = (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === "file")
    .map((folder) => path.resolve(folder.uri.fsPath));
  const projectDirectory = projectRoot?.scheme === "file"
    ? path.resolve(path.dirname(projectRoot.fsPath))
    : undefined;
  const allowedRoots = uniqueResolvedPaths([
    documentDirectory,
    ...(projectDirectory === undefined ? [] : [projectDirectory]),
    ...workspaceRoots,
  ]);
  const searchRoots = uniqueResolvedPaths([
    documentDirectory,
    ...(projectDirectory === undefined ? [] : [projectDirectory]),
    ...workspaceRoots,
  ]);
  let requested = 0;
  const records = await Promise.all(structure.records.map(async (record) => {
    if (record.kind !== "image" || requested >= MAX_VISUAL_IMAGE_PREVIEWS) {
      return record;
    }
    requested += 1;
    const previewUri = await resolveVisualImageUri(
      webview,
      record,
      searchRoots,
      allowedRoots,
    );
    return previewUri === undefined ? record : { ...record, previewUri };
  }));
  return { ...structure, records };
}

async function resolveVisualStructureMath(
  renderer: VisualEditorRenderer,
  structure: VisualDocumentStructure,
  preview: MathPreviewSnapshot,
  scale: number,
): Promise<VisualDocumentStructure> {
  const fragments: Array<{
    readonly fragment: VisualMathFragment;
    readonly sourceOffset: number;
  }> = [];
  const appendFragment = (
    fragment: VisualMathFragment,
    sourceOffset: number,
  ): void => {
    fragments.push({ fragment, sourceOffset });
  };
  const localAssets = new Map<string, NonNullable<VisualMathFragment["asset"]>>();
  for (const record of structure.records) {
    if (record.kind === "table") {
      for (const segment of record.captionSegments) {
        if (segment.kind === "math") {
          appendFragment(segment.math, segment.math.sourceFrom);
        }
      }
      for (const row of record.rows) {
        for (const cell of row) {
          for (const segment of cell.segments) {
            if (segment.kind === "math") {
              appendFragment(segment.math, segment.math.sourceFrom);
            }
          }
        }
      }
    } else if (record.kind === "tikzcd") {
      for (const node of record.nodes) {
        appendFragment(node.math, node.math.sourceFrom);
      }
      for (const arrow of record.arrows) {
        if (arrow.label !== undefined) {
          appendFragment(arrow.label, arrow.label.sourceFrom);
        }
      }
    }
  }
  const fragmentKeys = new Map<VisualMathFragment, string>();
  const unique = new Map<string, {
    readonly tex: string;
    readonly environment: MathPreviewMacroEnvironment;
  }>();
  for (const { fragment, sourceOffset } of fragments) {
    const tex = fragment.tex.trim();
    if (tex.length === 0 || tex.length > 32_768) {
      continue;
    }
    const environment = mathPreviewMacroEnvironmentAtOffset(preview, sourceOffset);
    const key = `${environment.macroFingerprint}\u0000${tex}`;
    fragmentKeys.set(fragment, key);
    if (
      !unique.has(key) &&
      unique.size < MAX_VISUAL_STRUCTURE_MATH_FRAGMENTS
    ) {
      unique.set(key, { tex, environment });
    }
  }
  const assets = new Map<string, NonNullable<VisualMathFragment["asset"]>>();
  const localRecords = structure.records.filter(
    (record) => record.kind === "tikzcd" || record.kind === "tikzpicture",
  );
  await Promise.all([
    ...[...unique].map(async ([key, input]) => {
      try {
        const rendered = await renderer.render({
          tex: input.tex,
          display: false,
          macros: input.environment.macros,
          macroFingerprint: input.environment.macroFingerprint,
        }, scale);
        assets.set(key, {
          svg: rendered.svg,
          widthEm: rendered.widthEm,
          heightEm: rendered.heightEm,
        });
      } catch {
        // Unsupported cell/node syntax keeps its bounded plain-text fallback.
      }
    }),
    ...localRecords.map(async (record) => {
      try {
        const environment = mathPreviewMacroEnvironmentAtOffset(
          preview,
          record.replacement.sourceFrom,
        );
        const rendered = await renderer.render({
          tex: record.tex,
          display: true,
          macros: environment.macros,
          macroFingerprint: environment.macroFingerprint,
        }, scale);
        localAssets.set(localStructureAssetKey(record), {
          svg: rendered.svg,
          widthEm: rendered.widthEm,
          heightEm: rendered.heightEm,
        });
      } catch {
        // tikzcd keeps its geometric fallback; tikzpicture keeps editable source.
      }
    }),
  ]);
  const resolveFragment = (fragment: VisualMathFragment): VisualMathFragment => {
    const key = fragmentKeys.get(fragment);
    const asset = key === undefined ? undefined : assets.get(key);
    return asset === undefined ? fragment : { ...fragment, asset };
  };
  return {
    ...structure,
    records: structure.records.map((record) => {
      if (record.kind === "table") {
        return {
          ...record,
          captionSegments: record.captionSegments.map((segment) =>
            segment.kind === "math"
              ? { ...segment, math: resolveFragment(segment.math) }
              : segment
          ),
          rows: record.rows.map((row) =>
            row.map((cell) => ({
              ...cell,
              math: cell.math === undefined
                ? undefined
                : resolveFragment(cell.math),
              segments: cell.segments.map((segment) =>
                segment.kind === "math"
                  ? { ...segment, math: resolveFragment(segment.math) }
                  : segment
              ),
            }))
          ),
        };
      }
      if (record.kind === "tikzcd") {
        const resolved: typeof record = {
          ...record,
          nodes: record.nodes.map((node) => ({
            ...node,
            math: resolveFragment(node.math),
          })),
          arrows: record.arrows.map((arrow) => ({
            ...arrow,
            label: arrow.label === undefined
              ? undefined
              : resolveFragment(arrow.label),
          })),
        };
        const asset = localAssets.get(localStructureAssetKey(record));
        return asset === undefined ? resolved : { ...resolved, asset };
      }
      if (record.kind === "tikzpicture") {
        const asset = localAssets.get(localStructureAssetKey(record));
        return asset === undefined ? record : { ...record, asset };
      }
      return record;
    }),
  };
}

function localStructureAssetKey(
  record: Extract<VisualStructureRecord, { readonly kind: "tikzcd" | "tikzpicture" }>,
): string {
  return `${record.kind}:${record.replacement.sourceFrom}:${record.replacement.sourceTo}`;
}

async function resolveVisualImageUri(
  webview: vscode.Webview,
  record: VisualImageRecord,
  searchRoots: readonly string[],
  allowedRoots: readonly string[],
): Promise<string | undefined> {
  const normalizedSource = record.path.replaceAll("/", path.sep);
  const sourceExtension = path.extname(normalizedSource).toLowerCase();
  const suffixes = sourceExtension.length === 0
    ? VISUAL_IMAGE_EXTENSIONS
    : VISUAL_IMAGE_EXTENSIONS.includes(
          sourceExtension as (typeof VISUAL_IMAGE_EXTENSIONS)[number],
        )
      ? [""] as const
      : [];
  for (const root of searchRoots) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(root, `${normalizedSource}${suffix}`);
      if (!allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, candidate))) {
        continue;
      }
      try {
        const uri = vscode.Uri.file(candidate);
        const stat = await vscode.workspace.fs.stat(uri);
        if ((stat.type & vscode.FileType.File) !== 0) {
          return webview.asWebviewUri(uri).toString();
        }
      } catch {
        // Try the next TeX-style extension or workspace-relative candidate.
      }
    }
  }
  return undefined;
}

function uniqueResolvedPaths(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const resolved = path.resolve(value);
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }
  return result;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length === 0 ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative));
}

function visualCollapsedSourceRanges(
  records: readonly VisualStructureRecord[],
): readonly (readonly [number, number])[] {
  return records.flatMap((record): readonly (readonly [number, number])[] => {
    switch (record.kind) {
      case "preamble":
        return [[record.from, record.to]];
      case "maketitle":
      case "table":
      case "tikzcd":
      case "tikzpicture":
      case "image":
      case "bibliography":
      case "documentEnd":
        return [[record.replacement.from, record.replacement.to]];
      default:
        return [];
    }
  });
}

function planVisualAutoEnlarge(
  text: string,
  from: number,
  to: number,
  parts: readonly ReplacementPart[],
  triggers: readonly string[],
): readonly VisualEditorSnippetModifier[] {
  const plain = replacementPartsToText(parts);
  if (!triggers.some((trigger) => plain.includes(trigger))) {
    return [];
  }
  const hypothetical = `${text.slice(0, from)}${plain}${text.slice(to)}`;
  const contentRange = { start: from, end: from + plain.length };
  const mathRegion = innermostLatexMathRegion(hypothetical, contentRange.start);
  const plans = planAutoEnlargeAncestors(hypothetical, contentRange, {
    triggers,
    ...(mathRegion === undefined
      ? {}
      : {
          bounds: {
            start: mathRegion.innerStart,
            end: mathRegion.innerEnd,
          },
        }),
  });
  if (plans.length === 0) {
    return [];
  }
  const delta = plain.length - (to - from);
  const modifiers: VisualEditorSnippetModifier[] = [];
  for (const plan of plans) {
    const closeOffset = plan.closeOffset - delta;
    if (
      plan.openOffset < 0 ||
      plan.openOffset + plan.open.length > from ||
      closeOffset < to ||
      closeOffset + plan.close.length > text.length ||
      !text.startsWith(plan.open, plan.openOffset) ||
      !text.startsWith(plan.close, closeOffset)
    ) {
      return [];
    }
    modifiers.push(
      {
        from: plan.openOffset,
        to: plan.openOffset + plan.open.length,
        expectedText: plan.open,
        insert: `${plan.insertLeftText}${plan.open}`,
      },
      {
        from: closeOffset,
        to: closeOffset + plan.close.length,
        expectedText: plan.close,
        insert: `${plan.insertRightText}${plan.close}`,
      },
    );
  }
  return modifiers.sort((left, right) => left.from - right.from || left.to - right.to);
}

function visualAiIssuesFor(
  aiWriting: AIWritingController,
  document: vscode.TextDocument,
): readonly VisualEditorAiIssue[] {
  const snapshot = aiWriting.snapshotForDocument(document);
  if (!snapshot.enabled || !snapshot.supported || snapshot.version !== document.version) {
    return [];
  }
  return snapshot.issues.map((issue) => ({
    id: issue.id,
    from: document.offsetAt(issue.range.start),
    to: document.offsetAt(issue.range.end),
    message: issue.message,
    explanation: issue.explanation,
    replacement: issue.replacement,
    category: issue.category,
    severity: issue.severity,
  }));
}

function visualDiagnosticsFor(
  _document: vscode.TextDocument,
): readonly VisualEditorDiagnostic[] {
  // Compiler/linter diagnostics stay wholly owned by their original provider
  // (notably LaTeX Workshop) and are shown in VS Code's native Problems view.
  // TeXLeaf publishes only its own AI-language DiagnosticCollection there;
  // those issues already have the dedicated visual AI queue above.  Returning
  // an empty snapshot here prevents TeXLeaf from duplicating either provider's
  // diagnostics as a second set of visual markers/cards.
  return [];
}

function visualDiagnosticId(
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic,
  index: number,
): string {
  return createHash("sha1").update([
    index,
    document.offsetAt(diagnostic.range.start),
    document.offsetAt(diagnostic.range.end),
    diagnostic.severity,
    diagnostic.source?.trim() ?? "",
    visualDiagnosticCode(diagnostic.code) ?? "",
    diagnostic.message,
  ].join("\u0000")).digest("hex").slice(0, 20);
}

function visualDiagnosticCode(
  code: vscode.Diagnostic["code"],
): string | undefined {
  if (typeof code === "string" || typeof code === "number") {
    return String(code);
  }
  if (code !== undefined) {
    return String(code.value);
  }
  return undefined;
}

function visualLabelDefinitionCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  context: VisualLatexCompletionContext,
  labelsByKey: ReadonlyMap<string, readonly LatexProjectLabelTarget[]>,
): readonly vscode.CompletionItem[] {
  const prefixes = new Set([
    "eq:",
    "sec:",
    "fig:",
    "tab:",
    "thm:",
    "lem:",
    "prop:",
    "cor:",
    "def:",
    "rem:",
    "ex:",
  ]);
  for (const key of labelsByKey.keys()) {
    const separator = key.indexOf(":");
    if (separator > 0 && separator < 48) {
      prefixes.add(key.slice(0, separator + 1));
    }
  }
  const range = new vscode.Range(document.positionAt(context.from), position);
  return [...prefixes]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .map((prefix, index) => {
      const item = new vscode.CompletionItem(
        prefix,
        vscode.CompletionItemKind.Reference,
      );
      item.insertText = prefix;
      item.range = range;
      item.filterText = prefix;
      item.sortText = `2${String(index).padStart(4, "0")}`;
      item.detail = "新标签前缀";
      item.documentation = new vscode.MarkdownString(
        `插入 \`${prefix}\` 作为新 \\label 键的命名空间；不会复用已有标签。`,
      );
      return item;
    });
}

function visualRankedCompletionCandidates(
  context: VisualLatexCompletionContext,
  groups: readonly {
    readonly priority: number;
    readonly items: readonly vscode.CompletionItem[];
  }[],
): readonly vscode.CompletionItem[] {
  const query = normalizeVisualCompletionSearchText(context.query, context.kind);
  const ranked: {
    readonly item: vscode.CompletionItem;
    readonly rank: number;
    readonly priority: number;
    readonly order: number;
  }[] = [];
  let order = 0;
  for (const group of groups) {
    for (const item of group.items) {
      const rank = visualCompletionItemSearchRank(item, query, context.kind);
      if (rank !== undefined) {
        ranked.push({ item, rank, priority: group.priority, order });
      }
      order += 1;
    }
  }
  ranked.sort((left, right) =>
    left.rank - right.rank ||
    Number(right.item.preselect === true) - Number(left.item.preselect === true) ||
    left.priority - right.priority ||
    (left.item.sortText ?? "").localeCompare(right.item.sortText ?? "") ||
    completionItemLabel(left.item.label).localeCompare(
      completionItemLabel(right.item.label),
      undefined,
      { sensitivity: "base" },
    ) ||
    left.order - right.order
  );
  return ranked.map((candidate) => candidate.item);
}

function visualCompletionItemSearchRank(
  item: vscode.CompletionItem,
  query: string,
  kind: VisualLatexCompletionContext["kind"],
): number | undefined {
  if (query.length === 0) {
    return 4;
  }
  const texts = [
    completionItemLabel(item.label),
    item.filterText,
    typeof item.insertText === "string" ? item.insertText : undefined,
  ].filter((value): value is string => value !== undefined && value.length > 0);
  let best: number | undefined;
  for (const text of texts) {
    const candidate = normalizeVisualCompletionSearchText(text, kind);
    const rank = candidate === query
      ? 0
      : candidate.startsWith(query)
        ? 1
        : visualCompletionWordStartsWith(candidate, query)
          ? 2
          : candidate.includes(query)
            ? 3
            : visualCompletionSubsequence(candidate, query)
              ? 4
              : undefined;
    if (rank !== undefined && (best === undefined || rank < best)) {
      best = rank;
    }
  }
  return best;
}

function normalizeVisualCompletionSearchText(
  value: string,
  kind: VisualLatexCompletionContext["kind"],
): string {
  const normalized = value.trim().toLocaleLowerCase();
  return kind === "command" ? normalized.replace(/^\\+/u, "") : normalized;
}

function visualCompletionWordStartsWith(candidate: string, query: string): boolean {
  return candidate.split(/[^\p{L}\p{N}_@]+/u).some((part) => part.startsWith(query));
}

function visualCompletionSubsequence(candidate: string, query: string): boolean {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === query.length) {
        return true;
      }
    }
  }
  return false;
}

function snippetAppliesToContext(
  snippet: CompiledSnippet,
  context: LatexContext,
): boolean {
  const options = snippet.options;
  const hasMode = options.textMode || options.anyMathMode ||
    options.blockMathMode || options.inlineMathMode;
  return !hasMode ||
    (options.textMode && context.mathMode === "text") ||
    (options.anyMathMode && context.mathMode !== "text") ||
    (options.blockMathMode && context.mathMode === "block") ||
    (options.inlineMathMode && context.mathMode === "inline");
}

function visualTeXLeafSnippetCompletionItems(
  runtime: SnippetRuntime,
  document: vscode.TextDocument,
  position: vscode.Position,
  fromOffset: number,
  context: LatexContext,
  config: TeXLeafConfig,
): readonly vscode.CompletionItem[] {
  const safeFrom = clampInteger(fromOffset, 0, document.getText().length);
  const range = new vscode.Range(document.positionAt(safeFrom), position);
  const query = document.getText(range);
  const candidates: {
    readonly snippet: CompiledSnippet;
    readonly rank: number;
  }[] = [];
  for (const snippet of runtime.compiledSnippetsFor(document, config)) {
    if (
      snippet.disabled ||
      snippet.triggerKind !== "literal" ||
      snippet.options.visual ||
      !snippetAppliesToContext(snippet, context)
    ) {
      continue;
    }
    const rank = visualVirtualCompletionRank(snippet.triggerSource, query);
    if (rank >= 0) {
      candidates.push({ snippet, rank });
    }
  }
  candidates.sort((left, right) =>
    left.rank - right.rank ||
    right.snippet.priority - left.snippet.priority ||
    left.snippet.order - right.snippet.order
  );
  return candidates.slice(0, MAX_VISUAL_COMPLETION_ITEMS).map(
    ({ snippet, rank }, index) => {
      const item = new vscode.CompletionItem(
        snippet.triggerSource,
        rank === 0
          ? vscode.CompletionItemKind.Keyword
          : vscode.CompletionItemKind.Snippet,
      );
      item.insertText = replacementPartsToSnippetString(
        runtime.partsForSnippet(snippet),
      );
      item.range = range;
      item.filterText = snippet.triggerSource;
      item.sortText = `0${rank}${String(index).padStart(5, "0")}`;
      item.preselect = rank === 0;
      item.detail = `${snippet.description ?? "TeXLeaf 片段"} · TeXLeaf`;
      item.documentation = new vscode.MarkdownString(
        `TeXLeaf 触发器：\`${snippet.triggerSource.replaceAll("`", "\\`")}\``,
      );
      return item;
    },
  );
}

function visualCoreLatexCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  fromOffset: number,
  citationCommands: readonly string[],
): readonly vscode.CompletionItem[] {
  const safeFrom = clampInteger(fromOffset, 0, document.getText().length);
  const range = new vscode.Range(document.positionAt(safeFrom), position);
  const query = document.getText(range);
  return visualCoreLatexCompletionCandidates(citationCommands)
    .map((candidate) => ({
      candidate,
      rank: visualVirtualCompletionRank(candidate.label, query),
    }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) =>
      left.rank - right.rank ||
      left.candidate.label.length - right.candidate.label.length ||
      left.candidate.label.localeCompare(right.candidate.label)
    )
    .map(({ candidate, rank }, index) => {
      const item = new vscode.CompletionItem(
        candidate.label,
        vscode.CompletionItemKind.Snippet,
      );
      item.insertText = new vscode.SnippetString(candidate.body);
      item.range = range;
      item.filterText = candidate.label;
      item.sortText = `1${rank}${String(index).padStart(5, "0")}`;
      // CodeMirror does not consume VS Code's sortText. Mark an exact core
      // fallback as preselected so duplicate labels contributed by another
      // extension cannot replace a structured snippet (for example, turning
      // the intended \cite{${1}} into a bare \cite command).
      item.preselect = rank === 0;
      item.detail = `${candidate.detail} · TeXLeaf 核心补全`;
      item.documentation = new vscode.MarkdownString(
        "可视化编辑器内置的安全 LaTeX 兜底补全；不依赖原生编辑器是否处于焦点。",
      );
      return item;
    });
}

function visualCoreLatexCompletionCandidates(
  citationCommands: readonly string[],
): readonly VisualCoreLatexCompletion[] {
  const candidates = [...VISUAL_CORE_LATEX_COMPLETIONS];
  const seen = new Set(candidates.map((candidate) => candidate.label));
  for (const rawCommand of citationCommands) {
    const command = rawCommand.trim().replace(/^\\+/u, "").replace(/\*$/u, "");
    if (!/^[A-Za-z@]+$/u.test(command)) {
      continue;
    }
    const label = `\\${command}`;
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    const plural = /cites$/iu.test(command);
    candidates.push({
      label,
      body: plural
        ? `${label}{\${1}}{\${2}}$0`
        : `${label}{\${1}}$0`,
      detail: plural ? "多组文献引用" : "文献引用",
    });
  }
  return candidates;
}

function visualCompletionActionId(): string {
  return randomBytes(18).toString("base64url");
}

function validVirtualInputRequest(
  state: VisualDocumentState,
  session: VisualEditorSession,
  message: Extract<
    VisualEditorWebviewMessage,
    { readonly type: "virtualSnippetRequest" | "virtualCompletionRequest" }
  >,
): boolean {
  return !session.disposed &&
    state.pendingEdits === 0 &&
    message.revision === session.acceptedRevision &&
    state.mirrorText === session.document.getText() &&
    message.value.length <= MAX_VISUAL_VIRTUAL_INPUT_LENGTH &&
    !/[\u0000\r\n]/u.test(message.value) &&
    Number.isSafeInteger(message.selectionStart) &&
    Number.isSafeInteger(message.selectionEnd) &&
    message.selectionStart >= 0 &&
    message.selectionEnd >= message.selectionStart &&
    message.selectionEnd <= message.value.length &&
    Number.isSafeInteger(message.anchor) &&
    message.anchor >= 0 &&
    message.anchor <= state.mirrorText.length;
}

function virtualLatexInputContext(
  runtime: SnippetRuntime,
  document: vscode.TextDocument,
  anchor: number,
  value: string,
  cursor: number,
  kind: VisualEditorVirtualInputContext,
): LatexContext {
  const source = runtime.contextAt(document, document.positionAt(anchor));
  const local = scanLatexContext(value, cursor);
  const environment = kind === "tikzcd" ? "tikzcd" : "tabular";
  return {
    ...local,
    mathMode: kind === "tikzcd" && local.mathMode === "text"
      ? "inline"
      : local.mathMode,
    environments: [...new Set([...source.environments, environment])],
    matrixEnvironment: local.matrixEnvironment ?? source.matrixEnvironment,
  };
}

function visualVirtualCompletionRank(label: string, query: string): number {
  const normalizedLabel = label.toLocaleLowerCase("en-US");
  const normalizedQuery = query.toLocaleLowerCase("en-US");
  if (normalizedQuery.length === 0) {
    return 2;
  }
  if (normalizedLabel === normalizedQuery) {
    return 0;
  }
  if (normalizedLabel.startsWith(normalizedQuery)) {
    return 1;
  }
  return normalizedLabel.includes(normalizedQuery) ? 3 : -1;
}

function isVisualEditingDocument(
  document: vscode.TextDocument,
  config: TeXLeafConfig,
): boolean {
  return config.enabled &&
    !document.isClosed &&
    (document.uri.scheme === "file" || document.uri.scheme === "untitled") &&
    document.uri.path.toLocaleLowerCase("en-US").endsWith(".tex");
}

async function visualExtensionSnippetCompletionItems(
  document: vscode.TextDocument,
  position: vscode.Position,
  fromOffset: number,
  output: vscode.LogOutputChannel,
): Promise<readonly vscode.CompletionItem[]> {
  const definitions = await visualExtensionSnippetDefinitions(
    document.languageId,
    output,
  );
  const safeFrom = clampInteger(fromOffset, 0, document.getText().length);
  const range = new vscode.Range(document.positionAt(safeFrom), position);
  const query = document.getText(range).toLocaleLowerCase("en-US");
  const candidates: {
    readonly prefix: string;
    readonly definition: VisualExtensionSnippetDefinition;
    readonly rank: number;
  }[] = [];
  for (const definition of definitions) {
    for (const prefix of definition.prefixes) {
      const normalized = prefix.toLocaleLowerCase("en-US");
      const rank = query.length === 0
        ? 2
        : normalized === query
          ? 0
          : normalized.startsWith(query)
            ? 1
            : normalized.includes(query)
              ? 3
              : -1;
      if (rank >= 0) {
        candidates.push({ prefix, definition, rank });
      }
    }
  }
  candidates.sort((left, right) =>
    left.rank - right.rank ||
    left.prefix.localeCompare(right.prefix, undefined, { sensitivity: "base" })
  );
  return candidates.slice(0, MAX_VISUAL_COMPLETION_ITEMS).map((candidate, index) => {
    const item = new vscode.CompletionItem(
      candidate.prefix,
      vscode.CompletionItemKind.Snippet,
    );
    item.insertText = new vscode.SnippetString(candidate.definition.body);
    item.range = range;
    item.filterText = candidate.prefix;
    item.sortText = `${candidate.rank}${String(index).padStart(5, "0")}`;
    item.detail = [
      candidate.definition.description,
      candidate.definition.source,
    ].filter((value): value is string => value !== undefined).join(" · ");
    item.documentation = new vscode.MarkdownString(
      `来自已安装扩展 **${candidate.definition.source}** 的 LaTeX Snippet。`,
    );
    return item;
  });
}

async function visualExtensionSnippetDefinitions(
  languageId: string,
  output: vscode.LogOutputChannel,
): Promise<readonly VisualExtensionSnippetDefinition[]> {
  const contributions = visualSnippetContributions(languageId);
  const cacheKey = [
    languageId,
    ...contributions.map(({ extension, relativePath }) =>
      `${extension.id}@${extension.packageJSON?.version ?? ""}:${relativePath}`
    ),
  ].join("\u0000");
  let cached = visualExtensionSnippetCache.get(cacheKey);
  if (cached === undefined) {
    cached = loadVisualExtensionSnippetDefinitions(contributions, languageId, output);
    visualExtensionSnippetCache.clear();
    visualExtensionSnippetCache.set(cacheKey, cached);
  }
  return cached;
}

function visualSnippetContributions(languageId: string): readonly {
  readonly extension: vscode.Extension<unknown>;
  readonly relativePath: string;
  readonly source: string;
}[] {
  const result: {
    readonly extension: vscode.Extension<unknown>;
    readonly relativePath: string;
    readonly source: string;
  }[] = [];
  for (const extension of vscode.extensions.all) {
    const manifest = extension.packageJSON as {
      readonly displayName?: unknown;
      readonly contributes?: {
        readonly snippets?: unknown;
      };
    };
    if (!Array.isArray(manifest.contributes?.snippets)) {
      continue;
    }
    for (const value of manifest.contributes.snippets) {
      if (
        result.length >= MAX_VISUAL_EXTENSION_SNIPPET_FILES ||
        typeof value !== "object" ||
        value === null
      ) {
        continue;
      }
      const contribution = value as {
        readonly language?: unknown;
        readonly path?: unknown;
      };
      const languages = Array.isArray(contribution.language)
        ? contribution.language
        : [contribution.language];
      if (
        !languages.includes(languageId) ||
        typeof contribution.path !== "string" ||
        contribution.path.length === 0 ||
        contribution.path.length > 2_048 ||
        /[\u0000\r\n]/u.test(contribution.path)
      ) {
        continue;
      }
      result.push({
        extension,
        relativePath: contribution.path,
        source: typeof manifest.displayName === "string"
          ? manifest.displayName
          : extension.id,
      });
    }
  }
  return result;
}

async function loadVisualExtensionSnippetDefinitions(
  contributions: readonly {
    readonly extension: vscode.Extension<unknown>;
    readonly relativePath: string;
    readonly source: string;
  }[],
  languageId: string,
  output: vscode.LogOutputChannel,
): Promise<readonly VisualExtensionSnippetDefinition[]> {
  const definitions: VisualExtensionSnippetDefinition[] = [];
  for (const contribution of contributions) {
    if (definitions.length >= MAX_VISUAL_EXTENSION_SNIPPETS) {
      break;
    }
    const extensionRoot = path.resolve(contribution.extension.extensionPath);
    const filename = path.resolve(extensionRoot, contribution.relativePath);
    if (!isPathInside(extensionRoot, filename)) {
      output.warn(
        `跳过越出扩展目录的 Snippet 路径：${contribution.extension.id}/${contribution.relativePath}`,
      );
      continue;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filename));
      if (bytes.byteLength > MAX_VISUAL_EXTENSION_SNIPPET_FILE_BYTES) {
        output.warn(`跳过过大的扩展 Snippet 文件：${filename}`);
        continue;
      }
      const errors: ParseError[] = [];
      const root = parseJsonc(new TextDecoder("utf-8", { fatal: false }).decode(bytes), errors, {
        allowTrailingComma: true,
        disallowComments: false,
      }) as unknown;
      if (
        errors.length > 0 ||
        typeof root !== "object" ||
        root === null ||
        Array.isArray(root)
      ) {
        output.warn(`无法解析扩展 Snippet 文件：${filename}`);
        continue;
      }
      for (const value of Object.values(root)) {
        const parsed = parseVisualExtensionSnippetDefinition(
          value,
          languageId,
          contribution.source,
        );
        if (parsed !== undefined) {
          definitions.push(parsed);
          if (definitions.length >= MAX_VISUAL_EXTENSION_SNIPPETS) {
            break;
          }
        }
      }
    } catch (error: unknown) {
      output.debug(`读取扩展 Snippet 失败（${filename}）：${errorMessage(error)}`);
    }
  }
  return definitions;
}

function parseVisualExtensionSnippetDefinition(
  value: unknown,
  languageId: string,
  source: string,
): VisualExtensionSnippetDefinition | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as {
    readonly prefix?: unknown;
    readonly body?: unknown;
    readonly description?: unknown;
    readonly scope?: unknown;
  };
  if (typeof candidate.scope === "string") {
    const scopes = candidate.scope.split(",").map((scope) => scope.trim());
    if (scopes.length > 0 && !scopes.includes(languageId)) {
      return undefined;
    }
  }
  const prefixes = (Array.isArray(candidate.prefix)
    ? candidate.prefix
    : [candidate.prefix])
    .filter((prefix): prefix is string =>
      typeof prefix === "string" &&
      prefix.length > 0 &&
      prefix.length <= 2_048 &&
      !/[\u0000\r\n]/u.test(prefix)
    );
  const body = Array.isArray(candidate.body)
    ? candidate.body.every((line) => typeof line === "string")
      ? candidate.body.join("\n")
      : undefined
    : typeof candidate.body === "string"
      ? candidate.body
      : undefined;
  if (
    prefixes.length === 0 ||
    body === undefined ||
    body.length > MAX_VISUAL_COMPLETION_ITEM_TEXT ||
    /\u0000/u.test(body)
  ) {
    return undefined;
  }
  const description = Array.isArray(candidate.description)
    ? candidate.description.filter((part): part is string => typeof part === "string").join(" ")
    : typeof candidate.description === "string"
      ? candidate.description
      : undefined;
  return {
    prefixes: [...new Set(prefixes)],
    body,
    description: truncateVisualCompletionText(description, 4_096),
    source,
  };
}

function serializeVisualCompletionItem(
  document: vscode.TextDocument,
  position: vscode.Position,
  fallbackFrom: number,
  item: vscode.CompletionItem,
  variables: Readonly<Record<string, string>>,
  completionActionId?: string,
): VisualEditorCompletionItem | undefined {
  const safeFollowUpCommand = item.command?.command ===
    "editor.action.triggerSuggest";
  if (
    (
      item.command !== undefined &&
      completionActionId === undefined &&
      !safeFollowUpCommand
    ) ||
    (item.additionalTextEdits?.length ?? 0) > 0
  ) {
    return undefined;
  }
  const labelObject = typeof item.label === "string" ? undefined : item.label;
  const label = completionItemLabel(item.label);
  if (label.length === 0 || label.length > 2_048 || /[\u0000\r\n]/u.test(label)) {
    return undefined;
  }

  let insertSource: string;
  let snippetSource = false;
  let range: vscode.Range | undefined;
  if (item.textEdit !== undefined) {
    insertSource = item.textEdit.newText;
    range = item.textEdit.range;
  } else {
    if (item.insertText instanceof vscode.SnippetString) {
      insertSource = item.insertText.value;
      snippetSource = true;
    } else {
      insertSource = typeof item.insertText === "string" ? item.insertText : label;
    }
    if (item.range instanceof vscode.Range) {
      range = item.range;
    } else if (item.range !== undefined) {
      const insertMode = vscode.workspace.getConfiguration(
        "editor",
        document.uri,
      ).get<string>("suggest.insertMode", "insert");
      range = insertMode === "replace" ? item.range.replacing : item.range.inserting;
    }
  }
  if (range === undefined) {
    const word = document.getWordRangeAtPosition(position);
    const from = word === undefined
      ? document.positionAt(fallbackFrom)
      : word.start;
    const insertMode = vscode.workspace.getConfiguration(
      "editor",
      document.uri,
    ).get<string>("suggest.insertMode", "insert");
    range = new vscode.Range(
      from,
      insertMode === "replace" && word !== undefined ? word.end : position,
    );
  }
  if (
    !range.isSingleLine ||
    !range.contains(position) ||
    insertSource.length > MAX_VISUAL_COMPLETION_ITEM_TEXT ||
    /\u0000/u.test(insertSource)
  ) {
    return undefined;
  }
  const from = document.offsetAt(range.start);
  const to = document.offsetAt(range.end);
  const expectedText = document.getText(range);
  if (
    from < 0 ||
    to < from ||
    expectedText.length > MAX_VISUAL_COMPLETION_ITEM_TEXT
  ) {
    return undefined;
  }

  let encoding: ReturnType<typeof vscodeSnippetToCodeMirrorSnippet>;
  try {
    if (snippetSource) {
      encoding = vscodeSnippetToCodeMirrorSnippet(insertSource, variables);
    } else {
      const literal = replacementPartsToCodeMirrorSnippet([
        { kind: "text", value: insertSource },
      ]);
      encoding = { ...literal, insertedText: insertSource };
    }
  } catch {
    return undefined;
  }
  if (
    encoding === undefined ||
    encoding.template.length > MAX_VISUAL_COMPLETION_ITEM_TEXT ||
    encoding.insertedText.length > MAX_VISUAL_COMPLETION_ITEM_TEXT
  ) {
    return undefined;
  }
  const detail = truncateVisualCompletionText(item.detail, 4_096);
  const documentation = truncateVisualCompletionText(
    markdownText(item.documentation),
    16_384,
  );
  const labelDetail = truncateVisualCompletionText(labelObject?.detail, 512);
  const labelDescription = truncateVisualCompletionText(
    labelObject?.description,
    1_024,
  );
  const filterText = truncateVisualCompletionText(item.filterText, 2_048, false);
  const sortText = truncateVisualCompletionText(item.sortText, 2_048, false);
  return {
    label,
    ...(labelDetail === undefined ? {} : { labelDetail }),
    ...(labelDescription === undefined ? {} : { labelDescription }),
    ...(detail === undefined ? {} : { detail }),
    ...(documentation === undefined ? {} : { documentation }),
    type: visualCompletionType(item.kind),
    ...(filterText === undefined ? {} : { filterText }),
    ...(sortText === undefined ? {} : { sortText }),
    ...(item.preselect === true ? { boost: 99 } : {}),
    from,
    to,
    expectedText,
    template: encoding.template,
    insertedText: encoding.insertedText,
    openBraceMarker: encoding.openBraceMarker,
    closeBraceMarker: encoding.closeBraceMarker,
    hasSnippetFields: snippetSource,
    ...(completionActionId === undefined ? {} : { completionActionId }),
  };
}

function visualCompletionSnippetVariables(
  document: vscode.TextDocument,
  selection: VisualEditorSelection,
): Readonly<Record<string, string>> {
  const selectedRange = new vscode.Range(
    document.positionAt(Math.min(selection.anchor, selection.head)),
    document.positionAt(Math.max(selection.anchor, selection.head)),
  );
  const position = document.positionAt(selection.head);
  const line = document.lineAt(position.line);
  const word = document.getWordRangeAtPosition(position);
  const uriPath = document.uri.path;
  const filename = path.posix.basename(uriPath);
  const extension = path.posix.extname(filename);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return {
    TM_SELECTED_TEXT: document.getText(selectedRange),
    TM_CURRENT_LINE: line.text,
    TM_CURRENT_WORD: word === undefined ? "" : document.getText(word),
    TM_LINE_INDEX: String(position.line),
    TM_LINE_NUMBER: String(position.line + 1),
    TM_FILENAME: filename,
    TM_FILENAME_BASE: extension.length === 0
      ? filename
      : filename.slice(0, -extension.length),
    TM_DIRECTORY: path.posix.dirname(uriPath),
    TM_FILEPATH: document.uri.scheme === "file"
      ? document.uri.fsPath
      : document.uri.toString(),
    RELATIVE_FILEPATH: vscode.workspace.asRelativePath(document.uri, false),
    WORKSPACE_NAME: workspaceFolder?.name ?? "",
    WORKSPACE_FOLDER: workspaceFolder?.uri.fsPath ?? "",
    CURRENT_YEAR: String(now.getFullYear()),
    CURRENT_YEAR_SHORT: pad(now.getFullYear() % 100),
    CURRENT_MONTH: pad(now.getMonth() + 1),
    CURRENT_MONTH_NAME: now.toLocaleString("en-US", { month: "long" }),
    CURRENT_MONTH_NAME_SHORT: now.toLocaleString("en-US", { month: "short" }),
    CURRENT_DATE: pad(now.getDate()),
    CURRENT_DAY_NAME: now.toLocaleString("en-US", { weekday: "long" }),
    CURRENT_DAY_NAME_SHORT: now.toLocaleString("en-US", { weekday: "short" }),
    CURRENT_HOUR: pad(now.getHours()),
    CURRENT_MINUTE: pad(now.getMinutes()),
    CURRENT_SECOND: pad(now.getSeconds()),
    CURRENT_SECONDS_UNIX: String(Math.floor(now.getTime() / 1_000)),
  };
}

function visualCompletionType(kind: vscode.CompletionItemKind | undefined): string {
  switch (kind) {
    case vscode.CompletionItemKind.Method: return "method";
    case vscode.CompletionItemKind.Function: return "function";
    case vscode.CompletionItemKind.Constructor: return "constructor";
    case vscode.CompletionItemKind.Field: return "field";
    case vscode.CompletionItemKind.Variable: return "variable";
    case vscode.CompletionItemKind.Class: return "class";
    case vscode.CompletionItemKind.Interface: return "interface";
    case vscode.CompletionItemKind.Module: return "namespace";
    case vscode.CompletionItemKind.Property: return "property";
    case vscode.CompletionItemKind.Unit: return "unit";
    case vscode.CompletionItemKind.Value: return "value";
    case vscode.CompletionItemKind.Enum: return "enum";
    case vscode.CompletionItemKind.Keyword: return "keyword";
    case vscode.CompletionItemKind.Snippet: return "snippet";
    case vscode.CompletionItemKind.Color: return "color";
    case vscode.CompletionItemKind.File: return "file";
    case vscode.CompletionItemKind.Reference: return "reference";
    case vscode.CompletionItemKind.Folder: return "folder";
    case vscode.CompletionItemKind.EnumMember: return "enumMember";
    case vscode.CompletionItemKind.Constant: return "constant";
    case vscode.CompletionItemKind.Struct: return "struct";
    case vscode.CompletionItemKind.Event: return "event";
    case vscode.CompletionItemKind.Operator: return "operator";
    case vscode.CompletionItemKind.TypeParameter: return "typeParameter";
    default: return "text";
  }
}

function truncateVisualCompletionText(
  value: string | undefined,
  maximum: number,
  trim = true,
): string | undefined {
  if (value === undefined || /\u0000/u.test(value)) {
    return undefined;
  }
  const normalized = trim ? value.trim() : value;
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum - 1)}…`;
}

function visualCompletionItemTextSize(item: VisualEditorCompletionItem): number {
  return Object.values(item).reduce(
    (total, value) => total + (typeof value === "string" ? value.length : 0),
    0,
  );
}

function completionItemLabel(label: string | vscode.CompletionItemLabel): string {
  return typeof label === "string" ? label : label.label;
}

function markdownText(
  value: string | vscode.MarkdownString | vscode.MarkedString | readonly vscode.MarkedString[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const values = Array.isArray(value) ? value : [value];
  const text = values.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    return entry.value;
  }).join("\n").trim();
  return text.length === 0 ? undefined : text;
}

function parseWebviewMessage(value: unknown): VisualEditorWebviewMessage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Partial<VisualEditorWebviewMessage> & {
    readonly protocol?: unknown;
    readonly type?: unknown;
  };
  if (candidate.protocol !== VISUAL_EDITOR_PROTOCOL || typeof candidate.type !== "string") {
    return undefined;
  }
  switch (candidate.type) {
    case "ready":
      return { protocol: VISUAL_EDITOR_PROTOCOL, type: "ready" };
    case "focusApplied": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "focusApplied" }
      >>;
      if (!Number.isSafeInteger(message.requestId)) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "focusApplied",
        requestId: message.requestId!,
      };
    }
    case "edit": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "edit" }>>;
      if (
        !Number.isSafeInteger(message.revision) ||
        !Array.isArray(message.changes) ||
        !isSelection(message.selection) ||
        typeof message.composing !== "boolean" ||
        (message.source !== "user" && message.source !== "host")
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "edit",
        revision: message.revision!,
        changes: message.changes as readonly VisualEditorChange[],
        selection: message.selection,
        composing: message.composing,
        source: message.source,
      };
    }
    case "selection": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "selection" }>>;
      if (!Number.isSafeInteger(message.version) || !isSelection(message.selection)) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "selection",
        version: message.version!,
        selection: message.selection,
      };
    }
    case "viewport": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "viewport" }>>;
      if (
        !Number.isSafeInteger(message.version) ||
        !Number.isSafeInteger(message.from) ||
        !Number.isSafeInteger(message.to)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "viewport",
        version: message.version!,
        from: message.from!,
        to: message.to!,
      };
    }
    case "cursorPreview": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "cursorPreview" }>>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.version) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.formulaId !== "string" ||
        message.formulaId.length === 0 ||
        message.formulaId.length > 256 ||
        !Number.isSafeInteger(message.formulaFrom) ||
        typeof message.formulaSource !== "string" ||
        message.formulaSource.length === 0 ||
        message.formulaSource.length > 32_768 ||
        message.formulaSource.includes("\0") ||
        !Number.isSafeInteger(message.bodyFrom) ||
        !Number.isSafeInteger(message.bodyTo) ||
        typeof message.display !== "boolean" ||
        (message.environmentName !== undefined &&
          (typeof message.environmentName !== "string" ||
            message.environmentName.length === 0 ||
            message.environmentName.length > 64 ||
            /[{}\\\r\n]/u.test(message.environmentName))) ||
        !Number.isSafeInteger(message.cursorOffset)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "cursorPreview",
        requestId: message.requestId!,
        version: message.version!,
        revision: message.revision!,
        formulaId: message.formulaId,
        formulaFrom: message.formulaFrom!,
        formulaSource: message.formulaSource,
        bodyFrom: message.bodyFrom!,
        bodyTo: message.bodyTo!,
        display: message.display!,
        ...(message.environmentName === undefined
          ? {}
          : { environmentName: message.environmentName }),
        cursorOffset: message.cursorOffset!,
      };
    }
    case "formulaCommitPreview": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "formulaCommitPreview" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.version) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.formulaId !== "string" ||
        message.formulaId.length === 0 ||
        message.formulaId.length > 256 ||
        !Number.isSafeInteger(message.formulaFrom) ||
        typeof message.formulaSource !== "string" ||
        message.formulaSource.length === 0 ||
        message.formulaSource.length > 32_768 ||
        message.formulaSource.includes("\0") ||
        !Number.isSafeInteger(message.bodyFrom) ||
        !Number.isSafeInteger(message.bodyTo) ||
        typeof message.display !== "boolean" ||
        (message.environmentName !== undefined &&
          (typeof message.environmentName !== "string" ||
            message.environmentName.length === 0 ||
            message.environmentName.length > 64 ||
            /[{}\\\r\n]/u.test(message.environmentName)))
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "formulaCommitPreview",
        requestId: message.requestId!,
        version: message.version!,
        revision: message.revision!,
        formulaId: message.formulaId,
        formulaFrom: message.formulaFrom!,
        formulaSource: message.formulaSource,
        bodyFrom: message.bodyFrom!,
        bodyTo: message.bodyTo!,
        display: message.display!,
        ...(message.environmentName === undefined
          ? {}
          : { environmentName: message.environmentName }),
      };
    }
    case "referencePreview": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "referencePreview" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.version) ||
        !Number.isSafeInteger(message.revision) ||
        !Number.isSafeInteger(message.from) ||
        !Number.isSafeInteger(message.to) ||
        typeof message.key !== "string" ||
        message.key.length === 0 ||
        message.key.length > 512 ||
        message.from! < 0 ||
        message.to! <= message.from! ||
        message.to! - message.from! > 100_000
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "referencePreview",
        requestId: message.requestId!,
        version: message.version!,
        revision: message.revision!,
        from: message.from!,
        to: message.to!,
        key: message.key,
      };
    }
    case "completionReferencePreview": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "completionReferencePreview" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.version) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.key !== "string" ||
        message.key.trim().length === 0 ||
        message.key.length > 512 ||
        /[\u0000\r\n{}]/u.test(message.key)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "completionReferencePreview",
        requestId: message.requestId!,
        version: message.version!,
        revision: message.revision!,
        key: message.key.trim(),
      };
    }
    case "clipboard": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { readonly type: "clipboard" }
      >>;
      if (
        (message.action !== "cut" &&
          message.action !== "copy" &&
          message.action !== "paste") ||
        !Number.isSafeInteger(message.revision) ||
        !isSelection(message.selection)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "clipboard",
        action: message.action,
        revision: message.revision!,
        selection: message.selection,
      };
    }
    case "command": {
      const command = (candidate as { readonly command?: unknown }).command;
      if (!isWebviewCommand(command)) {
        return undefined;
      }
      return { protocol: VISUAL_EDITOR_PROTOCOL, type: "command", command };
    }
    case "openTemplate": {
      const templateId = (candidate as { readonly templateId?: unknown }).templateId;
      if (
        typeof templateId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(templateId)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "openTemplate",
        templateId,
      };
    }
    case "inputRequest": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "inputRequest" }>>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        !isInputAction(message.action) ||
        !isSelection(message.selection)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "inputRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        action: message.action,
        selection: message.selection,
      };
    }
    case "completionRequest": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "completionRequest" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        !Number.isSafeInteger(message.position) ||
        !Number.isSafeInteger(message.from) ||
        typeof message.explicit !== "boolean"
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "completionRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        position: message.position!,
        from: message.from!,
        explicit: message.explicit,
      };
    }
    case "completionAccepted": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "completionAccepted" }
      >>;
      if (
        !Number.isSafeInteger(message.revision) ||
        typeof message.actionId !== "string" ||
        !/^[A-Za-z0-9_-]{16,64}$/u.test(message.actionId)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "completionAccepted",
        revision: message.revision!,
        actionId: message.actionId,
      };
    }
    case "virtualSnippetRequest": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "virtualSnippetRequest" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.value !== "string" ||
        !Number.isSafeInteger(message.selectionStart) ||
        !Number.isSafeInteger(message.selectionEnd) ||
        !Number.isSafeInteger(message.anchor) ||
        !isVirtualInputContext(message.context) ||
        (message.activation !== "auto" && message.activation !== "manual")
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualSnippetRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        value: message.value,
        selectionStart: message.selectionStart!,
        selectionEnd: message.selectionEnd!,
        anchor: message.anchor!,
        context: message.context,
        activation: message.activation,
      };
    }
    case "virtualCompletionRequest": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "virtualCompletionRequest" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.value !== "string" ||
        !Number.isSafeInteger(message.selectionStart) ||
        !Number.isSafeInteger(message.selectionEnd) ||
        !Number.isSafeInteger(message.anchor) ||
        !isVirtualInputContext(message.context) ||
        typeof message.explicit !== "boolean"
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualCompletionRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        value: message.value,
        selectionStart: message.selectionStart!,
        selectionEnd: message.selectionEnd!,
        anchor: message.anchor!,
        context: message.context,
        explicit: message.explicit,
      };
    }
    case "virtualMathRenderRequest": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "virtualMathRenderRequest" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        !Number.isSafeInteger(message.anchor) ||
        typeof message.projectContextKey !== "string" ||
        message.projectContextKey.length === 0 ||
        message.projectContextKey.length > 256 ||
        typeof message.tex !== "string" ||
        message.tex.trim().length === 0 ||
        message.tex.length > MAX_VISUAL_VIRTUAL_INPUT_LENGTH
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "virtualMathRenderRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        projectContextKey: message.projectContextKey,
        anchor: message.anchor!,
        tex: message.tex.trim(),
      };
    }
    case "navigate": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "navigate" }
      >>;
      if (
        !Number.isSafeInteger(message.revision) ||
        (message.kind !== "reference" && message.kind !== "citation") ||
        !Number.isSafeInteger(message.from) ||
        !Number.isSafeInteger(message.to) ||
        (message.key !== undefined &&
          (typeof message.key !== "string" ||
            message.key.length === 0 ||
            message.key.length > 512))
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "navigate",
        revision: message.revision!,
        kind: message.kind,
        from: message.from!,
        to: message.to!,
        ...(message.key === undefined ? {} : { key: message.key }),
      };
    }
    case "aiIssueAction": {
      const message = candidate as Partial<Extract<VisualEditorWebviewMessage, { type: "aiIssueAction" }>>;
      if (
        !Number.isSafeInteger(message.revision) ||
        typeof message.issueId !== "string" ||
        message.issueId.length === 0 ||
        (message.action !== "apply" && message.action !== "ignore")
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "aiIssueAction",
        revision: message.revision!,
        issueId: message.issueId,
        action: message.action,
      };
    }
    case "diagnosticInsightRequest": {
      const message = candidate as Partial<Extract<
        VisualEditorWebviewMessage,
        { type: "diagnosticInsightRequest" }
      >>;
      if (
        !Number.isSafeInteger(message.requestId) ||
        !Number.isSafeInteger(message.revision) ||
        typeof message.diagnosticId !== "string" ||
        !/^[a-f0-9]{20}$/u.test(message.diagnosticId)
      ) {
        return undefined;
      }
      return {
        protocol: VISUAL_EDITOR_PROTOCOL,
        type: "diagnosticInsightRequest",
        requestId: message.requestId!,
        revision: message.revision!,
        diagnosticId: message.diagnosticId,
      };
    }
    default:
      return undefined;
  }
}

function normalizeChanges(
  values: readonly VisualEditorChange[],
  textLength: number,
): readonly VisualEditorChange[] | undefined {
  if (values.length === 0 || values.length > MAX_CHANGE_COUNT) {
    return undefined;
  }
  let insertedLength = 0;
  const changes: VisualEditorChange[] = [];
  for (const value of values) {
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isSafeInteger(value.from) ||
      !Number.isSafeInteger(value.to) ||
      typeof value.insert !== "string" ||
      value.from < 0 ||
      value.to < value.from ||
      value.to > textLength
    ) {
      return undefined;
    }
    insertedLength += value.insert.length;
    if (insertedLength > MAX_INSERTED_TEXT) {
      return undefined;
    }
    changes.push({ from: value.from, to: value.to, insert: value.insert });
  }
  changes.sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < changes.length; index += 1) {
    const previous = changes[index - 1];
    const current = changes[index];
    if (previous === undefined || current === undefined || current.from < previous.to) {
      return undefined;
    }
  }
  return changes;
}

interface VisualSyntaxEditSpan {
  readonly startLine: number;
  readonly oldEndLine: number;
  readonly newEndOffset: number;
}

function visualSyntaxEditSpan(
  document: vscode.TextDocument,
  changes: readonly VisualEditorChange[],
): VisualSyntaxEditSpan {
  let startLine = Number.POSITIVE_INFINITY;
  let oldEndLine = 0;
  let newEndOffset = 0;
  let delta = 0;
  for (const change of changes) {
    startLine = Math.min(startLine, document.positionAt(change.from).line);
    oldEndLine = Math.max(oldEndLine, document.positionAt(change.to).line);
    const newFrom = change.from + delta;
    newEndOffset = Math.max(newEndOffset, newFrom + change.insert.length);
    delta += change.insert.length - (change.to - change.from);
  }
  return {
    startLine: Number.isFinite(startLine) ? startLine : 0,
    oldEndLine,
    newEndOffset,
  };
}

function visualIncrementalSyntaxInput(
  document: vscode.TextDocument,
  beforeText: string,
  afterText: string,
  span: VisualSyntaxEditSpan,
): VisualEditorIncrementalSyntaxInput | undefined {
  if (document.getText() !== afterText || document.lineCount <= 0) {
    return undefined;
  }
  const startLine = clampInteger(span.startLine, 0, document.lineCount - 1);
  const newEndLine = document.positionAt(
    clampInteger(span.newEndOffset, 0, afterText.length),
  ).line;
  const startOffset = document.offsetAt(new vscode.Position(startLine, 0));
  const newLines: VisualEditorSyntaxLineInput[] = [];
  for (let lineIndex = startLine; lineIndex <= newEndLine; lineIndex += 1) {
    const line = document.lineAt(lineIndex);
    const contentEnd = document.offsetAt(line.range.end);
    const nextLineStart = lineIndex + 1 < document.lineCount
      ? document.offsetAt(new vscode.Position(lineIndex + 1, 0))
      : contentEnd;
    const rawEolLength = nextLineStart - contentEnd;
    if (rawEolLength < 0 || rawEolLength > 2) {
      return undefined;
    }
    newLines.push({
      text: line.text,
      eolLength: rawEolLength as 0 | 1 | 2,
    });
  }
  return {
    beforeText,
    afterText,
    startLine,
    oldEndLine: span.oldEndLine,
    startOffset,
    newLines,
  };
}

function applyChanges(text: string, changes: readonly VisualEditorChange[]): string {
  let cursor = 0;
  let result = "";
  for (const change of changes) {
    result += text.slice(cursor, change.from);
    result += change.insert;
    cursor = change.to;
  }
  return result + text.slice(cursor);
}

function isSelection(value: unknown): value is VisualEditorSelection {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<VisualEditorSelection>;
  return Number.isSafeInteger(candidate.anchor) && Number.isSafeInteger(candidate.head);
}

function clampSelection(
  selection: VisualEditorSelection,
  textLength: number,
): VisualEditorSelection {
  return {
    anchor: clampInteger(selection.anchor, 0, textLength),
    head: clampInteger(selection.head, 0, textLength),
  };
}

function sameSelection(
  left: VisualEditorSelection,
  right: VisualEditorSelection,
): boolean {
  return left.anchor === right.anchor && left.head === right.head;
}

function selectionForDocument(
  document: vscode.TextDocument,
  selection: VisualEditorSelection,
): vscode.Selection {
  const clamped = clampSelection(selection, document.getText().length);
  return new vscode.Selection(
    document.positionAt(clamped.anchor),
    document.positionAt(clamped.head),
  );
}

function isWebviewCommand(value: unknown): value is VisualEditorWebviewCommand {
  return value === "save" || value === "openSource" || value === "build" ||
    value === "buildPdfLaTex" || value === "buildXeLaTex" ||
    value === "buildLuaLaTex" || value === "buildBibTex" ||
    value === "buildBibLaTex" ||
    value === "viewPdf" || value === "synctex" || value === "undo" ||
    value === "redo" || value === "pickSnippet" || value === "pickCitation" ||
    value === "openSnippetManager" || value === "openTemplateManager" ||
    value === "openBibliography" ||
    value === "navigateBack" ||
    value === "aiReview" || value === "aiReviewDocument" ||
    value === "aiRewrite" || value === "aiCompletion";
}

function isBibliographyDocument(document: vscode.TextDocument): boolean {
  return document.languageId === "bibtex" || /\.bib$/iu.test(document.uri.path);
}

function isInputAction(value: unknown): value is VisualEditorInputAction {
  return value === "tab" || value === "shiftTab" || value === "space" || value === "enter" ||
    value === "shiftEnter";
}

function isVirtualInputContext(
  value: unknown,
): value is VisualEditorVirtualInputContext {
  return value === "table" || value === "tikzcd";
}

function readVisualProviderCompletionSetting(uri: vscode.Uri): boolean {
  return vscode.workspace.getConfiguration("texleaf", uri).get<boolean>(
    "visualEditor.providerCompletions",
    true,
  );
}

function visualReferenceCompletionKeys(
  labelsByKey: ReadonlyMap<string, readonly LatexProjectLabelTarget[]>,
  context: VisualReferenceCompletionContext,
): readonly string[] {
  const query = context.query.trim().toLocaleLowerCase();
  return [...labelsByKey.keys()]
    .flatMap((key) => {
      const rank = visualReferenceCompletionRank(key, query);
      return rank === undefined ? [] : [{ key, rank }];
    })
    .sort((left, right) =>
      left.rank - right.rank ||
      left.key.localeCompare(right.key, undefined, { sensitivity: "base" })
    )
    .slice(0, MAX_VISUAL_COMPLETION_ITEMS)
    .map((candidate) => candidate.key);
}

function visualReferenceCompletionItems(
  text: string,
  context: VisualReferenceCompletionContext,
  orderedKeys: readonly string[],
  labelsByKey: ReadonlyMap<string, readonly LatexProjectLabelTarget[]>,
  descriptors: ReadonlyMap<string, VisualProjectReferenceDescriptor>,
): readonly VisualEditorCompletionItem[] {
  return orderedKeys.map((key, index) => {
    const targets = labelsByKey.get(key) ?? [];
    const descriptor = descriptors.get(key);
    const snapshot = descriptor?.snapshot;
    const formulaMatches = snapshot?.records.filter((record) =>
      record.labels.some((label) => label.key === key)
    ) ?? [];
    const theoremMatches = formulaMatches.length === 0
      ? snapshot?.structures.filter(
          (record): record is Extract<VisualStructureRecord, { readonly kind: "theorem" }> =>
            record.kind === "theorem" &&
            record.labels.some((label) => label.key === key),
        ) ?? []
      : [];
    const heading = formulaMatches.length === 0 &&
        theoremMatches.length === 0 && snapshot !== undefined
      ? findVisualHeadingForLabel(snapshot.text, snapshot.structures, key)
      : undefined;
    const previewKind = formulaMatches.length === 1
      ? "formula" as const
      : theoremMatches.length === 1
        ? "theorem" as const
        : heading !== undefined
          ? "heading" as const
          : undefined;
    const theorem = theoremMatches.length === 1 ? theoremMatches[0] : undefined;
    const ambiguity = targets.length > 1
      ? `${targets.length} 个同名定义，预览已禁用`
      : targets[0] !== undefined && targets[0].occurrenceCount > 1
        ? `来源文件被重复包含 ${targets[0].occurrenceCount} 次，预览已禁用`
        : undefined;
    const description = ambiguity ?? (previewKind === "formula"
      ? "公式标签 · 右侧显示 Math Preview"
      : previewKind === "heading"
        ? [heading?.number, heading?.title, "右侧显示章节标题"]
            .filter((part): part is string => part !== undefined && part.length > 0)
            .join(" ")
      : theorem === undefined
        ? visualReferenceLabelDescription(key)
        : [
            theorem.label,
            theorem.number,
            theorem.optionalTitle === undefined ? undefined : `(${theorem.optionalTitle})`,
            "右侧显示定理预览",
          ].filter((part): part is string => part !== undefined && part.length > 0).join(" "));
    const labelDescription = [description, descriptor?.source]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(" · ");
    const encoding = replacementPartsToCodeMirrorSnippet([
      { kind: "text", value: key },
    ]);
    return {
      label: key,
      labelDescription,
      detail: `${context.command} 可引用标签`,
      type: "reference",
      filterText: key,
      sortText: String(index).padStart(4, "0"),
      boost: Math.max(0, 100 - index),
      from: context.from,
      to: context.to,
      expectedText: text.slice(context.from, context.to),
      template: encoding.template,
      insertedText: key,
      openBraceMarker: encoding.openBraceMarker,
      closeBraceMarker: encoding.closeBraceMarker,
      hasSnippetFields: false,
      ...(previewKind === undefined
        ? {}
        : { referencePreviewKey: key, referencePreviewKind: previewKind }),
    };
  });
}

function visualReferenceCompletionRank(
  key: string,
  normalizedQuery: string,
): number | undefined {
  if (normalizedQuery.length === 0) {
    return 30;
  }
  const candidate = key.toLocaleLowerCase();
  if (candidate === normalizedQuery) {
    return 0;
  }
  if (candidate.startsWith(normalizedQuery)) {
    return 5 + candidate.length - normalizedQuery.length;
  }
  const segments = candidate.split(/[:._/-]+/u);
  if (segments.some((segment) => segment.startsWith(normalizedQuery))) {
    return 12 + candidate.length - normalizedQuery.length;
  }
  const contains = candidate.indexOf(normalizedQuery);
  if (contains >= 0) {
    return 20 + contains;
  }
  let cursor = 0;
  for (const character of candidate) {
    if (character === normalizedQuery[cursor]) {
      cursor += 1;
      if (cursor === normalizedQuery.length) {
        return 40 + candidate.length - normalizedQuery.length;
      }
    }
  }
  return undefined;
}

function visualReferenceLabelDescription(key: string): string {
  const prefix = key.split(":", 1)[0]?.toLocaleLowerCase();
  switch (prefix) {
    case "sec":
    case "chap":
    case "part":
      return "章节标签";
    case "fig":
      return "图片标签";
    case "tab":
      return "表格标签";
    case "alg":
      return "算法标签";
    default:
      return "文档可引用标签";
  }
}

/**
 * Keep citation-context detection in step with both the configured TeXLeaf
 * commands and cite-like commands contributed by LaTeX packages. The actual
 * citation provider still performs the authoritative parse before returning
 * any bibliography entries.
 */
function visualCitationCommandNames(
  text: string,
  cursor: number,
  configured: readonly string[],
): readonly string[] {
  const commands = new Set(configured);
  const safeCursor = clampInteger(cursor, 0, text.length);
  const prefix = text.slice(Math.max(0, safeCursor - 65_536), safeCursor);
  const citeLike = /\\([A-Za-z@]*(?:[Cc]ite|cquote)[A-Za-z@]*|bibentry)\*?/gu;
  for (const match of prefix.matchAll(citeLike)) {
    const command = match[1];
    if (command !== undefined && command.length > 0) {
      commands.add(command);
    }
  }
  return [...commands];
}

function latexWorkshopExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.getExtension(LATEX_WORKSHOP_EXTENSION_ID);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

/**
 * A label on a transparent layout wrapper such as `subequations` belongs to
 * the display formula inside that wrapper, not to an enclosing theorem.  The
 * formula scanner intentionally omits the transparent wrapper itself, so the
 * label falls just outside the inner `align` formula's source range.  Recover
 * that ownership here before theorem/heading preview fallback is considered.
 */
function transparentFormulaRecordForReference(
  snapshot: VisualSnapshot,
  key: string,
): VisualFormulaRecord | undefined {
  const labels = snapshot.structures.filter(
    (record): record is Extract<VisualStructureRecord, { readonly kind: "label" }> =>
      record.kind === "label" && record.key === key,
  );
  if (labels.length !== 1) {
    return undefined;
  }
  const label = labels[0];
  if (label === undefined) {
    return undefined;
  }
  const wrappers = snapshot.structures.filter(
    (record): record is Extract<VisualStructureRecord, { readonly kind: "textStyle" }> =>
      record.kind === "textStyle" &&
      record.transparent === true &&
      record.command === "subequations" &&
      label.from >= record.contentFrom &&
      label.to <= record.contentTo,
  );
  if (wrappers.length !== 1) {
    return undefined;
  }
  const wrapper = wrappers[0];
  if (wrapper === undefined) {
    return undefined;
  }
  const candidates = snapshot.records.filter((record) =>
    record.display &&
    record.from >= wrapper.contentFrom &&
    record.to <= wrapper.contentTo
  );
  const outermost = candidates.filter((candidate) =>
    !candidates.some((other) =>
      other !== candidate &&
      other.from <= candidate.from &&
      other.to >= candidate.to
    )
  );
  return outermost.length === 1 ? outermost[0] : undefined;
}

const VISUAL_MULTIROW_FORMULA_ENVIRONMENTS = new Set([
  "align",
  "align*",
  "alignat",
  "alignat*",
  "aligned",
  "alignedat",
  "flalign",
  "flalign*",
  "gather",
  "gather*",
  "gathered",
  "multline",
  "multline*",
  "split",
]);

function visualFormulaLabels(
  text: string,
  formula: MathPreviewFormula,
): readonly VisualFormulaLabel[] {
  const labels = findVisualLabelsInRange(
    text,
    formula.outerRange.start,
    formula.outerRange.end,
  );
  const boundaries = formula.environmentName !== undefined &&
      VISUAL_MULTIROW_FORMULA_ENVIRONMENTS.has(formula.environmentName)
    ? visualOuterFormulaRowBoundaries(
        text,
        formula.bodyRange.start,
        formula.bodyRange.end,
      )
    : [];
  const rowCount = Math.max(1, boundaries.length + 1);
  return labels.map((label) => ({
    from: label.from,
    to: label.to,
    key: label.key,
    rowIndex: boundaries.reduce(
      (count, boundary) => count + (boundary < label.from ? 1 : 0),
      0,
    ),
    rowCount,
  }));
}

/**
 * Locate row separators owned by the outer aligned environment. Separators in
 * braced commands (`\text`, `\substack`, …), comments, and nested matrix-like
 * environments must not move an outer equation label to the wrong row.
 */
function visualOuterFormulaRowBoundaries(
  text: string,
  requestedFrom: number,
  requestedTo: number,
): readonly number[] {
  const from = clampInteger(requestedFrom, 0, text.length);
  const to = clampInteger(requestedTo, from, text.length);
  const boundaries: number[] = [];
  let braceDepth = 0;
  let nestedEnvironmentDepth = 0;
  let index = from;
  while (index < to) {
    const character = text[index];
    if (character === "%" && !visualIsEscapedAt(text, index)) {
      const newline = text.indexOf("\n", index + 1);
      index = newline < 0 || newline >= to ? to : newline + 1;
      continue;
    }
    if (character === "{" && !visualIsEscapedAt(text, index)) {
      braceDepth += 1;
      index += 1;
      continue;
    }
    if (character === "}" && !visualIsEscapedAt(text, index)) {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }
    if (character !== "\\" || visualIsEscapedAt(text, index)) {
      index += 1;
      continue;
    }
    const control = /^\\([A-Za-z@]+\*?)/u.exec(text.slice(index, to));
    const controlName = control?.[1];
    const controlEnd = index + (control?.[0].length ?? 1);
    if (controlName === "begin" || controlName === "end") {
      const argument = visualRequiredArgument(text, controlEnd, to);
      if (argument !== undefined) {
        if (controlName === "begin") {
          nestedEnvironmentDepth += 1;
        } else {
          nestedEnvironmentDepth = Math.max(0, nestedEnvironmentDepth - 1);
        }
        index = argument.end;
        continue;
      }
    }
    if (braceDepth === 0 && nestedEnvironmentDepth === 0) {
      const rowBoundaryLength = visualFormulaRowBoundaryLengthAt(text, index, to);
      if (rowBoundaryLength > 0) {
        boundaries.push(index);
        index += rowBoundaryLength;
        continue;
      }
    }
    index = Math.max(index + 1, controlEnd);
  }
  return boundaries;
}

function visualFormulaRowBoundaryLengthAt(
  text: string,
  offset: number,
  limit: number,
): number {
  if (text.startsWith("\\\\", offset) && offset + 2 <= limit) {
    return 2;
  }
  for (const command of ["\\tabularnewline", "\\crcr", "\\cr"]) {
    if (!text.startsWith(command, offset) || offset + command.length > limit) {
      continue;
    }
    const next = text[offset + command.length];
    if (next === undefined || !/[A-Za-z@]/u.test(next)) {
      return command.length;
    }
  }
  return 0;
}

function visualRequiredArgument(
  text: string,
  requestedFrom: number,
  limit: number,
): { readonly end: number } | undefined {
  let index = requestedFrom;
  while (index < limit && /\s/u.test(text[index] ?? "")) {
    index += 1;
  }
  if (text[index] !== "{") {
    return undefined;
  }
  let depth = 1;
  for (index += 1; index < limit; index += 1) {
    if (visualIsEscapedAt(text, index)) {
      continue;
    }
    if (text[index] === "{") {
      depth += 1;
    } else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { end: index + 1 };
      }
    }
  }
  return undefined;
}

function visualIsEscapedAt(text: string, offset: number): boolean {
  let slashes = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

/**
 * Keep an unchanged formula stable across unrelated document edits. Source
 * offsets and TextDocument versions are deliberately excluded so a rendered
 * SVG can move with the document instead of disappearing and being rebuilt.
 */
function visualFormulaIdentity(
  input: Pick<MathPreviewRenderInput, "tex" | "display" | "macroFingerprint">,
  scale: number,
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "texleaf-visual-formula-v1",
      input.tex,
      input.display,
      input.macroFingerprint,
      scale,
    ]))
    .digest("hex")
    .slice(0, 24);
}

function resetViewportRenderRequest(session: VisualEditorSession): void {
  session.viewportRenderRequest = undefined;
  session.viewportRenderBudgetSequence = -1;
  session.viewportRenderBudgetUsed = 0;
}

function rememberRenderedFormulaId(
  session: VisualEditorSession,
  formulaId: string,
): void {
  // Set insertion order is used as a tiny LRU. Keeping this bounded matters in
  // a thesis-sized session that visits many files/formulae without reloading
  // the custom editor. The renderer itself still owns its separate byte cache.
  session.renderedFormulaIds.delete(formulaId);
  session.renderedFormulaIds.add(formulaId);
  while (session.renderedFormulaIds.size > MAX_RESIDENT_FORMULA_IDS) {
    const oldest = session.renderedFormulaIds.values().next().value as
      | string
      | undefined;
    if (oldest === undefined) {
      break;
    }
    session.renderedFormulaIds.delete(oldest);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForViewportInputQuiet(
  state: VisualDocumentState,
  session: VisualEditorSession,
): Promise<void> {
  while (!session.disposed) {
    const remaining = state.lastCursorPreviewAt + VIEWPORT_RENDER_INPUT_QUIET_MS -
      Date.now();
    if (remaining <= 0) {
      return;
    }
    await delay(remaining);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
