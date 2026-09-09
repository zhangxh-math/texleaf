/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import type {
  VisualHeadingLevel,
  VisualImageRecord,
  VisualFigureRecord,
  VisualReferenceRecord,
  VisualReferenceTargetKind,
  VisualStructureRecord,
  VisualTableRecord,
  VisualTheoremStyle,
  VisualTikzcdRecord,
  VisualTikzpictureRecord,
} from "./core/visualStructure";
import type { VirtualSnippetEncoding } from "./core/visualEditing";

export const VISUAL_EDITOR_PROTOCOL = 1 as const;
export const VISUAL_EDITOR_REVEAL_RANGE_COMMAND =
  "texleaf.visualEditor.revealRange";
/**
 * Reveal a range only when that source document already has a visual-editor
 * session. TeXLeaf's reverse SyncTeX path uses this for PDF tabs restored
 * from an earlier extension-host session: it must prefer the existing visual
 * tab without creating an unrelated source editor.
 */
export const VISUAL_EDITOR_REVEAL_OPEN_RANGE_COMMAND =
  "texleaf.visualEditor.revealOpenRange";
/** Exact line/column bridge used by Problems diagnostic links and Quick Fixes. */
export const VISUAL_EDITOR_REVEAL_DIAGNOSTIC_COMMAND =
  "texleaf.visualEditor.revealDiagnostic";
/** Apply one revalidated Problems suggestion through CodeMirror's own history. */
export const VISUAL_EDITOR_APPLY_AI_ISSUE_COMMAND =
  "texleaf.visualEditor.applyAiIssue";

export interface VisualFormulaLabel {
  readonly from: number;
  readonly to: number;
  readonly key: string;
  /** Zero-based row within an outer aligned display environment. */
  readonly rowIndex: number;
  /** Number of outer rows represented by the rendered display. */
  readonly rowCount: number;
}

export interface VisualFormulaRecord {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly display: boolean;
  /** A containing structure renders this formula; source editing still has Math Preview. */
  readonly sourceOnly?: boolean;
  /** Present for display environments whose body must retain its wrapper. */
  readonly environmentName?: string;
  readonly labels: readonly VisualFormulaLabel[];
  readonly references?: readonly VisualReferenceRecord[];
}

export interface VisualEditorReferenceFormulaPreview {
  readonly key: string;
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
  /** Zero-based outer display row which owns this label. */
  readonly rowIndex: number;
  /** Number of outer rows represented by the rendered display. */
  readonly rowCount: number;
}

export interface VisualEditorReferenceTheoremFormulaPreview {
  /** UTF-16 offsets relative to the bounded theorem body below. */
  readonly from: number;
  readonly to: number;
  readonly display: boolean;
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
}

export interface VisualEditorReferenceTheoremPreview {
  readonly key: string;
  readonly label: string;
  readonly number?: string;
  readonly optionalTitle?: string;
  readonly style: VisualTheoremStyle;
  /** Bounded source excerpt; formula ranges are relative to this string. */
  readonly body: string;
  readonly formulas: readonly VisualEditorReferenceTheoremFormulaPreview[];
  readonly truncated: boolean;
}

export interface VisualEditorReferenceHeadingPreview {
  readonly key: string;
  readonly command: VisualHeadingLevel;
  readonly number?: string;
  readonly title: string;
}

export type VisualEditorReferenceStructurePreview =
  | {
      readonly kind: "table";
      readonly key: string;
      readonly record: VisualTableRecord;
      /** The hover applies a smaller bound than the full visual table card. */
      readonly previewTruncated: boolean;
    }
  | {
      readonly kind: "image";
      readonly key: string;
      readonly record: VisualImageRecord;
    }
  | {
      readonly kind: "diagram";
      readonly key: string;
      readonly record: VisualTikzcdRecord | VisualTikzpictureRecord | VisualFigureRecord;
    };

export interface VisualEditorSelection {
  readonly anchor: number;
  readonly head: number;
}

/** One sanitized static formula asset produced for the current viewport. */
export interface VisualFormulaRenderResult {
  readonly formulaId: string;
  /** Exact outer LaTeX source represented by this SVG. */
  readonly formulaSource: string;
  readonly svg: string;
  readonly widthEm: number;
  readonly heightEm: number;
}

/** A bounded static formula failure delivered with the surrounding batch. */
export interface VisualFormulaRenderError {
  readonly formulaId: string;
  readonly message: string;
}

export interface VisualEditorFocusOptions {
  /** Place the target logical line near the vertical middle of the editor. */
  readonly center?: boolean;
  /** Briefly flash the target logical line after navigation. */
  readonly flash?: boolean;
}

export interface VisualEditorChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface VisualEditorCapabilities {
  readonly latexWorkshopInstalled?: boolean;
  readonly latexWorkshopCompatibility?: boolean;
  readonly localFileSystem: boolean;
  readonly workspaceTrusted: boolean;
  readonly buildEnabled: boolean;
  readonly pdfViewerEnabled: boolean;
  readonly synctexEnabled: boolean;
}

export interface VisualEditorInputFeatures {
  readonly previewZoomPercent?: number;
  readonly compatibilityMode?: "basic" | "maximum";
  readonly enabled: boolean;
  readonly manualTrigger: "tab" | "space";
  readonly matrixShortcuts: boolean;
  readonly matrixEnvironments: readonly string[];
  readonly autoDeleteMathDelimiters: boolean;
  readonly providerCompletions?: boolean;
  readonly internalCompletions: boolean;
  readonly mathPreviewEnabled: boolean;
  readonly mathPreviewDebounceMs: number;
  /** Monaco-compatible pair colours are active over followVsCode TextMate. */
  readonly bracketPairColorizationEnabled: boolean;
  /** Paint the pair adjacent to a focused visual/source caret. */
  readonly highlightActiveBracketPair: boolean;
  /** Configured citation commands, without depending on native-editor state. */
  readonly citationCommands: readonly string[];
}

/** Sanitized subset of shalldie.background's editor-layer configuration. */
export interface VisualEditorBackground {
  readonly imageUrl: string;
  readonly opacity: number;
  readonly position: string;
  readonly size: string;
  readonly repeat: string;
  readonly useFront: boolean;
}

/**
 * TextMate-derived fallback colors for the CodeMirror source presentation.
 * In followVsCode mode the host resolves these roles from the active theme;
 * fixedPrimer supplies the bundled contrast-safe light/dark palette instead.
 */
export interface VisualEditorSyntaxPalette {
  readonly comment?: string;
  readonly command?: string;
  readonly keyword?: string;
  readonly string?: string;
  readonly atom?: string;
  readonly number?: string;
  readonly variable?: string;
  readonly operator?: string;
  readonly punctuation?: string;
  readonly meta?: string;
  readonly link?: string;
  readonly heading?: string;
  readonly invalid?: string;
}

/**
 * A TextMate token resolved by the extension host with the selected theme and
 * grammar pair. Offsets are UTF-16 document offsets, matching VS Code and
 * CodeMirror.
 */
export interface VisualEditorSyntaxToken {
  readonly from: number;
  readonly to: number;
  readonly foreground?: string;
  /** TextMate FontStyle bits: italic=1, bold=2, underline=4, strike=8. */
  readonly fontStyle: number;
}

/** One source delimiter painted with VS Code's editorBracketHighlight palette. */
export interface VisualEditorBracketToken {
  readonly from: number;
  readonly to: number;
  /** Zero-based nesting depth; the Webview cycles this through six colours. */
  readonly depth: number;
}

export interface VisualEditorCompletionItem {
  readonly label: string;
  readonly labelDetail?: string;
  readonly labelDescription?: string;
  readonly detail?: string;
  readonly documentation?: string;
  readonly type: string;
  readonly filterText?: string;
  readonly sortText?: string;
  readonly boost?: number;
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly template: string;
  readonly insertedText: string;
  readonly openBraceMarker: string;
  readonly closeBraceMarker: string;
  /** Whether accepting this item should leave active snippet fields. */
  readonly hasSnippetFields?: boolean;
  /** Lazy detail-pane target for a real document label completion. */
  readonly referencePreviewKey?: string;
  readonly referencePreviewKind?: Exclude<VisualReferenceTargetKind, "unknown">;
  /**
   * Opaque, one-shot host token for an allow-listed completion follow-up.
   * The Webview never receives a VS Code command name or its arguments.
   */
  readonly completionActionId?: string;
}

export type VisualEditorVirtualInputContext = "table" | "tikzcd";

export interface VisualEditorVirtualCompletionItem {
  readonly label: string;
  readonly detail?: string;
  readonly source: string;
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly snippet: VirtualSnippetEncoding;
}

export type VisualMathPreviewPlacement =
  | "autoBelow"
  | "autoAbove"
  | "above"
  | "below";

export interface VisualEditorSnippetModifier {
  readonly from: number;
  readonly to: number;
  readonly expectedText: string;
  readonly insert: string;
}

export interface VisualEditorAiIssue {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly message: string;
  readonly explanation: string;
  readonly replacement: string;
  readonly category: string;
  /** Mirrors vscode.DiagnosticSeverity without importing VS Code into Webview. */
  readonly severity: number;
}

/** A VS Code diagnostic mirrored into the text-backed visual editor. */
export interface VisualEditorDiagnostic {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly message: string;
  readonly severity: number;
  readonly source?: string;
  readonly code?: string;
}

/** Safe template metadata exposed to the Webview toolbar. */
export interface VisualEditorTemplateMenuItem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isFactory: boolean;
}

export type VisualEditorInputAction =
  | "auto"
  | "tab"
  | "shiftTab"
  | "space"
  | "enter"
  | "shiftEnter";

export type VisualEditorHostMessage =
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "structureAssets";
      readonly replaceAll?: boolean;
      readonly revision: number;
      readonly version: number;
      readonly assetGeneration: number;
      readonly structures: readonly VisualStructureRecord[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "initialize" | "document";
      readonly assetGeneration?: number;
      readonly text: string;
      readonly version: number;
      readonly revision: number;
      /** Changes when any dependency/root evidence in the active project changes. */
      readonly projectContextKey: string;
      readonly editable: boolean;
      readonly formulas: readonly VisualFormulaRecord[];
      readonly structures: readonly VisualStructureRecord[];
      readonly selection?: VisualEditorSelection;
      /**
       * Present only when the initial selection came from an explicit external
       * line/range request. The Webview must prefer it over persisted caret and
       * scroll state, then reveal it as soon as CodeMirror exists.
       */
      readonly initialFocus?: VisualEditorFocusOptions;
      readonly mathPreviewPlacement: VisualMathPreviewPlacement;
      readonly capabilities: VisualEditorCapabilities;
      readonly inputFeatures: VisualEditorInputFeatures;
      readonly background?: VisualEditorBackground;
      readonly syntaxPalette?: VisualEditorSyntaxPalette;
      readonly syntaxTokens?: readonly VisualEditorSyntaxToken[];
      /** Present on initial/config/external refreshes; routine edits use patches. */
      readonly bracketTokens?: readonly VisualEditorBracketToken[];
      readonly aiIssues: readonly VisualEditorAiIssue[];
      readonly diagnostics: readonly VisualEditorDiagnostic[];
      readonly templates: readonly VisualEditorTemplateMenuItem[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "projectContextInvalidated";
      /** A provisional token that immediately retires every old project result. */
      readonly projectContextKey: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "syntaxTokenPatch";
      /** Exact optimistic Webview revision this patch was tokenized from. */
      readonly revision: number;
      readonly from: number;
      readonly to: number;
      /** Guards against a stale same-revision/range response. */
      readonly expectedText: string;
      readonly tokens: readonly VisualEditorSyntaxToken[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "bracketTokenPatch";
      /** Exact optimistic Webview revision this patch was scanned from. */
      readonly revision: number;
      readonly from: number;
      readonly to: number;
      readonly expectedText: string;
      readonly tokens: readonly VisualEditorBracketToken[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "renderBatch";
      readonly assetGeneration?: number;
      readonly version: number;
      /**
       * Static viewport renders are intentionally coalesced. One host message
       * must translate to one CodeMirror transaction instead of rebuilding the
       * complete formula presentation once per SVG.
       */
      readonly results: readonly VisualFormulaRenderResult[];
      readonly errors: readonly VisualFormulaRenderError[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "cursorRenderResult";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      /** Exact outer LaTeX source represented by this cursor SVG. */
      readonly formulaSource: string;
      readonly cursorOffset: number;
      readonly svg: string;
      readonly widthEm: number;
      readonly heightEm: number;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "cursorRenderError";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      readonly message: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "formulaCommitRenderResult";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      readonly formulaSource: string;
      readonly svg: string;
      readonly widthEm: number;
      readonly heightEm: number;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "formulaCommitRenderError";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      readonly message: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "referencePreviewResult";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly from: number;
      readonly to: number;
      readonly key: string;
      readonly previews: readonly VisualEditorReferenceFormulaPreview[];
      readonly theorem?: VisualEditorReferenceTheoremPreview;
      readonly heading?: VisualEditorReferenceHeadingPreview;
      readonly structure?: VisualEditorReferenceStructurePreview;
      readonly unavailableKeys: readonly string[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionReferencePreviewResult";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly key: string;
      readonly previews: readonly VisualEditorReferenceFormulaPreview[];
      readonly theorem?: VisualEditorReferenceTheoremPreview;
      readonly heading?: VisualEditorReferenceHeadingPreview;
      readonly structure?: VisualEditorReferenceStructurePreview;
      readonly unavailableKeys: readonly string[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "status";
      readonly level: "info" | "warning" | "error";
      readonly message: string;
      readonly busy?: boolean;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "focus";
      readonly requestId?: number;
      readonly selection: VisualEditorSelection;
      readonly options?: VisualEditorFocusOptions;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "applySnippet";
      readonly revision: number;
      readonly requestId?: number;
      readonly from: number;
      readonly to: number;
      readonly expectedText: string;
      readonly template: string;
      readonly insertedText: string;
      readonly openBraceMarker: string;
      readonly closeBraceMarker: string;
      /** Whether this automatic expansion contains a real snippet field. */
      readonly hasSnippetFields?: boolean;
      readonly modifiers: readonly VisualEditorSnippetModifier[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "applyEdit";
      readonly revision: number;
      readonly requestId?: number;
      readonly from: number;
      readonly to: number;
      readonly expectedText: string;
      readonly insert: string;
      readonly selection: VisualEditorSelection;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "inputFallback";
      readonly revision: number;
      readonly requestId: number;
      readonly action: VisualEditorInputAction;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "aiIssues";
      readonly version: number;
      readonly revision: number;
      readonly issues: readonly VisualEditorAiIssue[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "diagnostics";
      readonly version: number;
      readonly revision: number;
      readonly diagnostics: readonly VisualEditorDiagnostic[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "diagnosticInsight";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly diagnosticId: string;
      readonly available: boolean;
      readonly explanation?: string;
      readonly suggestion?: string;
      readonly model?: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionResult";
      readonly requestId: number;
      readonly revision: number;
      /** Project generation used to build reference-aware candidates. */
      readonly projectContextKey: string;
      readonly from: number;
      /**
       * The host provider has already performed field-aware filtering and
       * ranking. The Webview must preserve that order instead of applying a
       * second label-only fuzzy pass.
       */
      readonly providerFiltered?: boolean;
      readonly items: readonly VisualEditorCompletionItem[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionRefresh";
      readonly revision: number;
      readonly projectContextKey: string;
      readonly position: number;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualSnippetResult";
      readonly requestId: number;
      readonly revision: number;
      readonly expectedValue: string;
      readonly selectionStart: number;
      readonly selectionEnd: number;
      readonly matched: boolean;
      readonly from?: number;
      readonly to?: number;
      readonly snippet?: VirtualSnippetEncoding;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualCompletionResult";
      readonly requestId: number;
      readonly revision: number;
      readonly expectedValue: string;
      readonly selectionStart: number;
      readonly selectionEnd: number;
      readonly items: readonly VisualEditorVirtualCompletionItem[];
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualMathRenderResult";
      readonly requestId: number;
      readonly revision: number;
      readonly projectContextKey: string;
      readonly tex: string;
      readonly svg: string;
      readonly widthEm: number;
      readonly heightEm: number;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualMathRenderError";
      readonly requestId: number;
      readonly revision: number;
      readonly projectContextKey: string;
      readonly tex: string;
      readonly message: string;
    };

export type VisualEditorWebviewCommand =
  | "visualBasic"
  | "visualMaximum"
  | "clearGraphCache"
  | "retryGraphPreviews"
  | "openSource"
  | "undo"
  | "redo"
  | "save"
  | "build"
  | "buildPdfLaTex"
  | "buildXeLaTex"
  | "buildLuaLaTex"
  | "buildBibTex"
  | "buildBibLaTex"
  | "viewPdf"
  | "synctex"
  | "pickSnippet"
  | "pickCitation"
  | "openSnippetManager"
  | "openTemplateManager"
  | "openBibliography"
  | "aiReview"
  | "aiReviewDocument"
  | "aiRewrite"
  | "aiCompletion"
  | "navigateBack"
  | "navigateForward";

export type VisualEditorNavigationKind =
  | "reference"
  | "citation"
  | "frontMatter"
  | "tableOfContents";

export type VisualEditorWebviewMessage =
  | { readonly protocol: typeof VISUAL_EDITOR_PROTOCOL; readonly type: "focusApplied"; readonly requestId: number }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "ready";
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "edit";
      readonly revision: number;
      readonly changes: readonly VisualEditorChange[];
      readonly selection: VisualEditorSelection;
      readonly composing: boolean;
      readonly source: "user" | "host";
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "selection";
      readonly version: number;
      readonly selection: VisualEditorSelection;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "viewport";
      readonly version: number;
      readonly from: number;
      readonly to: number;
      /**
       * A trailing request emitted after scrolling has remained quiet. The
       * extension starts a fresh bounded render lane for this request and
       * spends its budget on the exact visible range instead of prefetch.
       */
      readonly settled?: boolean;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      /** Formula SVGs released by the bounded Webview cache. */
      readonly type: "formulaCacheEvicted";
      readonly formulaIds: readonly string[];
      /** At least one released formula intersects the currently visible source range. */
      readonly refillViewport: boolean;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "cursorPreview";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      /** Current mapped formula source, before the next full-document snapshot. */
      readonly formulaFrom: number;
      readonly formulaSource: string;
      /** UTF-16 offsets relative to formulaSource. */
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly display: boolean;
      readonly environmentName?: string;
      readonly cursorOffset: number;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      /** Fast static render requested as the caret leaves an edited formula. */
      readonly type: "formulaCommitPreview";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly formulaId: string;
      readonly formulaFrom: number;
      readonly formulaSource: string;
      /** UTF-16 offsets relative to formulaSource. */
      readonly bodyFrom: number;
      readonly bodyTo: number;
      readonly display: boolean;
      readonly environmentName?: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "referencePreview";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly from: number;
      readonly to: number;
      readonly key: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionReferencePreview";
      readonly requestId: number;
      readonly version: number;
      readonly revision: number;
      readonly key: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "command";
      readonly command: VisualEditorWebviewCommand;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "navigationCommand";
      readonly direction: "back" | "forward";
      readonly revision: number;
      readonly selection: VisualEditorSelection;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "openTemplate";
      readonly templateId: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "clipboard";
      readonly action: "cut" | "copy" | "paste";
      readonly revision: number;
      readonly selection: VisualEditorSelection;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "navigate";
      readonly revision: number;
      readonly kind: VisualEditorNavigationKind;
      readonly from: number;
      readonly to: number;
      /** Exact sub-target for a multi-key citation/reference command. */
      readonly key?: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "inputRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly action: VisualEditorInputAction;
      readonly selection: VisualEditorSelection;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "aiIssueAction";
      readonly revision: number;
      readonly issueId: string;
      readonly action: "apply" | "ignore";
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "diagnosticInsightRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly diagnosticId: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly position: number;
      readonly from: number;
      readonly explicit: boolean;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "completionAccepted";
      readonly revision: number;
      readonly actionId: string;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualSnippetRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly value: string;
      readonly selectionStart: number;
      readonly selectionEnd: number;
      readonly anchor: number;
      readonly context: VisualEditorVirtualInputContext;
      readonly activation: "auto" | "manual";
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualCompletionRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly value: string;
      readonly selectionStart: number;
      readonly selectionEnd: number;
      readonly anchor: number;
      readonly context: VisualEditorVirtualInputContext;
      readonly explicit: boolean;
    }
  | {
      readonly protocol: typeof VISUAL_EDITOR_PROTOCOL;
      readonly type: "virtualMathRenderRequest";
      readonly requestId: number;
      readonly revision: number;
      readonly projectContextKey: string;
      readonly anchor: number;
      readonly tex: string;
    };
